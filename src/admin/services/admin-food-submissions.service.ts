import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { FoodCatalogService } from '../../food-catalog/food-catalog.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { atwaterCheck, normalizeName } from '../../ai/food-matcher';
import { ApproveFoodSubmissionDto } from '../dto/admin-food-submission.dto';
import { SUBMISSION_STATUS } from '../../food-submissions/food-submissions.service';
import type { AdminActor } from './admin-foods.service';

/** Duyệt món người dùng gửi vào kho chung (BR-08.5, J2). Mọi quyết định ghi nhật ký kiểm toán và báo cho người gửi. */
@Injectable()
export class AdminFoodSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly catalog: FoodCatalogService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(params: { status?: string; duplicate?: boolean; query?: string; order?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const status = params.status && params.status in SUBMISSION_STATUS ? params.status : SUBMISSION_STATUS.SUBMITTED;
    const q = normalizeName(params.query ?? '');
    const where = {
      status,
      ...(params.duplicate ? { possibleDuplicate: true } : {}),
      ...(q ? { nameNormalized: { contains: q } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.foodSubmission.count({ where }),
      this.prisma.foodSubmission.findMany({
        where,
        // Cũ nhất trước để duyệt theo thứ tự gửi
        orderBy: { createdAt: params.order === 'desc' ? 'desc' : 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, username: true, email: true } } },
      }),
    ]);
    // Kèm món nghi trùng trong kho để admin so sánh cạnh nhau
    const dupNames = [...new Set(items.map((i) => i.duplicateOfName).filter((n): n is string => !!n))];
    const dups = dupNames.length
      ? await this.prisma.foodCatalog.findMany({
          where: { name: { in: dupNames } },
          select: { name: true, category: true, servingSize: true, calories: true, protein: true, carb: true, fat: true, isActive: true },
        })
      : [];
    const dupByName = new Map(dups.map((d) => [d.name, d]));
    return { total, page, limit, items: items.map((i) => ({ ...i, duplicateOf: i.duplicateOfName ? dupByName.get(i.duplicateOfName) ?? null : null })) };
  }

  private async load(id: string) {
    const sub = await this.prisma.foodSubmission.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Không tìm thấy món được gửi');
    if (sub.status !== SUBMISSION_STATUS.SUBMITTED) {
      throw new ConflictException('Món này đã được xử lý (hoặc người dùng đã huỷ)');
    }
    return sub;
  }

  async approve(actor: AdminActor, id: string, dto: ApproveFoodSubmissionDto) {
    const sub = await this.load(id);
    const name = (dto.name ?? sub.name).trim();
    const nutrition = {
      calories: dto.calories ?? sub.calories,
      protein: dto.protein ?? sub.protein,
      carb: dto.carb ?? sub.carb,
      fat: dto.fat ?? sub.fat,
    };
    const dupe = await this.prisma.foodCatalog.findFirst({ where: { name } });
    if (dupe) {
      throw new ConflictException('Đã có món trùng tên trong kho. Hãy đổi tên hoặc từ chối vì trùng.');
    }

    // Cập nhật trạng thái có điều kiện: hai admin duyệt cùng lúc chỉ một người thành công
    const claimed = await this.prisma.foodSubmission.updateMany({
      where: { id, status: SUBMISSION_STATUS.SUBMITTED },
      data: { status: SUBMISSION_STATUS.APPROVED, reviewedBy: actor.id, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException('Món này vừa được xử lý bởi người khác');

    let created;
    try {
      created = await this.prisma.foodCatalog.create({
        data: {
          name,
          nameNormalized: normalizeName(name),
          aliases: (dto.aliases ?? []).map((a) => a.trim()).filter(Boolean),
          category: dto.category.trim(),
          servingSize: (dto.servingSize ?? sub.servingSize).trim(),
          ...nutrition,
          note: sub.note ?? null,
          allergens: dto.allergens,
          containsMeat: dto.containsMeat,
          containsFish: dto.containsFish,
          containsEgg: dto.containsEgg,
          containsDairy: dto.containsDairy,
          containsPork: dto.containsPork,
          safetyTagged: true,
          source: 'COMMUNITY',
          dataSource: dto.dataSource?.trim() || 'Người dùng đóng góp, quản trị viên đã rà soát',
        },
      });
    } catch (e) {
      // Không tạo được món thì trả lại trạng thái chờ duyệt để không mất yêu cầu của người dùng
      await this.prisma.foodSubmission.updateMany({
        where: { id, status: SUBMISSION_STATUS.APPROVED },
        data: { status: SUBMISSION_STATUS.SUBMITTED, reviewedBy: null, reviewedAt: null },
      });
      throw new BadRequestException(`Không thể thêm món vào kho: ${(e as Error).message}`);
    }
    await this.prisma.foodSubmission.update({ where: { id }, data: { catalogFoodId: created.id } });
    this.catalog.invalidate();

    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'APPROVE_FOOD_SUBMISSION',
      targetType: 'FoodSubmission',
      targetId: id,
      before: sub,
      after: created,
    });
    await this.notify(
      sub.userId,
      'Món của bạn đã được duyệt',
      `"${name}" đã được thêm vào kho món chung. Cảm ơn bạn đã đóng góp!`,
    );

    const check = atwaterCheck(created);
    return {
      food: created,
      warnings: check.ok ? [] : [`Calo lệch hơn 15% so với tính từ đạm/tinh bột/béo (${Math.round(check.computed)} kcal).`],
    };
  }

  async reject(actor: AdminActor, id: string, reason: string) {
    const sub = await this.load(id);
    const claimed = await this.prisma.foodSubmission.updateMany({
      where: { id, status: SUBMISSION_STATUS.SUBMITTED },
      data: {
        status: SUBMISSION_STATUS.REJECTED,
        rejectReason: reason.trim(),
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new ConflictException('Món này vừa được xử lý bởi người khác');

    await this.audit.logAction({
      adminId: actor.id,
      adminEmail: actor.email,
      action: 'REJECT_FOOD_SUBMISSION',
      targetType: 'FoodSubmission',
      targetId: id,
      before: sub,
      reason: reason.trim(),
    });
    await this.notify(
      sub.userId,
      'Món của bạn chưa được duyệt',
      `"${sub.name}" chưa được thêm vào kho chung. Lý do: ${reason.trim()}. Món tự tạo của bạn vẫn giữ nguyên.`,
    );
    return { message: 'Đã từ chối món' };
  }

  /** Thông báo là việc phụ: lỗi gửi thông báo không làm hỏng quyết định đã ghi. */
  private async notify(userId: string, title: string, message: string) {
    try {
      await this.notifications.create(userId, 'FOOD_SUBMISSION_RESULT', title, message);
    } catch {
      // bỏ qua
    }
  }
}
