import { normalizeName } from './food-matcher';

/**
 * Chế độ an toàn của AI Chat (BR-11.6). Kiểm tra TRƯỚC khi gọi AI: gặp chủ đề rủi ro hoặc người dùng dưới 18 tuổi /
 * đang mang thai hỏi chủ đề nhạy cảm thì trả văn bản cố định khuyên gặp chuyên gia, không gọi AI (tiết kiệm token,
 * tránh để AI tư vấn sai). Hàm thuần để kiểm thử không cần AI.
 */
export type SafetyFlag =
  | 'EXTREME_FASTING'
  | 'PURGING'
  | 'BELOW_CALORIE_FLOOR'
  | 'EXTREME_WEIGHT_LOSS'
  | 'WEIGHT_LOSS_DRUGS'
  | 'MINOR_RESTRICTED'
  | 'PREGNANCY_RESTRICTED';

export type SafetyAudience = 'GENERAL' | 'MINOR' | 'PREGNANT';

export interface SafetyProfile {
  dateOfBirth?: Date | string | null;
  pregnancyStatus?: string | null;
}

/** Người dùng dưới 18 tuổi hoặc đang mang thai / cho con bú thì ở chế độ an toàn. */
export function safetyAudience(profile: SafetyProfile, now: Date = new Date()): SafetyAudience {
  if (profile.pregnancyStatus && profile.pregnancyStatus !== 'NONE') return 'PREGNANT';
  if (profile.dateOfBirth) {
    const dob = new Date(profile.dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      let age = now.getUTCFullYear() - dob.getUTCFullYear();
      const beforeBirthday =
        now.getUTCMonth() < dob.getUTCMonth() ||
        (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
      if (beforeBirthday) age -= 1;
      if (age < 18) return 'MINOR';
    }
  }
  return 'GENERAL';
}

const CALORIE_FLOOR = 1200;
const MAX_SAFE_KG_PER_WEEK = 1.5;
const NUMBER_WORDS: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, nam: 5, sau: 6, bay: 7 };

const num = (s: string): number => (NUMBER_WORDS[s] ?? Number(s)) || 0;

/** Phát hiện chủ đề rủi ro cao trong câu hỏi (so khớp không dấu, không phân biệt hoa thường). */
export function detectRiskTopic(message: string): SafetyFlag | null {
  const t = normalizeName(message);
  if (!t) return null;

  // Nôn/xổ sau ăn, ép nôn, thuốc xổ để giảm cân
  if (/\b(non|oi) (sau|xong|lai|ra)\b.*\ban\b|\ban\b.*\b(roi|xong) (non|oi)\b|\ban (xong|roi)\b.{0,40}(?<!buon )\bnon\b|\bep non\b|\bgay non\b|\bthuoc (xo|nhuan trang)\b|\bcatharsis\b/.test(t)) {
    return 'PURGING';
  }

  // Thuốc / thuốc tiêm giảm cân
  if (/\bthuoc (giam can|giam beo|an thanh|kich thich)\b|\btiem giam can\b|\b(semaglutide|ozempic|wegovy|mounjaro|orlistat|phentermine|liraglutide)\b/.test(t)) {
    return 'WEIGHT_LOSS_DRUGS';
  }

  // Nhịn ăn cực đoan (nhịn ăn gián đoạn 16:8 là hợp lệ nên không bắt)
  if (/\bnhin (an|doi) (hoan toan|cuc doan|nhieu ngay|lien tuc|ca tuan)\b|\bnhin (an|doi) \d+ (ngay|bua lien)\b|\bkhong an gi (trong|ca|suot)\b|\bdetox\b|\bnhin an de giam can nhanh\b/.test(t)) {
    return 'EXTREME_FASTING';
  }

  // Mục tiêu calo dưới sàn an toàn (ví dụ "ăn 800 calo mỗi ngày")
  // Sàn 1200 kcal áp dụng cho tổng calo CẢ NGÀY. Câu hỏi về MỘT bữa/món/phần ("bữa tối dưới 500 kcal") là hợp lệ,
  // trừ khi nói rõ phạm vi ngày/tuần/tháng.
  const cal = t.match(/\b(?:an|nap|muc tieu|chi an|duoi)\D{0,18}?(\d{3,4})\s*(?:kcal|calo|cal)\b/);
  const singleMealScope = /\b(bua|mon|phan an|khau phan|an vat|an nhe|snack)\b/.test(t) && !/\b(ngay|tuan|thang)\b/.test(t);
  if (cal && !singleMealScope && Number(cal[1]) < CALORIE_FLOOR && Number(cal[1]) >= 100) return 'BELOW_CALORIE_FLOOR';

  // Giảm cân quá nhanh (ví dụ "giảm 5kg trong 1 tuần")
  const fast = t.match(/\bgiam (\d+(?:[.,]\d+)?) ?kg trong (\d+|mot|hai|ba|bon|nam|sau|bay) (ngay|tuan)\b/);
  if (fast) {
    const kg = Number(fast[1].replace(',', '.'));
    const span = num(fast[2]);
    const weeks = fast[3] === 'tuan' ? span : span / 7;
    if (weeks > 0 && kg / weeks > MAX_SAFE_KG_PER_WEEK) return 'EXTREME_WEIGHT_LOSS';
  }
  return null;
}

