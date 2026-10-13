/**
 * Danh mục tham số hệ thống (BR-19.2, BR-19.3). Mặc định nằm trong code; bảng `SystemConfig` chỉ lưu giá trị bị ghi
 * đè. Mọi giá trị phải nằm trong [min, max]; tham số an toàn (`safetyCritical`) có giới hạn chặt và sửa cần lý do.
 */
export type ConfigValueType = 'int' | 'float' | 'bool';

export interface ConfigDef {
  key: string;
  group: string;
  type: ConfigValueType;
  default: number | boolean;
  min?: number;
  max?: number;
  unit?: string;
  description: string;
  /** Tham số ảnh hưởng an toàn dinh dưỡng: giới hạn chặt, không thể đặt lỏng hơn ngưỡng an toàn tối thiểu. */
  safetyCritical?: boolean;
}

const d = (def: ConfigDef): ConfigDef => def;

export const CONFIG_REGISTRY: ConfigDef[] = [
  // ── Dinh dưỡng an toàn (BR-03.3 → 03.7) ──
  d({ key: 'nutrition.calorieFloorFemale', group: 'Dinh dưỡng an toàn', type: 'int', default: 1200, min: 1000, max: 2000, unit: 'kcal', description: 'Sàn calo mục tiêu cho nữ', safetyCritical: true }),
  d({ key: 'nutrition.calorieFloorMale', group: 'Dinh dưỡng an toàn', type: 'int', default: 1500, min: 1200, max: 2500, unit: 'kcal', description: 'Sàn calo mục tiêu cho nam và giới khác', safetyCritical: true }),
  d({ key: 'nutrition.maxDeficitPctOfE', group: 'Dinh dưỡng an toàn', type: 'float', default: 25, min: 5, max: 30, unit: '%', description: 'Thâm hụt tối đa so với mức năng lượng nền', safetyCritical: true }),
  d({ key: 'nutrition.maxSurplusPctOfE', group: 'Dinh dưỡng an toàn', type: 'float', default: 15, min: 5, max: 25, unit: '%', description: 'Thặng dư tối đa so với mức năng lượng nền', safetyCritical: true }),
  d({ key: 'nutrition.pregnancyEnergyAddKcal', group: 'Dinh dưỡng an toàn', type: 'int', default: 300, min: 0, max: 600, unit: 'kcal', description: 'Năng lượng cộng thêm khi mang thai', safetyCritical: true }),
  d({ key: 'nutrition.lactationEnergyAddKcal', group: 'Dinh dưỡng an toàn', type: 'int', default: 500, min: 0, max: 800, unit: 'kcal', description: 'Năng lượng cộng thêm khi cho con bú', safetyCritical: true }),
  // ── Macro ──
  d({ key: 'macro.fatMinPerKg', group: 'Macro', type: 'float', default: 0.6, min: 0.4, max: 1.2, unit: 'g/kg', description: 'Sàn chất béo theo cân nặng', safetyCritical: true }),
  d({ key: 'macro.proteinMaxPctKcal', group: 'Macro', type: 'float', default: 35, min: 25, max: 45, unit: '%', description: 'Đạm tối đa theo % tổng calo', safetyCritical: true }),
  // ── Check-in ──
  d({ key: 'checkin.maxChangePct', group: 'Check-in', type: 'float', default: 10, min: 3, max: 20, unit: '%', description: 'Mức đổi mục tiêu tối đa mỗi lần Check-in (làm mượt)' }),
  d({ key: 'checkin.snoozeHours', group: 'Check-in', type: 'int', default: 24, min: 1, max: 72, unit: 'giờ', description: 'Thời gian hoãn Check-in' }),
  d({ key: 'checkin.noChangeThresholdKcal', group: 'Check-in', type: 'int', default: 50, min: 0, max: 200, unit: 'kcal', description: 'Chênh lệch dưới mức này coi là giữ nguyên mục tiêu' }),
  // ── Insight ──
  d({ key: 'insight.plateauWeeks', group: 'Insight', type: 'int', default: 3, min: 2, max: 8, unit: 'tuần', description: 'Số tuần liên tiếp để kết luận cân nặng đi ngang' }),
  d({ key: 'insight.goalDeviationWeeks', group: 'Insight', type: 'int', default: 2, min: 1, max: 8, unit: 'tuần', description: 'Số tuần liên tiếp lệch tốc độ mục tiêu để cảnh báo' }),
  d({ key: 'insight.minCompleteDaysPerWeek', group: 'Insight', type: 'int', default: 4, min: 1, max: 7, unit: 'ngày', description: 'Số ngày ghi đầy đủ tối thiểu mỗi tuần để dùng cho kết luận' }),
  // ── Bữa ăn ──
  d({ key: 'meal.maxItemKcal', group: 'Bữa ăn', type: 'int', default: 10000, min: 1000, max: 20000, unit: 'kcal', description: 'Calo tối đa một món trong bữa' }),
  d({ key: 'meal.maxMealKcal', group: 'Bữa ăn', type: 'int', default: 15000, min: 1000, max: 30000, unit: 'kcal', description: 'Calo tối đa một bữa' }),
  d({ key: 'meal.dedupeWindowSec', group: 'Bữa ăn', type: 'int', default: 120, min: 0, max: 600, unit: 'giây', description: 'Cửa sổ chống ghi trùng bữa' }),
  // ── Adaptive Engine ──
  d({ key: 'engine.autoCompleteMinMeals', group: 'Adaptive Engine', type: 'int', default: 2, min: 1, max: 6, unit: 'bữa', description: 'Số bữa tối thiểu để ngày tự động được coi là đầy đủ' }),
  d({ key: 'engine.autoCompleteMinPctTarget', group: 'Adaptive Engine', type: 'int', default: 60, min: 30, max: 100, unit: '%', description: 'Mức % mục tiêu calo tối thiểu để ngày tự động được coi là đầy đủ' }),
  // ── Thực phẩm ──
  d({ key: 'food.maxPendingSubmissions', group: 'Thực phẩm', type: 'int', default: 5, min: 1, max: 50, unit: 'món', description: 'Số món chờ duyệt tối đa của một người dùng' }),
  d({ key: 'food.duplicateSimilarity', group: 'Thực phẩm', type: 'float', default: 0.8, min: 0.5, max: 1, description: 'Độ tương đồng tên để gắn cờ nghi trùng khi gửi món' }),
  d({ key: 'food.searchSimilarityMin', group: 'Thực phẩm', type: 'float', default: 0.6, min: 0.3, max: 0.95, description: 'Độ tương đồng tối thiểu để món gần giống vẫn hiện khi tìm' }),
  d({ key: 'food.atwaterWarnPct', group: 'Thực phẩm', type: 'float', default: 15, min: 5, max: 50, unit: '%', description: 'Lệch calo so với 4P+4C+9F để cảnh báo mềm' }),
  // ── Tập luyện ──
  d({ key: 'workout.abandonedSessionHours', group: 'Tập luyện', type: 'int', default: 12, min: 1, max: 72, unit: 'giờ', description: 'Phiên tập dở quá số giờ này thì hỏi lưu hay huỷ' }),
  // ── Quản trị ──
  d({ key: 'admin.maxGrantDays', group: 'Quản trị', type: 'int', default: 90, min: 1, max: 365, unit: 'ngày', description: 'Số ngày Premium tối đa cho một lần cấp tay' }),
  // ── Quyền dữ liệu ──
  d({ key: 'privacy.requestDueHours', group: 'Quyền dữ liệu', type: 'int', default: 72, min: 24, max: 720, unit: 'giờ', description: 'Hạn xử lý yêu cầu xuất/xoá dữ liệu kể từ lúc nhận (kiểm tra lại với quy định pháp luật hiện hành)' }),
  // ── Hệ thống ──
  d({ key: 'config.cacheSec', group: 'Hệ thống', type: 'int', default: 60, min: 5, max: 600, unit: 'giây', description: 'Thời gian bộ nhớ đệm tham số' }),
];

