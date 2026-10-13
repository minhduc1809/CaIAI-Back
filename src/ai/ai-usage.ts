import { AsyncLocalStorage } from 'async_hooks';

/**
 * Ghi nhận mức dùng AI THẬT theo người dùng (BR-15.5): số token lấy từ `usageMetadata` của Gemini, độ trễ và kết quả
 * của từng lời gọi. Tuyệt đối không ghi nội dung lời nhắc hay ảnh.
 */
export interface AiUsageContext {
  userId: string;
  feature: string;
}

/** Ngữ cảnh "ai đang dùng tính năng nào", đặt ở các hàm công khai để mọi lời gọi Gemini bên trong tự được gán đúng. */
export const aiUsageContext = new AsyncLocalStorage<AiUsageContext>();

export function withAiUsage<T>(userId: string, feature: string, fn: () => Promise<T>): Promise<T> {
  return aiUsageContext.run({ userId, feature }, fn);
}

/**
 * Chi phí USD của một lời gọi theo bảng giá mỗi triệu token. Bảng giá đặt bằng biến môi trường vì giá thay đổi theo
 * model và thời điểm: AI_PRICE_INPUT_USD_PER_MTOK, AI_PRICE_OUTPUT_USD_PER_MTOK. Mặc định là mức cao của dòng Flash để
 * không đánh giá thấp chi phí; cần đặt đúng giá hiện hành của model đang dùng trước khi dựa vào báo cáo.
 */
export function computeCostUsd(
  promptTokens: number,
  outputTokens: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const price = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && v !== undefined && v !== '' ? n : d;
  };
  const input = price(env.AI_PRICE_INPUT_USD_PER_MTOK, 0.3);
  const output = price(env.AI_PRICE_OUTPUT_USD_PER_MTOK, 2.5);
  const cost = (promptTokens * input + outputTokens * output) / 1_000_000;
  return Math.round(cost * 1e8) / 1e8;
}

/** Thứ hạng phần trăm kiểu "nearest-rank": p50 của [1,2,3,4] là 2. Rỗng thì trả 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export interface UserCostSummary {
  users: number;
  avgCostUsd: number;
  p50: number;
  p75: number;
  p95: number;
  max: number;
}

/** Tóm tắt chi phí AI theo tháng của từng người dùng thành các nhóm nhẹ (p50), trung bình (p75), nặng (p95). */
export function summarizeUserCosts(costs: number[]): UserCostSummary {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  if (costs.length === 0) return { users: 0, avgCostUsd: 0, p50: 0, p75: 0, p95: 0, max: 0 };
  return {
    users: costs.length,
    avgCostUsd: round(costs.reduce((a, b) => a + b, 0) / costs.length),
    p50: round(percentile(costs, 50)),
    p75: round(percentile(costs, 75)),
    p95: round(percentile(costs, 95)),
    max: round(Math.max(...costs)),
  };
}

interface UsagePrisma {
  apiUsageLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
}

/**
 * Bọc một model Gemini: mỗi `generateContent` được ghi số token thật, độ trễ và kết quả (OK/ERROR) vào ApiUsageLog
 * cho người dùng trong ngữ cảnh hiện tại. Không có ngữ cảnh (không biết của ai) thì không ghi. Lỗi ghi log không bao
 * giờ làm hỏng lời gọi AI.
 */
export function trackModel<M extends { generateContent: (content: any) => Promise<any> }>(
  prisma: UsagePrisma,
  model: M,
  modelName: string,
  onLogError?: (message: string) => void,
): M {
  const record = async (data: Record<string, unknown>) => {
    try {
      await prisma.apiUsageLog.create({ data });
    } catch (e) {
      onLogError?.(`Could not log AI usage: ${(e as Error).message}`);
    }
  };
  const wrapped = {
    ...model,
    generateContent: async (content: any) => {
      const ctx = aiUsageContext.getStore();
      const started = Date.now();
      try {
        const response = await model.generateContent(content);
        if (ctx) {
          const usage = response?.response?.usageMetadata;
          const known = typeof usage?.promptTokenCount === 'number' || typeof usage?.candidatesTokenCount === 'number';
          const promptTokens = Number(usage?.promptTokenCount) || 0;
          const outputTokens = Number(usage?.candidatesTokenCount) || 0;
          await record({
            userId: ctx.userId,
            feature: ctx.feature,
            model: modelName,
            promptTokens,
            outputTokens,
            costUsd: computeCostUsd(promptTokens, outputTokens),
            latencyMs: Date.now() - started,
            status: known ? 'OK' : 'OK_NO_USAGE',
          });
        }
        return response;
      } catch (err) {
        if (ctx) {
          await record({
            userId: ctx.userId,
            feature: ctx.feature,
            model: modelName,
            promptTokens: 0,
            outputTokens: 0,
            costUsd: 0,
            latencyMs: Date.now() - started,
            status: 'ERROR',
          });
        }
        throw err;
      }
    },
  };
  return wrapped as M;
}
