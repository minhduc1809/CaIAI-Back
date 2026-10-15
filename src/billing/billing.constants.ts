import { cfg } from '../system-config/config.holder';
import { SubStatus } from '@prisma/client';

/**
 * Giới hạn theo gói (đặc tả Free/Premium). `null` = không có giới hạn kiểu đó ở gói này.
 * Các con số do đặc tả chốt: ảnh 5/30, quét thực đơn 1/5, gợi ý món 2/..., chat 10 tin/ngày so với 50.000 token/ngày,
 * Check-in 1/tháng so với hằng tuần, lịch sử expenditure 7 ngày so với đầy đủ, lịch sử chat 3/7 ngày.
 * ⚠️ Chưa có trong đặc tả (tạm đặt, chỉnh được ở đây): gợi ý món Premium 20/ngày, mã vạch Free 5/ngày và Premium 200/ngày.
 */
export interface PlanLimits {
  aiPhotoPerDay: number;
  menuScanPerDay: number;
  suggestMealPerDay: number;
  barcodePerDay: number;
  chatMessagesPerDay: number | null;
  chatTokensPerDay: number | null;
  checkinPerMonth: number | null;
  expenditureHistoryDays: number | null;
  chatHistoryDays: number;
  /** Số ngày đầu của kế hoạch 30 ngày được xem trước (null = xem đủ). */
  planPreviewDays: number | null;
}

/** Trường nào của gói nào là "không giới hạn" (null) thì luôn null; các trường còn lại đọc từ tham số hệ thống. */
const UNLIMITED: Record<'FREE' | 'PREMIUM', (keyof PlanLimits)[]> = {
  FREE: ['chatTokensPerDay'],
  PREMIUM: ['chatMessagesPerDay', 'checkinPerMonth', 'expenditureHistoryDays', 'planPreviewDays'],
};
const LIMIT_KEYS: (keyof PlanLimits)[] = [
  'aiPhotoPerDay', 'menuScanPerDay', 'suggestMealPerDay', 'barcodePerDay', 'chatMessagesPerDay', 'chatTokensPerDay',
  'checkinPerMonth', 'expenditureHistoryDays', 'chatHistoryDays', 'planPreviewDays',
];

function makePlan(tier: 'FREE' | 'PREMIUM'): PlanLimits {
  const plan = {} as PlanLimits;
  for (const key of LIMIT_KEYS) {
    Object.defineProperty(plan, key, {
      enumerable: true,
      get: () => (UNLIMITED[tier].includes(key) ? null : cfg(`quota.${tier.toLowerCase()}.${key}`)),
    });
  }
  return plan;
}

/** Hạn mức theo gói (BR-16): đọc từ tham số hệ thống `quota.free.*` / `quota.premium.*`, mặc định như cũ. */
export const PLAN_LIMITS: { FREE: PlanLimits; PREMIUM: PlanLimits } = {
  FREE: makePlan('FREE'),
  PREMIUM: makePlan('PREMIUM'),
};

/** Trạng thái còn quyền Premium cho đến expiryTime (BR-16.3). */
export const PREMIUM_STATUSES: SubStatus[] = [
  SubStatus.ACTIVE,
  SubStatus.CANCELED,
  SubStatus.IN_GRACE_PERIOD,
];

/** Trạng thái cần đối soát lại với Google khi đã quá expiryTime (BR-16.6). */
export const RECONCILE_STATUSES: SubStatus[] = [
  SubStatus.ACTIVE,
  SubStatus.CANCELED,
  SubStatus.IN_GRACE_PERIOD,
  SubStatus.ON_HOLD,
  SubStatus.PENDING,
];

export const RECONCILE_MIN_INTERVAL_MS = 60 * 60 * 1000;
export const ENTITLEMENT_CACHE_MS = 60 * 1000;