// ── MET theo loại tập (BR-10.5): sửa được ở web quản trị, chỉ áp cho buổi tập ghi sau đó ──
const WORKOUT_MET_DEFAULTS: Record<string, number> = {
  RUNNING: 9.8, CYCLING: 7.5, SWIMMING: 8.0, HIIT: 8.5, STRENGTH: 5.0, SPORTS: 7.0, WALKING: 3.8, YOGA: 2.8, CARDIO: 6.5, OTHER: 4.0,
};
for (const [category, met] of Object.entries(WORKOUT_MET_DEFAULTS)) {
  CONFIG_REGISTRY.push({
    key: `workout.met.${category}`, group: 'Tập luyện (MET)', type: 'float', default: met, min: 1.5, max: 18, unit: 'MET',
    description: `Hệ số MET của loại tập ${category}`,
  });
}

// ── Hạn mức gói Free/Premium (BR-16): đổi giữa ngày áp ngay cho lượt kế tiếp, số lượt đã dùng giữ nguyên ──
const QUOTA_DEFS: { key: string; label: string; free?: number; premium?: number; unit: string; max: number }[] = [
  { key: 'aiPhotoPerDay', label: 'Nhận diện món bằng ảnh', free: 5, premium: 30, unit: 'lượt/ngày', max: 500 },
  { key: 'menuScanPerDay', label: 'Quét thực đơn quán ăn', free: 1, premium: 5, unit: 'lượt/ngày', max: 100 },
  { key: 'suggestMealPerDay', label: 'AI gợi ý món', free: 2, premium: 20, unit: 'lượt/ngày', max: 200 },
  { key: 'barcodePerDay', label: 'Tra mã vạch', free: 5, premium: 200, unit: 'lượt/ngày', max: 2000 },
  { key: 'chatMessagesPerDay', label: 'Tin nhắn AI Coach (Free)', free: 10, unit: 'tin/ngày', max: 500 },
  { key: 'chatTokensPerDay', label: 'Token AI Coach (Premium)', premium: 50000, unit: 'token/ngày', max: 1_000_000 },
  { key: 'checkinPerMonth', label: 'Check-in (Free)', free: 1, unit: 'lần/tháng', max: 31 },
  { key: 'expenditureHistoryDays', label: 'Lịch sử Expenditure xem được (Free)', free: 7, unit: 'ngày', max: 365 },
  { key: 'chatHistoryDays', label: 'Lịch sử chat xem được', free: 3, premium: 7, unit: 'ngày', max: 30 },
  { key: 'planPreviewDays', label: 'Kế hoạch 30 ngày xem trước (Free)', free: 7, unit: 'ngày', max: 30 },
];
for (const q of QUOTA_DEFS) {
  for (const tier of ['free', 'premium'] as const) {
    const def = q[tier];
    if (def === undefined) continue;
    CONFIG_REGISTRY.push({
      key: `quota.${tier}.${q.key}`, group: 'Hạn mức gói', type: 'int', default: def, min: 0, max: q.max, unit: q.unit,
      description: `${q.label} (${tier === 'free' ? 'Free' : 'Premium'})`,
    });
  }
}
CONFIG_REGISTRY.push(
  { key: 'checkin.maintainToleranceKg', group: 'Check-in', type: 'float', default: 0.7, min: 0.2, max: 3, unit: 'kg', description: 'Dynamic Maintenance: chỉ chỉnh khi lệch cân đích quá ngưỡng này' },
  { key: 'checkin.maintainNudgePctPerWeek', group: 'Check-in', type: 'float', default: 0.15, min: 0.05, max: 0.5, unit: '%/tuần', description: 'Dynamic Maintenance: mức bù mỗi tuần theo % cân nặng' },
  { key: 'insight.plateauWeeklyRatioPct', group: 'Insight', type: 'float', default: 0.25, min: 0.05, max: 1, unit: '% cân/tuần', description: 'Dưới mức thay đổi này mỗi tuần thì coi là đi ngang' },
  { key: 'insight.goalDeviationRatioPct', group: 'Insight', type: 'int', default: 50, min: 20, max: 90, unit: '%', description: 'Lệch quá % tốc độ mục tiêu thì cảnh báo' },
  { key: 'payments.orderTtlMin', group: 'Thanh toán', type: 'int', default: 30, min: 5, max: 240, unit: 'phút', description: 'Thời hạn đơn chuyển khoản QR' },
);

