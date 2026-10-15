import { addDaysToKey, dayBoundsForKey, DEFAULT_TIMEZONE, todayKey } from '../../common/utils/date-zone.util';
import { resolveRange } from './admin-analytics.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { summarizeUserCosts } from '../../ai/ai-usage';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Báo cáo chi phí AI thật (BR-15.5, J2): tổng, theo tính năng và phân vị chi phí mỗi người dùng trong tháng.
 * Số liệu lấy từ ApiUsageLog (token thật từ Gemini). Tháng tính theo UTC.
 */
@Injectable()
export class AdminAiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Số liệu theo ngày (giờ Việt Nam): lời gọi, lỗi, token, chi phí ước tính. Chi phí là ƯỚC TÍNH từ token thật nhân đơn giá
   * cấu hình (AI_PRICE_*), không phải số tiền đã đối soát với hoá đơn của nhà cung cấp.
   */
  async getDaily(from?: string, to?: string, now: Date = new Date()) {
    const range = resolveRange(from, to, now);
    const start = dayBoundsForKey(range.from, DEFAULT_TIMEZONE).start;
    const end = dayBoundsForKey(range.to, DEFAULT_TIMEZONE).end;
    const rows = await this.prisma.$queryRaw<{ day: string; calls: number; errors: number; cost: number; tokens: number; noUsage: number }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS calls,
             (COUNT(*) FILTER (WHERE status = 'ERROR'))::int AS errors,
             (COUNT(*) FILTER (WHERE status = 'OK_NO_USAGE'))::int AS "noUsage",
             COALESCE(SUM("costUsd"), 0)::float AS cost,
             COALESCE(SUM("promptTokens" + "outputTokens"), 0)::int AS tokens
      FROM "ApiUsageLog"
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1 ORDER BY 1`;
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const days: { date: string; calls: number; errors: number; errorRatePct: number | null; costUsd: number; tokens: number }[] = [];
    for (let i = 0; i < range.days; i++) {
      const key = addDaysToKey(range.from, i);
      const r = byDay.get(key);
      days.push({
        date: key,
        calls: r?.calls ?? 0,
        errors: r?.errors ?? 0,
        errorRatePct: r?.calls ? Math.round((r.errors / r.calls) * 1000) / 10 : null,
        costUsd: Math.round((r?.cost ?? 0) * 10000) / 10000,
        tokens: r?.tokens ?? 0,
      });
    }
    const today = days.find((d) => d.date === todayKey(DEFAULT_TIMEZONE, now));
    return {
      range,
      days,
      todayCostUsd: today?.costUsd ?? null,
      pricing: {
        configured: !!process.env.AI_PRICE_INPUT_USD_PER_MTOK && !!process.env.AI_PRICE_OUTPUT_USD_PER_MTOK,
        note: 'Chi phí là ước tính từ token thật nhân đơn giá cấu hình; chưa đối soát với hoá đơn nhà cung cấp.',
      },
    };
  }

  /** `month` dạng YYYY-MM; bỏ trống là tháng hiện tại. */
  async getUsage(month?: string, now: Date = new Date()) {
    let year = now.getUTCFullYear();
    let monthIndex = now.getUTCMonth();
    if (month) {
      const m = MONTH_RE.exec(month);
      if (!m) throw new BadRequestException('Tháng phải có dạng YYYY-MM, ví dụ 2026-10');
      year = Number(m[1]);
      monthIndex = Number(m[2]) - 1;
    }
    const from = new Date(Date.UTC(year, monthIndex, 1));
    const to = new Date(Date.UTC(year, monthIndex + 1, 1));
    const where = { createdAt: { gte: from, lt: to } };
    const label = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

    const [totals, errors, noUsage, byFeature, byFeatureStatus, perUser] = await Promise.all([
      this.prisma.apiUsageLog.aggregate({
        where,
        _count: { _all: true },
        _sum: { promptTokens: true, outputTokens: true, costUsd: true },
      }),
      this.prisma.apiUsageLog.count({ where: { ...where, status: 'ERROR' } }),
      this.prisma.apiUsageLog.count({ where: { ...where, status: 'OK_NO_USAGE' } }),
      this.prisma.apiUsageLog.groupBy({
        by: ['feature'],
        where,
        _count: { _all: true },
        _sum: { promptTokens: true, outputTokens: true, costUsd: true },
        _avg: { latencyMs: true },
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['feature', 'status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.apiUsageLog.groupBy({
        by: ['userId'],
        where,
        _sum: { costUsd: true },
      }),
    ]);

    const calls = totals._count._all;
    const errorsByFeature = new Map<string, number>();
    for (const row of byFeatureStatus) {
      if (row.status === 'ERROR') errorsByFeature.set(row.feature, row._count._all);
    }
    const round = (n: number | null | undefined, digits = 6) =>
      n == null ? 0 : Math.round(n * 10 ** digits) / 10 ** digits;

    const features = byFeature
      .map((f) => {
        const featureCalls = f._count._all;
        const featureErrors = errorsByFeature.get(f.feature) ?? 0;
        return {
          feature: f.feature,
          calls: featureCalls,
          errors: featureErrors,
          errorRatePct: featureCalls ? round((featureErrors / featureCalls) * 100, 1) : 0,
          promptTokens: f._sum.promptTokens ?? 0,
          outputTokens: f._sum.outputTokens ?? 0,
          costUsd: round(f._sum.costUsd),
          avgLatencyMs: Math.round(f._avg.latencyMs ?? 0),
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd);

    return {
      month: label,
      totals: {
        calls,
        errors,
        errorRatePct: calls ? round((errors / calls) * 100, 1) : 0,
        // Lời gọi Gemini không trả usageMetadata: token = 0 nên chi phí có thể bị đánh giá thấp
        callsWithoutUsage: noUsage,
        promptTokens: totals._sum.promptTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        costUsd: round(totals._sum.costUsd),
      },
      byFeature: features,
      // Chi phí AI mỗi người dùng trong tháng: nhẹ (p50), trung bình (p75), nặng (p95). Điều kiện chấp nhận mô hình:
      // p95 vẫn có biên lợi nhuận dương sau phí Google Play (cần tự xác minh phí hiện hành).
      perUserMonthlyCostUsd: summarizeUserCosts(perUser.map((u) => u._sum.costUsd ?? 0)),
    };
  }
}
