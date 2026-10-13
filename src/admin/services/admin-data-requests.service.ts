import { dayBoundsForKey, DEFAULT_TIMEZONE } from '../../common/utils/date-zone.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { cfg } from '../../system-config/config.holder';
import { CreateDataRequestDto, UpdateDataRequestDto } from '../dto/admin-data-request.dto';
import type { AdminActor } from './admin-foods.service';

/**
 * Hàng đợi yêu cầu quyền dữ liệu (xuất bản sao, xoá, khiếu nại). Người dùng gửi qua email theo Chính sách quyền riêng
 * tư; admin ghi nhận và xử lý ở đây, có hạn xử lý và nhật ký. Admin KHÔNG đọc dữ liệu sức khỏe để xử lý: xuất dữ liệu do
 * người dùng tự thực hiện trong app (POST me/export), xoá do người dùng tự xoá (cần xác thực lại).
 */
@Injectable()
export class AdminDataRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async create(actor: AdminActor, dto: CreateDataRequestDto, now: Date = new Date()) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    const created = await this.prisma.dataRequest.create({
      data: {
        userId: user?.id ?? null,
        email,
        type: dto.type,
        note: dto.note?.trim() || null,
        dueAt: new Date(now.getTime() + cfg('privacy.requestDueHours') * 3_600_000),
      },
    });
    await this.audit.logAction({
      adminId: actor.id, adminEmail: actor.email, action: 'CREATE_DATA_REQUEST', targetType: 'DataRequest', targetId: created.id,
      after: { type: dto.type, matchedAccount: !!user },
    });
    return { request: created, matchedAccount: !!user };
  }

  async list(params: { status?: string; type?: string; from?: string; to?: string; page?: number; limit?: number }, now: Date = new Date()) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const open = ['NEW', 'IN_PROGRESS'];
    const where: Record<string, unknown> = {
      ...(params.status ? { status: params.status } : { status: { in: open } }),
      ...(params.type ? { type: params.type } : {}),
      ...(params.from || params.to
        ? {
            createdAt: {
              ...(params.from ? { gte: dayBoundsForKey(params.from, DEFAULT_TIMEZONE).start } : {}),
              ...(params.to ? { lt: dayBoundsForKey(params.to, DEFAULT_TIMEZONE).end } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.dataRequest.count({ where }),
      this.prisma.dataRequest.findMany({ where, orderBy: { dueAt: 'asc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    // Quá hạn: chưa xong và đã qua hạn xử lý
    const items = rows.map((r) => ({ ...r, overdue: open.includes(r.status) && r.dueAt.getTime() < now.getTime() }));
    return { total, page, limit, items };
  }

  async update(actor: AdminActor, id: string, dto: UpdateDataRequestDto) {
    const before = await this.prisma.dataRequest.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy yêu cầu');
    if (['DONE', 'REJECTED'].includes(before.status)) throw new BadRequestException('Yêu cầu đã đóng, không sửa nữa');
    const note = dto.resultNote?.trim();
    if (dto.status === 'REJECTED' && !note) throw new BadRequestException('Từ chối yêu cầu phải ghi lý do');
    if (dto.status === 'DONE' && !note) throw new BadRequestException('Hoàn tất yêu cầu phải ghi cách đã xử lý');
    const closed = dto.status === 'DONE' || dto.status === 'REJECTED';
    const updated = await this.prisma.dataRequest.update({
      where: { id },
      data: {
        status: dto.status,
        resultNote: note ?? before.resultNote,
        handledBy: actor.id,
        ...(closed ? { handledAt: new Date() } : {}),
      },
    });
    await this.audit.logAction({
      adminId: actor.id, adminEmail: actor.email, action: 'UPDATE_DATA_REQUEST', targetType: 'DataRequest', targetId: id,
      before: { status: before.status }, after: { status: dto.status }, reason: note,
    });
    return { request: updated };
  }
}