export const CONFIG_BY_KEY = new Map(CONFIG_REGISTRY.map((c) => [c.key, c]));

/** Ràng buộc chéo giữa các tham số, kiểm trên bộ giá trị SAU khi sửa (BR-19.2 điều 3). */
export interface ConfigConstraint {
  message: string;
  ok: (get: (key: string) => number) => boolean;
}

export const CONFIG_CONSTRAINTS: ConfigConstraint[] = [
  {
    message: 'Calo tối đa một món (meal.maxItemKcal) không được lớn hơn calo tối đa một bữa (meal.maxMealKcal)',
    ok: (g) => g('meal.maxItemKcal') <= g('meal.maxMealKcal'),
  },
  {
    message: 'Sàn calo nam (nutrition.calorieFloorMale) không được thấp hơn sàn calo nữ (nutrition.calorieFloorFemale)',
    ok: (g) => g('nutrition.calorieFloorMale') >= g('nutrition.calorieFloorFemale'),
  },
  {
    message: 'Mức cộng năng lượng khi cho con bú không được thấp hơn khi mang thai',
    ok: (g) => g('nutrition.lactationEnergyAddKcal') >= g('nutrition.pregnancyEnergyAddKcal'),
  },
];

/** Kiểm tra một giá trị theo định nghĩa; trả giá trị đã chuẩn hoá hoặc thông báo lỗi. */
export function validateConfigValue(def: ConfigDef, raw: unknown): { value?: number | boolean; error?: string } {
  if (def.type === 'bool') {
    if (typeof raw !== 'boolean') return { error: `${def.key} phải là true/false` };
    return { value: raw };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: `${def.key} phải là số` };
  if (def.type === 'int' && !Number.isInteger(raw)) return { error: `${def.key} phải là số nguyên` };
  if (def.min !== undefined && raw < def.min) return { error: `${def.key} không được nhỏ hơn ${def.min}${def.unit ? ' ' + def.unit : ''}` };
  if (def.max !== undefined && raw > def.max) return { error: `${def.key} không được lớn hơn ${def.max}${def.unit ? ' ' + def.unit : ''}` };
  return { value: raw };
}

CONFIG_CONSTRAINTS.push({
  message: 'Hạn mức Premium không được thấp hơn hạn mức Free (quota.premium.* ≥ quota.free.*)',
  ok: (g) =>
    ['aiPhotoPerDay', 'menuScanPerDay', 'suggestMealPerDay', 'barcodePerDay', 'chatHistoryDays'].every(
      (k) => g(`quota.premium.${k}`) >= g(`quota.free.${k}`),
    ),
});
