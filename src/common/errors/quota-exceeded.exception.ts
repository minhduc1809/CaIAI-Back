import { HttpException, HttpStatus } from '@nestjs/common';

export type QuotaFeature =
  | 'AI_FOOD_SCAN'
  | 'AI_MENU_SCAN'
  | 'AI_SUGGEST_MEAL'
  | 'AI_COACH'
  | 'BARCODE'
  | 'WEEKLY_CHECKIN'
  | 'DATA_EXPORT';

export type QuotaPeriod = 'day' | 'month';

const LABELS: Record<QuotaFeature, { noun: string; unit: string }> = {
  AI_FOOD_SCAN: { noun: 'nhận diện món', unit: 'lượt' },
  AI_MENU_SCAN: { noun: 'quét thực đơn', unit: 'lượt' },
  AI_SUGGEST_MEAL: { noun: 'AI gợi ý món', unit: 'lượt' },
  AI_COACH: { noun: 'trò chuyện với AI Coach', unit: 'tin nhắn' },
  BARCODE: { noun: 'tra mã vạch', unit: 'lượt' },
  WEEKLY_CHECKIN: { noun: 'Check-in', unit: 'lần' },
  DATA_EXPORT: { noun: 'xuất dữ liệu', unit: 'lần' },
};

export interface QuotaExceededInput {
  feature: QuotaFeature;
  limit: number;
  used: number;
  period: QuotaPeriod;
  resetsAt: Date | string;
  /** Đơn vị đếm; mặc định theo tính năng. Chat gói Premium đếm theo token. */
  unit?: string;
  /** Quyền lợi Premium liên quan, hiện khi người dùng đang ở gói Free. */
  premiumBenefit?: string | null;
  isPremium?: boolean;
}

/**
 * Lỗi hết hạn mức thống nhất (429 QUOTA_EXCEEDED, đặc tả 3.4). Mang đủ thông tin để app hiện đúng ngữ cảnh:
 * tính năng nào, đã dùng bao nhiêu, khi nào làm mới, Premium mở thêm gì và có nên mời nâng cấp không.
 */
export class QuotaExceededException extends HttpException {
  constructor(input: QuotaExceededInput) {
    const label = LABELS[input.feature];
    const unit = input.unit ?? label.unit;
    const when = input.period === 'day' ? 'hôm nay' : 'tháng này';
    const refresh = input.period === 'day' ? 'ngày mai' : 'đầu tháng sau';
    let message = `Bạn đã dùng ${input.used}/${input.limit} ${unit} ${label.noun} ${when}. Hạn mức sẽ được làm mới vào ${refresh}.`;
    if (!input.isPremium && input.premiumBenefit) {
      message += ` ${input.premiumBenefit}`;
    }
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'QUOTA_EXCEEDED',
        error: 'Too Many Requests',
        message,
        feature: input.feature,
        limit: input.limit,
        used: input.used,
        period: input.period,
        unit,
        resetsAt: typeof input.resetsAt === 'string' ? input.resetsAt : input.resetsAt.toISOString(),
        premiumBenefit: input.premiumBenefit ?? null,
        // Gợi ý app mở màn nâng cấp: chỉ khi người dùng chưa phải Premium
        upgrade: !input.isPremium,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
