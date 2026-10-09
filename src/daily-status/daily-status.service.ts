import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysToKey,
  dateToKey,
  keyToDate,
  resolveTimezone,
  todayKey,
} from '../common/utils/date-zone.util';
import { loadDayFlags } from '../common/utils/day-completeness.util';
import { DayCompleteness } from '@prisma/client';

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Số ngày tối đa của một lần liệt kê trạng thái. */
const MAX_RANGE_DAYS = 120;

@Injectable()
export class DailyStatusService {
  constructor(private readonly prisma: PrismaService) {}

  private async getTimezone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return resolveTimezone(user?.timezone);
  }

  /**
   * BR-05.2 / BR-07.6: đánh dấu một ngày là đầy đủ, chưa đủ, hoặc để hệ thống quyết định.
   * Không cho đánh dấu ngày trong tương lai (theo múi giờ của user).
   */
  async setStatus(userId: string, dateKey: string, completeness: DayCompleteness) {
    if (!DAY_KEY_RE.test(dateKey) || Number.isNaN(keyToDate(dateKey).getTime())) {
      throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
    }
    const tz = await this.getTimezone(userId);
    if (dateKey > todayKey(tz)) {
      throw new BadRequestException('Không thể đánh dấu ngày trong tương lai');
    }

    const row = await this.prisma.dailyLogStatus.upsert({
      where: { userId_logDate: { userId, logDate: keyToDate(dateKey) } },
      create: { userId, logDate: keyToDate(dateKey), completeness },
      update: { completeness },
    });
    return {
      message: 'Đã cập nhật trạng thái ngày',
      data: { date: dateToKey(row.logDate), completeness: row.completeness },
    };
  }

  /** Trạng thái các ngày trong [from, to] (mặc định 7 ngày gần nhất). Ngày chưa đánh dấu = AUTO. */
  async listStatuses(userId: string, from?: string, to?: string) {
    const tz = await this.getTimezone(userId);
    const toKey = to ?? todayKey(tz);
    const fromKey = from ?? addDaysToKey(toKey, -6);
    if (!DAY_KEY_RE.test(fromKey) || !DAY_KEY_RE.test(toKey)) {
      throw new BadRequestException('from/to phải có định dạng YYYY-MM-DD');
    }
    const span =
      (keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / 86_400_000;
    if (span < 0 || span > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Khoảng ngày không hợp lệ (tối đa ${MAX_RANGE_DAYS} ngày)`,
      );
    }

    const flags = await loadDayFlags(this.prisma, userId, fromKey, toKey);
    const days: { date: string; completeness: string }[] = [];
    for (let k = fromKey; k <= toKey; k = addDaysToKey(k, 1)) {
      days.push({ date: k, completeness: flags.get(k) ?? 'AUTO' });
    }
    return { message: 'Lấy trạng thái ngày thành công', data: days };
  }
}
