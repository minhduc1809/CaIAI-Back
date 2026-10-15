import { cfg } from '../system-config/config.holder';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VIETNAMESE_FOODS_DATA } from '../recommendations/data/vietnamese-food-database.data';
import { FOOD_SAFETY_TAGS, FoodSafetyTags } from '../recommendations/data/food-safety-tags.data';
import { FoodSafetyRules, SafeFood, isFoodAllowed } from '../recommendations/food-safety';
import { FOOD_ALIASES } from '../ai/food-aliases.data';
import { FoodMatcher, normalizeName } from '../ai/food-matcher';
import { CatalogFood, DEFAULT_SEARCH_SIMILARITY_MIN, categoriesOf, searchCatalog } from './food-catalog.search';

/** Nhóm thực phẩm hiển thị mặc định (giữ thứ tự cũ); nhóm mới do admin thêm được nối vào cuối. */
export const DEFAULT_FOOD_CATEGORIES = [
  'Cơm - Tinh bột',
  'Bún - Phở - Mì',
  'Thịt - Gia cầm',
  'Hải sản - Cá',
  'Rau củ - Canh',
  'Trái cây - Đồ uống',
];

const DEFAULT_CACHE_TTL_SEC = 300;

const toTags = (f: CatalogFood): FoodSafetyTags => ({
  allergens: f.allergens as FoodSafetyTags['allergens'],
  containsMeat: f.containsMeat,
  containsFish: f.containsFish,
  containsEgg: f.containsEgg,
  containsDairy: f.containsDairy,
  containsPork: f.containsPork,
});

/** Kho món tĩnh trong code, dùng để nạp lần đầu và làm phương án dự phòng khi không đọc được cơ sở dữ liệu. */
export function staticCatalog(): CatalogFood[] {
  return VIETNAMESE_FOODS_DATA.map((food, i) => {
    const tags = FOOD_SAFETY_TAGS[food.name];
    return {
      ...food,
      id: `static-${i}`,
      nameNormalized: normalizeName(food.name),
      aliases: FOOD_ALIASES[food.name] ?? [],
      allergens: tags?.allergens ?? [],
      containsMeat: tags?.containsMeat ?? false,
      containsFish: tags?.containsFish ?? false,
      containsEgg: tags?.containsEgg ?? false,
      containsDairy: tags?.containsDairy ?? false,
      containsPork: tags?.containsPork ?? false,
      safetyTagged: !!tags,
      source: 'OFFICIAL',
    };
  });
}

interface Cache {
  foods: CatalogFood[];
  matcher: FoodMatcher;
  loadedAt: number;
}

/**
 * Kho món ăn trong cơ sở dữ liệu (BR-08.1), nạp vào bộ nhớ để mọi tính năng đọc nhanh: gợi ý món, thực đơn, quét thực
 * đơn, nhận diện ảnh, tra cứu. Lần đầu nạp 73 món sẵn có (idempotent, không ghi đè món admin đã sửa). Không đọc được
 * cơ sở dữ liệu thì dùng kho trong code để app vẫn chạy.
 */
@Injectable()
export class FoodCatalogService {
  private readonly logger = new Logger(FoodCatalogService.name);
  private cache: Cache | null = null;
  private loading: Promise<Cache> | null = null;
  private seeded = false;

  constructor(private readonly prisma: PrismaService) {}

  private ttlMs(): number {
    const n = Number(process.env.FOOD_CATALOG_CACHE_TTL_SEC);
    return (Number.isFinite(n) && n > 0 ? n : DEFAULT_CACHE_TTL_SEC) * 1000;
  }

  private build(foods: CatalogFood[]): Cache {
    const aliasMap: Record<string, string[]> = {};
    for (const f of foods) aliasMap[f.name] = f.aliases;
    return { foods, matcher: new FoodMatcher(foods, aliasMap), loadedAt: Date.now() };
  }

