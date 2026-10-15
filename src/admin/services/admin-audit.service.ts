import { dayBoundsForKey, DEFAULT_TIMEZONE } from '../../common/utils/date-zone.util';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LogActionParams {
  adminId: string;
  adminEmail?: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: any;
  after?: any;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ghi log hành động của quản trị viên (Append-Only)
   */
  async logAction(params: LogActionParams) {
    return this.prisma.adminAuditLog.create({
      data: {
        adminId: params.adminId,
        adminEmail: params.adminEmail || null,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId || null,
        before: params.before !== undefined ? params.before : undefined,
        after: params.after !== undefined ? params.after : undefined,
        reason: params.reason || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
      },
    });
  }

  /**
   * Lấy danh sách nhật ký kiểm toán
   */
  async getAuditLogs(query: {
    page?: number;
    limit?: number;
    action?: string;
    adminId?: string;
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
  }) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.action) where.action = query.action;
    if (query.adminId) where.adminId = query.adminId;
    if (query.targetType) where.targetType = query.targetType;
    if (query.targetId) where.targetId = query.targetId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: dayBoundsForKey(query.from, DEFAULT_TIMEZONE).start } : {}),
        ...(query.to ? { lt: dayBoundsForKey(query.to, DEFAULT_TIMEZONE).end } : {}),
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      message: 'Lấy nhật ký kiểm toán thành công',
      data: {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }
}
