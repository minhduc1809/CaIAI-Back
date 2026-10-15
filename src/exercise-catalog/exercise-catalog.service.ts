import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExerciseGuide, FEMALE_EXERCISES, MALE_EXERCISES } from '../recommendations/data/gender-exercises.data';
import { normalizeName } from '../ai/food-matcher';

const TTL_MS = 5 * 60_000;
const staticExercises = (): ExerciseGuide[] => [...MALE_EXERCISES, ...FEMALE_EXERCISES];

/**
 * Kho bài tập trong cơ sở dữ liệu (F1, J2). Lần đầu tự nạp các bài có sẵn (idempotent, không ghi đè bài admin đã sửa
 * hay ẩn). Không đọc được DB thì dùng kho trong code để app vẫn chạy. Bộ nhớ đệm làm mới khi admin sửa.
 */
@Injectable()
export class ExerciseCatalogService {
  private readonly logger = new Logger(ExerciseCatalogService.name);
  private cache: { items: ExerciseGuide[]; loadedAt: number } | null = null;
  private seeded = false;

  constructor(private readonly prisma: PrismaService) {}

  invalidate() {
    this.cache = null;
  }

  async ensureSeeded(): Promise<void> {
    if (this.seeded) return;
    const base = Date.now();
    await this.prisma.exerciseCatalog.createMany({
      data: staticExercises().map((e, i) => ({
        id: e.id,
        name: e.name,
        nameNormalized: normalizeName(e.name),
        genderTarget: String(e.genderTarget),
        level: String(e.level),
        targetMuscle: e.targetMuscle,
        equipment: e.equipment,
        data: e as any,
        source: 'OFFICIAL',
        createdAt: new Date(base + i),
      })),
      skipDuplicates: true,
    });
    this.seeded = true;
  }

  /** Bài đang hiển thị (isActive), theo thứ tự kho cũ. */
  async getAll(): Promise<ExerciseGuide[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < TTL_MS) return this.cache.items;
    try {
      await this.ensureSeeded();
      const rows = await this.prisma.exerciseCatalog.findMany({
        where: { isActive: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      // Cột tìm kiếm là nguồn đúng cho các trường có thể sửa; phần còn lại lấy từ `data`
      const items = rows.map((r) => ({
        ...(r.data as unknown as ExerciseGuide),
        id: r.id,
        name: r.name,
        genderTarget: r.genderTarget as ExerciseGuide['genderTarget'],
        level: r.level as ExerciseGuide['level'],
        targetMuscle: r.targetMuscle,
        equipment: r.equipment as ExerciseGuide['equipment'],
      }));
      this.cache = { items, loadedAt: Date.now() };
      return items;
    } catch (e) {
      this.logger.error(`Không đọc được kho bài tập từ cơ sở dữ liệu, dùng kho trong code: ${(e as Error).message}`);
      return staticExercises();
    }
  }

  async getById(id: string): Promise<ExerciseGuide | undefined> {
    return (await this.getAll()).find((e) => e.id === id);
  }
}
