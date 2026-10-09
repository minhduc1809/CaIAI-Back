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

export const PLAN_LIMITS: { FREE: PlanLimits; PREMIUM: PlanLimits } = {
  FREE: {
    aiPhotoPerDay: 5,
    menuScanPerDay: 1,
    suggestMealPerDay: 2,
    barcodePerDay: 5,
    chatMessagesPerDay: 10,
    chatTokensPerDay: null,
    checkinPerMonth: 1,
    expenditureHistoryDays: 7,
    chatHistoryDays: 3,
    planPreviewDays: 7,
  },
  PREMIUM: {
    aiPhotoPerDay: 30,
    menuScanPerDay: 5,
    suggestMealPerDay: 20,
    barcodePerDay: 200,
    chatMessagesPerDay: null,
    chatTokensPerDay: 50000,
    checkinPerMonth: null,
    expenditureHistoryDays: null,
    chatHistoryDays: 7,
    planPreviewDays: null,
  },
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