/** Chủ đề nhạy cảm riêng với người dưới 18 tuổi hoặc đang mang thai: không tư vấn chi tiết. */
export function detectRestrictedTopic(message: string): boolean {
  const t = normalizeName(message);
  return /\b(giam can|giam beo|an kieng|thieu hut calo|it calo|han che (an|calo)|nhin an|giam \d+ ?kg|thuc pham chuc nang|thuoc bo|vien uong|whey|collagen|fat burner|dot mo)\b/.test(t);
}

export interface SafetyDecision {
  /** Có chặn không: true thì trả `reply` cố định, không gọi AI. */
  blocked: boolean;
  flag: SafetyFlag | null;
  reply: string | null;
}

const REPLIES = {
  RISK: 'Chủ đề này có thể ảnh hưởng nghiêm trọng đến sức khoẻ nên mình không tư vấn chi tiết. Bạn hãy trao đổi với bác sĩ hoặc chuyên gia dinh dưỡng để được hướng dẫn phù hợp với cơ thể của bạn. Nếu bạn đang thấy khó khăn hay lo lắng về việc ăn uống, hãy chia sẻ với người thân tin cậy hoặc đến cơ sở y tế gần nhất. Trong trường hợp khẩn cấp, hãy gọi 115.',
  MINOR:
    'Ở độ tuổi của bạn, cơ thể vẫn đang phát triển nên NutriWise không đưa lời khuyên về giảm cân hay hạn chế ăn uống. Điều quan trọng là ăn đủ bữa, đủ chất và vận động vui khoẻ. Bạn hãy trao đổi với bố mẹ hoặc người giám hộ, và hỏi bác sĩ hoặc chuyên gia dinh dưỡng nếu có băn khoăn về cân nặng.',
  PREGNANT:
    'Khi đang mang thai hoặc cho con bú, nhu cầu dinh dưỡng của bạn rất đặc biệt nên NutriWise không đưa lời khuyên về giảm cân, hạn chế ăn hay thực phẩm bổ sung. Bạn hãy hỏi bác sĩ sản khoa hoặc chuyên gia dinh dưỡng để có chế độ ăn an toàn cho cả mẹ và bé.',
} as const;

/** Quyết định có chặn câu hỏi không và trả văn bản cố định nào. */
export function evaluateChatSafety(
  message: string,
  profile: SafetyProfile,
  now: Date = new Date(),
): SafetyDecision {
  const risk = detectRiskTopic(message);
  if (risk) return { blocked: true, flag: risk, reply: REPLIES.RISK };

  const audience = safetyAudience(profile, now);
  if (audience !== 'GENERAL' && detectRestrictedTopic(message)) {
    return audience === 'MINOR'
      ? { blocked: true, flag: 'MINOR_RESTRICTED', reply: REPLIES.MINOR }
      : { blocked: true, flag: 'PREGNANCY_RESTRICTED', reply: REPLIES.PREGNANT };
  }
  return { blocked: false, flag: null, reply: null };
}

/** Chỉ dẫn thêm cho AI khi người dùng ở chế độ an toàn nhưng câu hỏi không bị chặn (hỏi ăn uống thông thường). */
export function safetyPromptBlock(audience: SafetyAudience): string {
  if (audience === 'GENERAL') return '';
  const who = audience === 'MINOR' ? 'dưới 18 tuổi' : 'đang mang thai hoặc cho con bú';
  return `
*** CHẾ ĐỘ AN TOÀN: người dùng ${who}. ***
- Chỉ tư vấn ăn uống cân bằng, đủ bữa, đủ chất.
- TUYỆT ĐỐI KHÔNG khuyên giảm cân, hạn chế calo, ăn kiêng, nhịn ăn, thực phẩm chức năng hay thuốc.
- Có băn khoăn về sức khoẻ thì khuyên gặp bác sĩ hoặc chuyên gia dinh dưỡng.
`;
}