  /** Nạp 73 món sẵn có nếu chưa có trong bảng; món đã tồn tại (kể cả đã bị admin sửa hoặc tắt) được giữ nguyên. */
  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    const base = Date.now();
    await this.prisma.foodCatalog.createMany({
      data: staticCatalog().map((f, i) => ({
        name: f.name,
        nameNormalized: f.nameNormalized,
        aliases: f.aliases,
        category: f.category,
        servingSize: f.servingSize,
        calories: f.calories,
        protein: f.protein,
        carb: f.carb,
        fat: f.fat,
        note: f.note ?? null,
        allergens: f.allergens,
        containsMeat: f.containsMeat,
        containsFish: f.containsFish,
        containsEgg: f.containsEgg,
        containsDairy: f.containsDairy,
        containsPork: f.containsPork,
        safetyTagged: f.safetyTagged,
        source: 'OFFICIAL',
        dataSource: 'Kho món gốc của NutriWise (Viện Dinh dưỡng), chờ chuyên gia rà soát',
        // createdAt tăng dần để giữ đúng thứ tự kho cũ khi đọc ra
        createdAt: new Date(base + i),
      })),
      skipDuplicates: true,
    });
    this.seeded = true;
  }

  private async load(): Promise<Cache> {
    try {
      await this.ensureSeeded();
      const rows = await this.prisma.foodCatalog.findMany({
        where: { isActive: true },
        orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
      });
      const foods: CatalogFood[] = rows.map((r) => ({
        id: r.id,
        name: r.name,
        nameNormalized: r.nameNormalized,
        aliases: r.aliases,
        category: r.category,
        servingSize: r.servingSize,
        calories: r.calories,
        protein: r.protein,
        carb: r.carb,
        fat: r.fat,
        note: r.note ?? undefined,
        allergens: r.allergens,
        containsMeat: r.containsMeat,
        containsFish: r.containsFish,
        containsEgg: r.containsEgg,
        containsDairy: r.containsDairy,
        containsPork: r.containsPork,
        safetyTagged: r.safetyTagged,
        source: r.source,
        units: r.units ?? undefined,
      }));
      return this.build(foods);
    } catch (e) {
      this.logger.error(`Không đọc được kho món từ cơ sở dữ liệu, dùng kho trong code: ${(e as Error).message}`);
      return this.build(staticCatalog());
    }
  }

  private async ready(): Promise<Cache> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.ttlMs()) return this.cache;
    if (!this.loading) {
      this.loading = this.load()
        .then((c) => (this.cache = c))
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  /** Bỏ bộ nhớ đệm để lần đọc sau nạp lại (gọi khi admin sửa kho). */
  invalidate(): void {
    this.cache = null;
  }

  async getFoods(): Promise<CatalogFood[]> {
    return (await this.ready()).foods;
  }

  /** Bộ khớp tên món (nhận diện ảnh, quét thực đơn) dựng từ kho hiện tại. */
  async getMatcher(): Promise<FoodMatcher> {
    return (await this.ready()).matcher;
  }

  /**
   * Món được phép gợi ý cho người dùng: đã gắn thẻ an toàn và không vi phạm dị ứng/chế độ ăn. Món chưa gắn thẻ bị
   * loại (fail-closed) để món mới thêm mà quên thẻ không bao giờ lọt vào gợi ý.
   */
  async getAllowedFoods(rules: FoodSafetyRules): Promise<SafeFood[]> {
    const foods = await this.getFoods();
    const result: SafeFood[] = [];
    for (const f of foods) {
      if (!f.safetyTagged) continue;
      const safety = toTags(f);
      if (isFoodAllowed(safety, rules)) result.push({ ...f, safety });
    }
    return result;
  }

  /** Tra món theo mã hoặc tên chính xác (đã chuẩn hoá), dùng để gắn định danh cho yêu thích (BR-08.3). */
  async findByIdOrName(ref: { id?: string | null; name?: string }): Promise<CatalogFood | undefined> {
    const foods = await this.getFoods();
    if (ref.id) {
      const byId = foods.find((f) => f.id === ref.id);
      if (byId) return byId;
    }
    if (ref.name) {
      const key = normalizeName(ref.name);
      return foods.find((f) => f.nameNormalized === key);
    }
    return undefined;
  }

  async search(query?: string, category?: string): Promise<CatalogFood[]> {
    const min = Number(process.env.FOOD_SEARCH_SIMILARITY_MIN);
    return searchCatalog(
      await this.getFoods(),
      query,
      category,
      Number.isFinite(min) && min > 0 && min <= 1 ? min : cfg('food.searchSimilarityMin'),
    );
  }

  async categories(): Promise<string[]> {
    const extra = categoriesOf(await this.getFoods()).filter((c) => !DEFAULT_FOOD_CATEGORIES.includes(c));
    return [...DEFAULT_FOOD_CATEGORIES, ...extra];
  }
}
