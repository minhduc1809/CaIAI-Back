import { cfg } from '../system-config/config.holder';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FoodCatalogService } from '../food-catalog/food-catalog.service';
import { nameSimilarity, normalizeName } from '../ai/food-matcher';

/** Số món chờ duyệt tối đa của một người dùng, chống gửi hàng loạt (BR-08.5, `food.maxPendingSubmissions`). */
export const MAX_PENDING_SUBMISSIONS = 5; // mặc định; giá trị hiệu lực: cfg('food.maxPendingSubmissions')
/** Tên giống món có sẵn từ mức này thì gắn cờ nghi trùng nhưng vẫn cho gửi (`food.duplicateSimilarity`). */
export const DUPLICATE_SIMILARITY = 0.8; // mặc định; giá trị hiệu lực: cfg('food.duplicateSimilarity')

export const SUBMISSION_STATUS = {
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELED: 'CANCELED',
} as const;

/** Gửi món tự tạo vào kho chung (BR-08.5): phía người dùng. Duyệt/từ chối nằm ở admin. */
@Injectable()
export class FoodSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: FoodCatalogService,
  ) {}

  /** Món gần giống nhất trong kho, nếu độ tương đồng ≥ ngưỡng. */
  async findDuplicate(name: string): Promise<{ possibleDuplicate: boolean; duplicateOfName: string | null }> {
    const foods = await this.catalog.getFoods();
    let best: { name: string; score: number } | null = null;
    for (const f of foods) {
      const score = Math.max(nameSimilarity(name, f.name), ...f.aliases.map((a) => nameSimilarity(name, a)));
      if (!best || score > best.score) best = { name: f.name, score };
    }
    if (best && best.score >= cfg('food.duplicateSimilarity')) {
      return { possibleDuplicate: true, duplicateOfName: best.name };
    }
    return { possibleDuplicate: false, duplicateOfName: null };
  }

  async submit(userId: string, customFoodId: string, note?: string) {
    const food = await this.prisma.customFood.findUnique({ where: { id: customFoodId } });
    if (!food || food.userId !== userId) throw new NotFoundException('Không tìm thấy món ăn của bạn');

    const pending = await this.prisma.foodSubmission.findMany({
      where: { userId, status: SUBMISSION_STATUS.SUBMITTED },
      select: { id: true, customFoodId: true },
    });
    if (pending.some((p) => p.customFoodId === customFoodId)) {
      throw new ConflictException('Món này đang chờ duyệt');
    }
    if (pending.length >= cfg('food.maxPendingSubmissions')) {
      throw new BadRequestException(
        `Bạn đang có ${cfg('food.maxPendingSubmissions')} món chờ duyệt. Hãy đợi duyệt xong hoặc huỷ bớt trước khi gửi thêm.`,
      );
    }
    if (!(food.calories >= 0) || food.calories > 5000) {
      throw new BadRequestException('Số liệu calo của món không hợp lệ');
    }

    const dup = await this.findDuplicate(food.name);
    const created = await this.prisma.foodSubmission.create({
      data: {
        userId,
        customFoodId: food.id,
        name: food.name.trim(),
        nameNormalized: normalizeName(food.name),
        servingSize: food.servingSize || '1 phần',
        calories: food.calories,
        protein: food.protein,
        carb: food.carb,
        fat: food.fat,
        barcode: food.barcode ?? null,
        note: note?.trim() || null,
        possibleDuplicate: dup.possibleDuplicate,
        duplicateOfName: dup.duplicateOfName,
      },
    });
    return {
      message: dup.possibleDuplicate
        ? `Đã gửi. Món này có vẻ giống "${dup.duplicateOfName}" trong kho, quản trị viên sẽ xem xét.`
        : 'Đã gửi món để quản trị viên duyệt',
      data: created,
    };
  }

  async listMine(userId: string) {
    const items = await this.prisma.foodSubmission.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { message: 'Lấy danh sách món đã gửi thành công', data: items };
  }

  /** Người dùng chỉ huỷ được khi còn SUBMITTED; đã duyệt hay từ chối thì không đổi nữa. */
  async cancel(userId: string, id: string) {
    const sub = await this.prisma.foodSubmission.findUnique({ where: { id } });
    if (!sub || sub.userId !== userId) throw new NotFoundException('Không tìm thấy món đã gửi');
    if (sub.status !== SUBMISSION_STATUS.SUBMITTED) {
      throw new ConflictException('Món này đã được xử lý nên không huỷ được');
    }
    // Điều kiện trạng thái nằm trong câu lệnh để không đè lên kết quả duyệt xảy ra cùng lúc
    const res = await this.prisma.foodSubmission.updateMany({
      where: { id, userId, status: SUBMISSION_STATUS.SUBMITTED },
      data: { status: SUBMISSION_STATUS.CANCELED },
    });
    if (res.count === 0) throw new ConflictException('Món này vừa được xử lý nên không huỷ được');
    return { message: 'Đã huỷ việc gửi món' };
  }
}
