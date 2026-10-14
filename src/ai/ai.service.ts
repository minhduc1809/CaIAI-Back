import { ATTEMPT_TIMEOUT_MS, modelChain, parseFallbackModels, withModelFallback } from './gemini-resilience';
import { buildPremiumContext } from './chat-context';
import { isPremiumNow } from '../billing/entitlement.util';
import { ProfileIncompleteException } from '../common/errors/profile-incomplete.exception';
import { getPlanLimits, isFreeTierLimited } from '../billing/entitlement.util';
import { PLAN_LIMITS } from '../billing/billing.constants';
import { refundDaily, reserveDaily } from '../billing/daily-counter';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import {
  Injectable,
  Logger,
  Optional,
  HttpException,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { MealsService } from '../meals/meals.service';
import {
  getDayBounds,
  keyToDate,
  resolveTimezone as resolveZone,
  todayKey,
} from '../common/utils/date-zone.util';
import {
  SafeFood,
  detectTextViolations,
  getAllowedFoods,
} from '../recommendations/food-safety';
import {
  FoodItemRecognitionDto,
  FoodRecognitionResultDto,
} from './dto/food-recognition-response.dto';
import {
  ALTERNATIVES_COUNT,
  DEFAULT_MATCH_THRESHOLD,
  FoodMatch,
  FoodMatcher,
  atwaterCheck,
  portionFactor,
} from './food-matcher';
import {
  DetectedDish,
  DishEstimate,
  MAX_DISHES_PER_PHOTO,
  parseDetectedDishes,
  parseEstimates,
} from './vision-schema';
import {
  DEFAULT_MAX_SUGGESTIONS,
  MAX_MENU_ITEMS,
  ParsedMenu,
  parseMenu,
  rankMenuItems,
} from './menu-schema';
import { AiQuotaResponseDto } from './dto/ai-quota-response.dto';
import {
  ChatQuotaInfoDto,
  ChatResponseDto,
  ChatHistoryResponseDto,
  ChatMessageDto,
} from './dto/chat-history-response.dto';
import {
  SuggestMealResponseDto,
  SuggestedMealItemDto,
  NutritionGapDto,
} from './dto/suggest-meal-response.dto';
import { ScanMenuResponseDto, MenuItemDto } from './dto/menu-scan.dto';
import { AiHealthMonitor } from './ai-health.monitor';
import { trackModel, withAiUsage } from './ai-usage';
import { FoodCatalogService } from '../food-catalog/food-catalog.service';
import { evaluateChatSafety, safetyAudience, safetyPromptBlock } from './chat-safety';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "1.5 tô", "250 g": khẩu phần AI nhìn thấy, hiển thị cho người dùng. */
function portionLabel(p: { amount: number; unit: string }): string {
  const amount = Number.isInteger(p.amount)
    ? String(p.amount)
    : String(round1(p.amount));
  return `${amount} ${p.unit}`;
}

interface ChatReservation {
  date: string;
  /** true: tin nhắn đã được đếm lúc giữ chỗ (Free), không cộng lại khi xong. */
  countedMessage: boolean;
}

interface PhotoReservation {
  usedQuotaType: 'FREE' | 'PURCHASED';
  /** Ngày giữ chỗ (YYYY-MM-DD theo múi giờ user) — dùng khi hoàn lượt. */
  date: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private readonly modelName: string;
  private readonly chatModelName: string;
  private readonly visionModelName: string;
  private readonly fallbackModels: string[];
  private aiHealth?: AiHealthMonitor;

  /** Model Gemini đã bọc để ghi số token thật, độ trễ và kết quả của từng lời gọi (BR-15.5). */
  private model(config: { model: string; generationConfig?: any }) {
    const chain = modelChain(config.model, this.fallbackModels);
    return {
      generateContent: (content: any) =>
        withModelFallback(
          chain,
          (name) =>
            trackModel(
              this.prisma as any,
              this.genAI!.getGenerativeModel({ ...config, model: name }, { timeout: ATTEMPT_TIMEOUT_MS }),
              name,
              (m) => this.logger.debug(m),
            ).generateContent(content),
          (from, err) =>
            this.logger.warn(`Gemini ${from} tạm thời lỗi (${(err as Error).message?.slice(0, 80)}), chuyển mô hình dự phòng`),
        ),
    } as { generateContent: (content: any) => Promise<any> };
  }
  private readonly staticMatcher = new FoodMatcher();

  /** Bộ khớp tên món từ kho trong cơ sở dữ liệu (BR-08.1); không có kho thì dùng kho trong code. */
  private async foodMatcher(): Promise<FoodMatcher> {
    return this.catalog ? this.catalog.getMatcher() : this.staticMatcher;
  }

  /** Món được phép gợi ý (đã lọc cứng dị ứng/chế độ ăn) từ kho hiện tại. */
  private async allowedFoods(rules: { dietType: string | null; allergies: string[] }) {
    return this.catalog ? this.catalog.getAllowedFoods(rules) : getAllowedFoods(rules);
  }

  /** Theo dõi tỉ lệ lỗi AI (BR-11.2); tạo khi cần dùng đầu tiên. */
  private get health(): AiHealthMonitor {
    return (this.aiHealth ??= new AiHealthMonitor((m) => this.logger.error(m)));
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mealsService: MealsService,
    @Optional() private readonly catalog?: FoodCatalogService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName =
      this.configService.get<string>('GEMINI_MODEL') || 'gemini-3.6-flash';
    this.chatModelName =
      this.configService.get<string>('GEMINI_CHAT_MODEL') ||
      this.configService.get<string>('GEMINI_MODEL') ||
      'gemini-3.5-flash-lite';
    this.visionModelName =
      this.configService.get<string>('GEMINI_VISION_MODEL') ||
      this.configService.get<string>('GEMINI_MODEL') ||
      'gemini-3.6-flash';

    this.fallbackModels = parseFallbackModels(this.configService.get<string>('GEMINI_FALLBACK_MODELS'));

    if (
      apiKey &&
      apiKey !== 'your_gemini_api_key_here' &&
      apiKey.trim() !== ''
    ) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
        this.logger.log(
          `Google Gemini AI initialized (Chat: ${this.chatModelName}, Vision: ${this.visionModelName})`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to initialize Google Gemini AI: ${err.message}. Using Smart Fallback.`,
        );
      }
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not configured or is default. Smart Fallback Engine will be active for development.',
      );
    }
  }

  // =========================================================================
  // PHẦN 1: QUẢN LÝ QUOTA & GÓI CHỤP ẢNH (FOOD RECOGNITION)
  // =========================================================================

  async getDailyPhotoQuota(userId: string): Promise<AiQuotaResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, purchasedAiQuota: true },
    });

    const timezone = this.resolveTimezone(user?.timezone);
    const { resetsAt } = this.getTimezoneDayBounds(timezone);

    const counter = await this.prisma.usageCounter.findUnique({
      where: { userId_date: { userId, date: this.getDateKey(timezone) } },
    });
    const freeUsedToday = counter?.aiPhoto ?? 0;

    const dailyFreeLimit = (await getPlanLimits(this.prisma, userId))
      .aiPhotoPerDay;
    const freeRemaining = Math.max(0, dailyFreeLimit - freeUsedToday);
    const purchasedCredits = Math.max(0, user?.purchasedAiQuota ?? 0);
    const totalRemaining = freeRemaining + purchasedCredits;

    return {
      feature: 'food_recognition',
      dailyFreeLimit,
      freeUsedToday,
      freeRemaining,
      purchasedCredits,
      totalRemaining,
      resetsAt: resetsAt.toISOString(),
    };
  }

  /**
   * BR-11.4: giữ chỗ 1 lượt chụp ảnh bằng MỘT câu lệnh UPDATE có điều kiện (`aiPhoto < limit`),
   * nên hai request đồng thời khi chỉ còn 1 lượt thì đúng 1 request giữ được chỗ, request kia nhận 429.
   * Ưu tiên lượt miễn phí trong ngày, hết thì trừ lượt mua thêm (cũng bằng UPDATE có điều kiện).
   * Nếu xử lý lỗi sau đó phải gọi refundPhotoQuota() để hoàn lượt.
   */
  private async reservePhotoQuota(userId: string): Promise<PhotoReservation> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const date = this.getDateKey(this.resolveTimezone(user?.timezone));

    await this.ensureUsageCounterRow(userId, date);
    const photoLimit = (await getPlanLimits(this.prisma, userId)).aiPhotoPerDay;

    const free = await this.prisma.usageCounter.updateMany({
      where: { userId, date, aiPhoto: { lt: photoLimit } },
      data: { aiPhoto: { increment: 1 } },
    });
    if (free.count === 1) {
      return { usedQuotaType: 'FREE', date };
    }

    const paid = await this.prisma.user.updateMany({
      where: { id: userId, purchasedAiQuota: { gt: 0 } },
      data: { purchasedAiQuota: { decrement: 1 } },
    });
    if (paid.count === 1) {
      return { usedQuotaType: 'PURCHASED', date };
    }

    const quota = await this.getDailyPhotoQuota(userId);
    throw new QuotaExceededException({
      feature: 'AI_FOOD_SCAN',
      limit: quota.dailyFreeLimit,
      used: quota.freeUsedToday,
      period: 'day',
      resetsAt: quota.resetsAt,
      premiumBenefit: `Mở Premium để có ${PLAN_LIMITS.PREMIUM.aiPhotoPerDay} lượt nhận diện mỗi ngày.`,
      isPremium: quota.dailyFreeLimit >= PLAN_LIMITS.PREMIUM.aiPhotoPerDay,
    });
  }

  /**
   * Giữ chỗ MỘT lượt cho tính năng đếm theo ngày (quét thực đơn, gợi ý món) bằng UPDATE có điều kiện. Hết lượt thì
   * ném QUOTA_EXCEEDED thống nhất. Xử lý thất bại sau đó phải gọi releaseDaily() để hoàn lượt.
   */
  private async reserveFeature(
    userId: string,
    feature: 'AI_MENU_SCAN' | 'AI_SUGGEST_MEAL',
  ): Promise<{ date: string; column: 'menuScans' | 'suggestMeals' }> {
    const limits = await getPlanLimits(this.prisma, userId);
    const premium = limits.aiPhotoPerDay >= PLAN_LIMITS.PREMIUM.aiPhotoPerDay;
    const cfg =
      feature === 'AI_MENU_SCAN'
        ? {
            column: 'menuScans' as const,
            limit: limits.menuScanPerDay,
            benefit: `Mở Premium để quét thực đơn ${PLAN_LIMITS.PREMIUM.menuScanPerDay} lần mỗi ngày.`,
          }
        : {
            column: 'suggestMeals' as const,
            limit: limits.suggestMealPerDay,
            benefit: `Mở Premium để có ${PLAN_LIMITS.PREMIUM.suggestMealPerDay} lượt gợi ý món mỗi ngày.`,
          };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = this.resolveTimezone(user?.timezone);
    const date = this.getDateKey(timezone);

    const ok = await reserveDaily(
      this.prisma,
      userId,
      date,
      cfg.column,
      cfg.limit,
    );
    if (!ok) {
      throw new QuotaExceededException({
        feature,
        limit: cfg.limit,
        used: cfg.limit,
        period: 'day',
        resetsAt: this.getTimezoneDayBounds(timezone).resetsAt,
        premiumBenefit: cfg.benefit,
        isPremium: premium,
      });
    }
    return { date, column: cfg.column };
  }

  private async releaseDaily(
    userId: string,
    r: { date: string; column: 'menuScans' | 'suggestMeals' },
  ) {
    await refundDaily(this.prisma, userId, r.date, r.column);
  }

  private async ensureUsageCounterRow(userId: string, date: string) {
    try {
      await this.prisma.usageCounter.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {},
      });
    } catch (e) {
      // Request khác vừa tạo dòng này cùng lúc (vi phạm unique) — dòng đã tồn tại, bỏ qua.
      if ((e as { code?: string })?.code !== 'P2002') throw e;
    }
  }

  /** Hoàn lại lượt đã giữ chỗ khi xử lý thất bại (NOT_FOOD, ảnh hỏng, AI không khả dụng...). */
  private async refundPhotoQuota(userId: string, r: PhotoReservation) {
    try {
      if (r.usedQuotaType === 'FREE') {
        await this.prisma.usageCounter.updateMany({
          where: { userId, date: r.date, aiPhoto: { gt: 0 } },
          data: { aiPhoto: { decrement: 1 } },
        });
      } else {
        await this.prisma.user.update({
          where: { id: userId },
          data: { purchasedAiQuota: { increment: 1 } },
        });
      }
    } catch (e) {
      this.logger.error(
        `Không hoàn được lượt chụp ảnh cho user ${userId}: ${(e as Error).message}`,
      );
    }
  }

  /** Ghi log chi phí cho một lượt đã xử lý thành công và trả lại hạn mức còn lại. */
  private async finalizePhotoUsage(
    userId: string,
    r: PhotoReservation,
    tokens: { promptTokens: number; outputTokens: number; costUsd: number },
  ): Promise<{
    freeRemaining: number;
    purchasedCredits: number;
    totalRemaining: number;
  }> {
    const q = await this.getDailyPhotoQuota(userId);
    return {
      freeRemaining: q.freeRemaining,
      purchasedCredits: q.purchasedCredits,
      totalRemaining: q.totalRemaining,
    };
  }

  /** BR-11.2: lỗi AI thì báo lỗi, không trả dữ liệu dinh dưỡng giả. */
  private aiUnavailable(reason: string): ServiceUnavailableException {
    this.logger.error(`AI_UNAVAILABLE: ${reason}`);
    this.health.recordFailure();
    return new ServiceUnavailableException({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'AI_UNAVAILABLE',
      message:
        'AI tạm thời không khả dụng. Bạn có thể tìm món thủ công trong kho món.',
      error: 'Service Unavailable',
    });
  }

  // =========================================================================
  // PHẦN 2: HẠN MỨC AI COACH THEO GÓI (Free / Premium)
  // =========================================================================

  /**
   * Hạn mức AI Coach theo gói (đặc tả Free/Premium): Free 10 tin nhắn/ngày; Premium 50.000 token/ngày. Không còn
   * các gói Plus/Pro/Max. Premium không phải "không giới hạn": backend vẫn giữ hạn mức để chống lạm dụng.
   */
  async getDailyChatQuota(userId: string): Promise<ChatQuotaInfoDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { resetsAt } = this.getTimezoneDayBounds(timezone);

    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        userId_date: {
          userId,
          date: this.getDateKey(this.resolveTimezone(timezone)),
        },
      },
    });

    const limits = await getPlanLimits(this.prisma, userId);
    const byTokens = limits.chatTokensPerDay !== null;
    const unit: 'MESSAGES' | 'TOKENS' = byTokens ? 'TOKENS' : 'MESSAGES';
    const limit =
      (byTokens ? limits.chatTokensPerDay : limits.chatMessagesPerDay) ?? 0;
    const used = byTokens
      ? (counter?.chatTokens ?? 0)
      : (counter?.chatMessages ?? 0);

    const remaining = Math.max(0, limit - used);
    const remainingPercent =
      limit > 0
        ? Math.min(100, Math.max(0, Math.round((remaining / limit) * 100)))
        : 0;
    const hasQuota = remaining > 0;

    let status: 'COMFORTABLE' | 'GOOD' | 'LOW' | 'EXHAUSTED' = 'COMFORTABLE';
    let statusMessage = 'Hạn mức trò chuyện rất dồi dào';
    if (!hasQuota) {
      status = 'EXHAUSTED';
      statusMessage = 'Đã sử dụng hết lượt trò chuyện hôm nay';
    } else if (remainingPercent <= 20) {
      status = 'LOW';
      statusMessage = 'Sắp hết lượt trò chuyện hôm nay';
    } else if (remainingPercent <= 60) {
      status = 'GOOD';
      statusMessage = 'Hạn mức trò chuyện ổn định';
    }

    return {
      hasQuota,
      currentTier: byTokens ? 'PREMIUM' : 'FREE',
      tierName: byTokens ? 'Gói Premium' : 'Gói Miễn phí',
      remainingPercent,
      status,
      statusMessage,
      resetsAt: resetsAt.toISOString(),
      unit,
      limit,
      used,
    };
  }

  /**
   * Giữ chỗ trước khi trả lời. Free đếm theo tin nhắn nên giữ chỗ NGUYÊN TỬ (UPDATE có điều kiện), hai tin đồng
   * thời khi chỉ còn một lượt thì đúng một tin được gửi. Premium đếm theo token: dung lượng chỉ biết sau khi AI
   * trả lời nên chỉ kiểm tra còn hạn mức, rồi cộng token sau khi xong.
   */
  private async reserveChat(userId: string): Promise<ChatReservation> {
    const limits = await getPlanLimits(this.prisma, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const timezone = this.resolveTimezone(user?.timezone);
    const date = this.getDateKey(timezone);

    if (limits.chatMessagesPerDay !== null) {
      const ok = await reserveDaily(
        this.prisma,
        userId,
        date,
        'chatMessages',
        limits.chatMessagesPerDay,
      );
      if (!ok) {
        throw new QuotaExceededException({
          feature: 'AI_COACH',
          limit: limits.chatMessagesPerDay,
          used: limits.chatMessagesPerDay,
          period: 'day',
          resetsAt: this.getTimezoneDayBounds(timezone).resetsAt,
          premiumBenefit: `Premium có hạn mức trò chuyện ${PLAN_LIMITS.PREMIUM.chatTokensPerDay?.toLocaleString('vi-VN')} token mỗi ngày.`,
          isPremium: false,
        });
      }
      return { date, countedMessage: true };
    }

    const quota = await this.getDailyChatQuota(userId);
    if (!quota.hasQuota) {
      throw new QuotaExceededException({
        feature: 'AI_COACH',
        limit: quota.limit,
        used: quota.used,
        period: 'day',
        unit: 'token',
        resetsAt: quota.resetsAt,
        isPremium: true,
      });
    }
    return { date, countedMessage: false };
  }

  /** Hoàn lại tin nhắn đã giữ chỗ khi xử lý thất bại. */
  private async releaseChat(userId: string, r: ChatReservation) {
    if (r.countedMessage)
      await refundDaily(this.prisma, userId, r.date, 'chatMessages');
  }

  /**
   * Cộng token của tin nhắn đã xử lý vào bộ đếm ngày bằng `increment` NGUYÊN TỬ (không đọc rồi ghi), nên nhiều tin
   * nhắn đồng thời không làm mất lượt tính. Tin nhắn của Free đã được tính lúc giữ chỗ nên không cộng lại.
   */
  private async deductChatQuotaAfterSuccess(
    userId: string,
    reservation: ChatReservation,
    tokens: { promptTokens: number; outputTokens: number; costUsd: number },
  ): Promise<ChatQuotaInfoDto> {
    const totalTokensConsumed = Math.max(
      0,
      Math.round(tokens.promptTokens + tokens.outputTokens),
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    const date = this.getDateKey(this.resolveTimezone(user?.timezone));
    await this.ensureUsageCounterRow(userId, date);

    await this.prisma.usageCounter.update({
      where: { userId_date: { userId, date } },
      data: {
        chatTokens: { increment: totalTokensConsumed },
        ...(reservation.countedMessage
          ? {}
          : { chatMessages: { increment: 1 } }),
      },
    });

    return this.getDailyChatQuota(userId);
  }

  // =========================================================================
  // PHẦN 3: LỊCH SỬ CHAT 7 NGÀY (7-DAY RETENTION & CONTEXT SYNC)
  // =========================================================================

  /**
   * Tự động xóa các tin nhắn cũ hơn 7 ngày để tối ưu lưu trữ DB
   */
  private async cleanupOldChatMessages(userId: string): Promise<void> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await this.prisma.aiMessage.deleteMany({
        where: {
          userId,
          createdAt: { lt: sevenDaysAgo },
        },
      });
    } catch (e) {
      this.logger.warn(
        `Could not cleanup old chat messages for user ${userId}: ${e.message}`,
      );
    }
  }

  /**
   * Lấy lịch sử hội thoại trong 7 ngày gần nhất
   */
  async getChatHistory(userId: string): Promise<ChatHistoryResponseDto> {
    await this.cleanupOldChatMessages(userId);

    // Lưu 7 ngày cho mọi người; Free chỉ được xem 3 ngày gần nhất (không xoá dữ liệu để nâng cấp xong xem lại được)
    const visibleDays = (await isFreeTierLimited(this.prisma, userId))
      ? PLAN_LIMITS.FREE.chatHistoryDays
      : PLAN_LIMITS.PREMIUM.chatHistoryDays;
    const since = new Date(Date.now() - visibleDays * 24 * 60 * 60 * 1000);
    const messages = await this.prisma.aiMessage.findMany({
      where: {
        userId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
    });

    const quota = await this.getDailyChatQuota(userId);

    return {
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        ...(m.safetyFlag ? { safetyFlag: m.safetyFlag } : {}),
        createdAt: m.createdAt,
      })),
      totalMessages: messages.length,
      quota,
    };
  }

  /**
   * Xóa toàn bộ lịch sử trò chuyện của người dùng
   */
  async clearChatHistory(
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.prisma.aiMessage.deleteMany({
      where: { userId },
    });
    return {
      success: true,
      message: 'Đã xóa toàn bộ lịch sử trò chuyện thành công.',
    };
  }

  // =========================================================================
  // PHẦN 4: AI CHATBOT TOÀN DIỆN (CONTEXT BỮA ĂN HÔM NAY + TOPIC GUARDRAILS)
  // =========================================================================

  async chat(userId: string, userMessage: string): Promise<ChatResponseDto> {
    return withAiUsage(userId, 'chat_coach', () =>
      this.chatWithQuota(userId, userMessage),
    );
  }

  private async chatWithQuota(
    userId: string,
    userMessage: string,
  ): Promise<ChatResponseDto> {
    // 1. Giữ chỗ hạn mức (Free: 10 tin/ngày; Premium: 50.000 token/ngày); lỗi bất kỳ sau đó đều hoàn lượt
    const reservation = await this.reserveChat(userId);
    try {
      return await this.chatInner(userId, userMessage, reservation);
    } catch (err) {
      await this.releaseChat(userId, reservation);
      throw err;
    }
  }

  /** Ngữ cảnh chi tiết cho Premium; chuỗi rỗng nếu là Free hoặc không lấy được dữ liệu. */
  private async premiumChatContext(userId: string, adaptiveExpenditure: number | null): Promise<string> {
    try {
      if (!(await isPremiumNow(this.prisma as any, userId))) return '';
      const since = new Date(Date.now() - 7 * 86_400_000);
      const [weights, lastCheckin, workouts] = await Promise.all([
        this.prisma.weightLog.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 14, select: { weightKg: true, date: true } }),
        this.prisma.checkIn.findFirst({
          where: { userId },
          orderBy: { weekEndDate: 'desc' },
          select: { weekEndDate: true, status: true, compliancePct: true, avgDailyCalories: true, currentCalorieTarget: true, proposedCalorieTarget: true },
        }),
        this.prisma.workoutLog.findMany({
          where: { userId, createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { name: true, durationMinutes: true, caloriesBurned: true },
        }),
      ]);
      return buildPremiumContext({ weights, adaptiveExpenditure, lastCheckin, workouts });
    } catch (e) {
      this.logger.warn(`Không lấy được ngữ cảnh Premium cho chat: ${(e as Error).message}`);
      return '';
    }
  }

  private async chatInner(
    userId: string,
    userMessage: string,
    reservation: ChatReservation,
  ): Promise<ChatResponseDto> {
    // 2. Dọn dẹp tin nhắn cũ hơn 7 ngày
    await this.cleanupOldChatMessages(userId);

    // 3. Lấy profile và mục tiêu của người dùng
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        gender: true,
        weightKg: true,
        targetWeightKg: true,
        goal: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
        timezone: true,
        allergies: true,
        dateOfBirth: true,
        pregnancyStatus: true,
        adaptiveExpenditure: true,
      },
    });

    // BR-11.6: chủ đề rủi ro, hoặc người dưới 18 tuổi/đang mang thai hỏi chủ đề nhạy cảm → trả văn bản cố định
    // khuyên gặp chuyên gia. KHÔNG gọi AI và KHÔNG tính lượt (hoàn lại lượt đã giữ chỗ).
    const safety = evaluateChatSafety(userMessage, {
      dateOfBirth: user?.dateOfBirth,
      pregnancyStatus: user?.pregnancyStatus,
    });
    if (safety.blocked && safety.reply && safety.flag) {
      try {
        await this.prisma.aiMessage.createMany({
          data: [
            { userId, role: 'user', content: userMessage, safetyFlag: safety.flag },
            { userId, role: 'assistant', content: safety.reply, safetyFlag: safety.flag },
          ],
        });
      } catch (e) {
        this.logger.error(`Failed to save safety chat message: ${(e as Error).message}`);
      }
      await this.releaseChat(userId, reservation);
      return {
        reply: safety.reply,
        quota: await this.getDailyChatQuota(userId),
        safetyFlag: safety.flag,
      };
    }
    const safetyBlock = safetyPromptBlock(
      safetyAudience({
        dateOfBirth: user?.dateOfBirth,
        pregnancyStatus: user?.pregnancyStatus,
      }),
    );

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    // 4. Lấy dữ liệu các bữa ăn ĐÃ ĂN HÔM NAY từ bảng Meal kèm các món chi tiết
    const todayMeals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: keyToDate(todayKey(timezone)),
      },
      include: {
        items: true,
      },
      orderBy: { date: 'asc' },
    });

    const consumedCalories = todayMeals.reduce(
      (acc, m) => acc + (m.totalCalories || 0),
      0,
    );
    const consumedProtein = todayMeals.reduce(
      (acc, m) => acc + (m.totalProtein || 0),
      0,
    );
    const consumedCarb = todayMeals.reduce(
      (acc, m) => acc + (m.totalCarb || 0),
      0,
    );
    const consumedFat = todayMeals.reduce(
      (acc, m) => acc + (m.totalFat || 0),
      0,
    );

    // Chưa có mục tiêu: không bịa số, prompt nói rõ để AI không nêu con số mục tiêu
    const hasTarget = !!user?.targetCalories;
    const targetCalories = user?.targetCalories ?? 0;
    const targetProtein = user?.targetProtein ?? 0;
    const targetCarb = user?.targetCarb ?? 0;
    const targetFat = user?.targetFat ?? 0;

    const remainingCalories = Math.round(targetCalories - consumedCalories);
    const remainingProtein = Math.round(targetProtein - consumedProtein);
    const remainingCarb = Math.round(targetCarb - consumedCarb);
    const remainingFat = Math.round(targetFat - consumedFat);

    const mealSummary =
      todayMeals.length > 0
        ? todayMeals
            .map((m) => {
              const itemNames = m.items
                .map((i) => `${i.name} (${Math.round(i.calories)} kcal)`)
                .join(', ');
              return `+ ${m.mealType}: ${Math.round(m.totalCalories)} kcal, ${Math.round(m.totalProtein)}g Protein (Món: ${itemNames || 'N/A'})`;
            })
            .join('\n')
        : 'Hôm nay bạn chưa ghi nhận bữa ăn nào.';

    // Ngữ cảnh sức khoẻ đầy đủ hơn chỉ cho Premium (FP 2.11); Free giữ ngữ cảnh cơ bản. Lỗi lấy thêm dữ liệu không được
    // làm hỏng cuộc trò chuyện.
    const premiumContext = await this.premiumChatContext(userId, user?.adaptiveExpenditure ?? null);

    // 5. Lấy 6 tin nhắn gần nhất trong 7 ngày để làm ngữ cảnh hội thoại
    const recentHistory = await this.prisma.aiMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    recentHistory.reverse();

    const formattedHistory = recentHistory
      .map(
        (m) => `${m.role === 'user' ? 'Người dùng' : 'AI Coach'}: ${m.content}`,
      )
      .join('\n');

    let reply = '';
    let promptTokens = 0;
    let outputTokens = 0;

    // 6. Gọi Gemini nếu có API key
    if (this.genAI) {
      try {
        const model = this.model({
          model: this.chatModelName,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 2048,
          },
        });

        const prompt = `
BẠN LÀ AI NUTRITION & FITNESS COACH CỦA ỨNG DỤNG NUTRIWISE (VIỆT NAM).
Nhiệm vụ: Tư vấn dinh dưỡng, chế độ ăn, tập luyện khoa học, thân thiện, súc tích bằng tiếng Việt.

*** QUY TẮC QUAN TRỌNG: ***
1. TRẢ LỜI TRỌN VẸN: Luôn hoàn thành đầy đủ câu chữ và ý tứ, kết thúc câu rõ ràng, không bao giờ ngắt quãng hay bỏ dở câu giữa chừng.
2. PHẠM VI HỖ TRỢ: BẠN CHỈ ĐƯỢC PHÉP trả lời các câu hỏi liên quan đến:
   - Dinh dưỡng, thực phẩm, calo, macro (protein, carb, fat), nước uống.
   - Giảm mỡ, tăng cơ, duy trì vóc dáng, chế độ ăn Eat Clean / Keto / IF / Gym.
   - Các bài tập thể dục, gym, cardio, phục hồi cơ bắp, thói quen vận động lành mạnh.
2. TUYỆT ĐỐI KHÔNG giải đáp các chủ đề ngoài lề (như: lập trình code, giải toán, dịch thuật, thơ ca, viết văn, lịch sử, chính trị, công nghệ, sửa xe, pháp lý, tin tức giải trí...).
3. NẾU NGƯỜI DÙNG HỎI CHỦ ĐỀ NGOÀI LỀ:
   - Hãy từ chối một cách lịch sự, NGẮN GỌN DƯỚI 30 TỪ và hướng người dùng quay lại chủ đề dinh dưỡng/gym.
   - Mẫu từ chối: "Tôi là Trợ Lý Dinh Dưỡng NutriWise, chỉ hỗ trợ tư vấn dinh dưỡng, calo và tập luyện thể hình. Hãy cho tôi biết bạn cần hỗ trợ gì về bữa ăn hôm nay nhé!"

${safetyBlock}
--- THÔNG TIN NGƯỜI DÙNG ---
- Tên: ${user?.name || 'Bạn'}
- Mục tiêu: ${user?.goal || 'Duy trì vóc dáng'} (Cân nặng: ${user?.weightKg || 65}kg -> Mục tiêu: ${user?.targetWeightKg || 60}kg)
${hasTarget ? `- Mục tiêu mỗi ngày: ${targetCalories} kcal | ${targetProtein}g Protein | ${targetCarb}g Carb | ${targetFat}g Fat` : '- Mục tiêu mỗi ngày: người dùng CHƯA thiết lập (đừng nêu con số mục tiêu hay lượng còn lại, hãy nhắc họ hoàn tất hồ sơ nếu liên quan)'}
- Hôm nay đã nạp: ${consumedCalories} kcal | ${consumedProtein}g Protein | ${consumedCarb}g Carb | ${consumedFat}g Fat
${hasTarget ? `- Còn lại trong ngày: ${remainingCalories} kcal | ${remainingProtein}g Protein | ${remainingCarb}g Carb | ${remainingFat}g Fat` : ''}

--- CÁC MÓN ĐÃ ĂN HÔM NAY ---
${mealSummary}
${premiumContext}
--- LỊCH SỬ HỘI THOẠI GẦN ĐÂY ---
${formattedHistory || '(Chưa có hội thoại nào trước đó)'}

--- CÂU HỎI MỚI CỦA NGƯỜI DÙNG ---
"${userMessage}"

Hãy đưa ra lời tư vấn thực tế, ưu tiên gợi ý các món ăn Việt Nam quen thuộc dễ tìm, phân tích dựa trên lượng calo/macro còn lại hôm nay của họ.
`;

        const response = await model.generateContent(prompt);
        reply = response.response.text().trim();
        if (reply) this.health.recordSuccess();

        const usage = (response.response as any).usageMetadata;
        promptTokens = usage?.promptTokenCount || Math.ceil(prompt.length / 4);
        outputTokens =
          usage?.candidatesTokenCount || Math.ceil(reply.length / 4);
      } catch (err) {
        this.logger.error(
          `Lỗi khi gọi Gemini Chat: ${err.message}. Chuyển sang Smart Fallback.`,
        );
      }
    }

    // 7. Smart Fallback (BR-11.2) nếu không có key hoặc API lỗi: chỉ lời khuyên chung, KHÔNG số dinh dưỡng bịa,
    //    và KHÔNG tính lượt/token vì người dùng không nhận được câu trả lời của AI.
    const usedFallback = !reply;
    if (usedFallback) {
      this.logger.error('AI_UNAVAILABLE: chat dùng Smart Fallback');
      this.health.recordFailure();
      reply = this.generateSmartChatFallback(
        userMessage,
        hasTarget ? remainingCalories : null,
        hasTarget ? remainingProtein : null,
        user?.goal || '',
      );
    }

    // 8. Lưu cả câu hỏi và câu trả lời vào AiMessage (lịch sử hội thoại)
    try {
      await this.prisma.aiMessage.createMany({
        data: [
          { userId, role: 'user', content: userMessage },
          { userId, role: 'assistant', content: reply },
        ],
      });
    } catch (e) {
      this.logger.error(`Failed to save chat message: ${e.message}`);
    }

    // 9. Fallback: hoàn lượt đã giữ chỗ, không cộng token
    if (usedFallback) {
      await this.releaseChat(userId, reservation);
      return {
        reply,
        quota: await this.getDailyChatQuota(userId),
        isFallback: true,
      };
    }

    // Khấu trừ quota dung lượng theo mức tiêu thụ thực tế
    const tokensUsed = promptTokens + outputTokens;
    const updatedQuota = await this.deductChatQuotaAfterSuccess(
      userId,
      reservation,
      {
        promptTokens,
        outputTokens,
        costUsd: (tokensUsed / 1000) * 0.00015,
      },
    );

    return {
      reply,
      quota: updatedQuota,
    };
  }

  /**
   * Trả lời dự phòng khi AI không dùng được (BR-11.2). Chỉ gợi ý hướng chọn món/tập luyện dạng chữ, tuyệt đối
   * không nêu calo/đạm của món cụ thể. Số duy nhất được phép là lượng còn lại trong ngày, tính từ dữ liệu thật của
   * chính người dùng (null khi họ chưa có mục tiêu thì không nêu số nào).
   */
  private generateSmartChatFallback(
    message: string,
    remainingCalories: number | null,
    remainingProtein: number | null,
    goal: string,
  ): string {
    const msgLower = message.toLowerCase();

    const offTopicKeywords = [
      'lập trình',
      'viết code',
      'python',
      'javascript',
      'bài thơ',
      'toán học',
      'chính trị',
      'tổng thống',
      'giải phương trình',
    ];
    if (offTopicKeywords.some((k) => msgLower.includes(k))) {
      return 'Tôi là Trợ Lý Dinh Dưỡng NutriWise, chỉ hỗ trợ tư vấn dinh dưỡng, calo và tập luyện thể hình. Hãy cho tôi biết bạn cần hỗ trợ gì về bữa ăn hôm nay nhé!';
    }

    const notice =
      'Trợ lý AI đang tạm thời không khả dụng nên mình chỉ gợi ý chung, lượt trò chuyện của bạn không bị trừ.';
    const status =
      remainingCalories === null
        ? 'Bạn chưa thiết lập mục tiêu hằng ngày, hãy hoàn tất hồ sơ để mình tính phần còn lại giúp bạn.'
        : remainingCalories <= 0
          ? 'Hôm nay bạn đã đạt hoặc vượt mục tiêu calo, nên ưu tiên món nhẹ, nhiều rau và uống đủ nước.'
          : `Hôm nay bạn còn khoảng ${remainingCalories} kcal${remainingProtein !== null && remainingProtein > 0 ? ` và ${remainingProtein}g protein` : ''} so với mục tiêu.`;

    if (
      msgLower.includes('tối') ||
      msgLower.includes('ăn gì') ||
      msgLower.includes('gợi ý')
    ) {
      return `${notice}
${status}
Bạn có thể ưu tiên món có nguồn đạm nạc như ức gà, cá, trứng hoặc đậu hũ, kèm nhiều rau xanh. Để xem calo chính xác của từng món, hãy tìm món đó trong kho món của ứng dụng.`;
    }

    if (
      msgLower.includes('tập') ||
      msgLower.includes('gym') ||
      msgLower.includes('cardio')
    ) {
      return `${notice}
Với mục tiêu ${goal || 'sức khỏe'} hiện tại, bạn nên kết hợp tập kháng lực với một ít cardio, uống đủ nước và bổ sung đạm sau buổi tập để cơ phục hồi tốt.`;
    }

    return `${notice}
${status}
Bạn có thể tập trung vào nguồn đạm sạch (ức gà, cá, trứng, đậu hũ) kết hợp nhiều rau xanh. Cần gợi ý cụ thể cho từng bữa thì hãy hỏi lại mình sau ít phút nhé!`;
  }

  // =========================================================================
  // PHẦN 5: AI SUGGEST MEAL (GỢI Ý MÓN ĂN VIỆT NAM THÔNG MINH BÙ TRỪ DINH DƯỠNG)
  // =========================================================================

  async suggestMeal(userId: string): Promise<SuggestMealResponseDto> {
    return withAiUsage(userId, 'suggest_meal', () =>
      this.suggestMealWithQuota(userId),
    );
  }

  private async suggestMealWithQuota(
    userId: string,
  ): Promise<SuggestMealResponseDto> {
    // Hạn mức theo gói (Free 2 lượt/ngày); hồ sơ chưa đủ hoặc lỗi bất kỳ thì hoàn lượt
    const reservation = await this.reserveFeature(userId, 'AI_SUGGEST_MEAL');
    try {
      return await this.suggestMealCore(userId);
    } catch (err) {
      await this.releaseDaily(userId, reservation);
      throw err;
    }
  }

  private async suggestMealCore(
    userId: string,
  ): Promise<SuggestMealResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        goal: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
        timezone: true,
        allergies: true,
        dietType: true,
      },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    const todayMeals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: keyToDate(todayKey(timezone)),
      },
    });

    const consumedCalories = todayMeals.reduce(
      (acc, m) => acc + (m.totalCalories || 0),
      0,
    );
    const consumedProtein = todayMeals.reduce(
      (acc, m) => acc + (m.totalProtein || 0),
      0,
    );
    const consumedCarb = todayMeals.reduce(
      (acc, m) => acc + (m.totalCarb || 0),
      0,
    );
    const consumedFat = todayMeals.reduce(
      (acc, m) => acc + (m.totalFat || 0),
      0,
    );

    if (!user?.targetCalories) throw new ProfileIncompleteException();
    const targetCalories = user.targetCalories;
    const targetProtein = user.targetProtein ?? 0;
    const targetCarb = user.targetCarb ?? 0;
    const targetFat = user.targetFat ?? 0;

    const remainingCalories = Math.max(
      0,
      Math.round(targetCalories - consumedCalories),
    );
    const remainingProtein = Math.max(
      0,
      Math.round(targetProtein - consumedProtein),
    );
    const remainingCarbs = Math.max(0, Math.round(targetCarb - consumedCarb));
    const remainingFat = Math.max(0, Math.round(targetFat - consumedFat));

    const nutritionGap: NutritionGapDto = {
      remainingCalories,
      remainingProtein,
      remainingCarbs,
      remainingFat,
    };

    return this.suggestMealForGap(
      user?.goal || null,
      nutritionGap,
      user?.allergies || [],
      user?.dietType || null,
    );
  }

  /**
   * Gợi ý món ăn cho 1 khoảng dinh dưỡng "còn thiếu" tuỳ ý (không nhất thiết là cả ngày) —
   * tách ra từ suggestMeal() để tái dùng cho Habit Reminder (mục tiêu calo riêng của 1 bữa cụ thể,
   * VD "Bữa Tối 345-450 kcal") thay vì luôn tính theo toàn bộ ngày.
   */
  async suggestMealForGap(
    goal: string | null,
    nutritionGap: NutritionGapDto,
    allergies: string[] = [],
    dietType: string | null = null,
  ): Promise<SuggestMealResponseDto> {
    const { remainingCalories, remainingProtein } = nutritionGap;

    // BR-11.5: ứng viên lấy từ kho món SAU KHI loại món vi phạm dị ứng / chế độ ăn (lọc cứng ở backend).
    // Số liệu dinh dưỡng luôn lấy từ kho món, không lấy từ LLM (NT3).
    const candidates = this.rankCandidateFoods(
      nutritionGap,
      await this.allowedFoods({ dietType, allergies }),
    );

    if (candidates.length === 0) {
      return {
        nutritionGap,
        suggestions: [],
        advice:
          'Chưa tìm được món phù hợp với chế độ ăn và dị ứng của bạn trong kho món. Bạn có thể tự tìm món trong mục Thêm bữa ăn.',
      };
    }

    let picks: { food: SafeFood; reason: string }[] = [];
    let advice = '';

    if (this.genAI) {
      try {
        const model = this.model({
          model: this.chatModelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3,
          },
        });

        const list = candidates
          .map(
            (f, i) =>
              `${i + 1}. ${f.name} (${f.servingSize}): ${f.calories} kcal, ${f.protein}g đạm`,
          )
          .join('\n');
        const prompt = `
Bạn là chuyên gia dinh dưỡng thể hình tại Việt Nam.
Người dùng có mục tiêu: ${goal || 'Duy trì vóc dáng'}.
Phần dinh dưỡng CÒN THIẾU hôm nay: ${remainingCalories} kcal, ${remainingProtein}g protein.

CHỈ ĐƯỢC chọn 1-2 món trong danh sách dưới đây (đã được lọc theo dị ứng và chế độ ăn của người dùng).
TUYỆT ĐỐI không thêm món khác, không đổi tên món, không nêu con số dinh dưỡng.
${list}

Định dạng JSON trả về DUY NHẤT:
{
  "advice": "Lời khuyên ngắn gọn 1-2 câu về dinh dưỡng hôm nay",
  "picks": [{ "name": "Tên món chép NGUYÊN VĂN từ danh sách", "reason": "Vì sao món này phù hợp (1 câu)" }]
}
`;
        const response = await model.generateContent(prompt);
        this.health.recordSuccess();
        const text = response.response
          .text()
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(text);

        const byName = new Map(candidates.map((f) => [f.name.trim(), f]));
        const seen = new Set<string>();
        for (const p of Array.isArray(parsed.picks) ? parsed.picks : []) {
          const key = String(p?.name ?? '').trim();
          const food = byName.get(key);
          // Backend kiểm tra lại: món không nằm trong danh sách ứng viên thì loại bỏ
          if (food && !seen.has(key)) {
            seen.add(key);
            picks.push({
              food,
              reason:
                String(p?.reason || '').trim() ||
                this.defaultReason(food, nutritionGap),
            });
          }
        }
        picks = picks.slice(0, 2);
        advice = typeof parsed.advice === 'string' ? parsed.advice.trim() : '';
      } catch (err) {
        this.health.recordFailure();
        this.logger.error(
          `Lỗi khi gọi Gemini Suggest Meal: ${(err as Error).message}. Dùng xếp hạng theo kho món.`,
        );
      }
    }

    // Không có AI hoặc AI trả kết quả không hợp lệ: xếp hạng theo kho món. Đây là số liệu thật của kho
    // món (đã lọc an toàn), không phải dữ liệu bịa.
    if (picks.length === 0) {
      picks = candidates.slice(0, 2).map((food) => ({
        food,
        reason: this.defaultReason(food, nutritionGap),
      }));
    }

    return {
      nutritionGap,
      suggestions: picks.map(({ food, reason }) => ({
        name: `${food.name} (${food.servingSize})`,
        mealType: food.calories >= 300 ? 'Bữa chính' : 'Bữa phụ',
        calories: Math.round(food.calories),
        protein: Math.round(food.protein),
        carbs: Math.round(food.carb),
        fat: Math.round(food.fat),
        reason,
      })),
      advice:
        advice ||
        `Hôm nay bạn còn thiếu ${remainingProtein}g protein và ${remainingCalories} kcal. Hãy chọn món giàu đạm để hoàn thành mục tiêu ngày nhé!`,
    };
  }

  /** Xếp hạng món (đã lọc an toàn) theo độ vừa với phần calo và protein còn thiếu; lấy tối đa 10 món. */
  private rankCandidateFoods(
    gap: NutritionGapDto,
    foods: SafeFood[],
  ): SafeFood[] {
    if (foods.length === 0) return [];
    const targetCal = Math.max(100, Math.min(gap.remainingCalories, 700));
    const targetPro = Math.max(0, Math.min(gap.remainingProtein, 50));

    const fitting = foods.filter((f) => f.calories <= targetCal * 1.25);
    const pool =
      fitting.length > 0
        ? fitting
        : [...foods].sort((a, b) => a.calories - b.calories).slice(0, 5);

    return pool
      .map((food) => ({
        food,
        cost:
          Math.abs(food.calories - targetCal) / targetCal +
          (targetPro > 0
            ? (Math.max(0, targetPro - food.protein) / targetPro) * 0.8
            : 0),
      }))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 10)
      .map((x) => x.food);
  }

  private defaultReason(food: SafeFood, gap: NutritionGapDto): string {
    return `Cung cấp khoảng ${Math.round(food.protein)}g đạm và ${Math.round(food.calories)} kcal, phù hợp với phần ${gap.remainingCalories} kcal bạn còn lại hôm nay.`;
  }

  // =========================================================================
  // PHẦN 6: MENU SCANNER (QUÉT THỰC ĐƠN QUÁN ĂN & RECOMMEND MÓN PHÙ HỢP)
  // =========================================================================

  async scanMenuFromBuffer(
    buffer: Buffer,
    mimeType: string = 'image/jpeg',
    userId: string,
    note?: string,
  ): Promise<ScanMenuResponseDto> {
    const base64Data = buffer.toString('base64');
    return this.scanMenuBase64(base64Data, mimeType, userId, note);
  }

  async scanMenuBase64(
    base64Data: string,
    mimeType: string = 'image/jpeg',
    userId: string,
    note?: string,
  ): Promise<ScanMenuResponseDto> {
    return withAiUsage(userId, 'menu_scan', () =>
      this.scanMenuWithQuota(base64Data, mimeType, userId, note),
    );
  }

  private async scanMenuWithQuota(
    base64Data: string,
    mimeType: string,
    userId: string,
    note?: string,
  ): Promise<ScanMenuResponseDto> {
    // 1. Giữ chỗ 1 lượt quét thực đơn (bộ đếm riêng: Free 1/ngày, Premium 5/ngày); lỗi bất kỳ sau đó đều hoàn lượt
    const reservation = await this.reserveFeature(userId, 'AI_MENU_SCAN');
    try {
      return await this.scanMenuCore(base64Data, mimeType, userId, note);
    } catch (err) {
      await this.releaseDaily(userId, reservation);
      throw err;
    }
  }

  private async scanMenuCore(
    base64Data: string,
    mimeType: string,
    userId: string,
    note?: string,
  ): Promise<ScanMenuResponseDto> {
    // 2. Lấy gap calo/protein của người dùng hôm nay
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        goal: true,
        allergies: true,
        dietType: true,
        targetCalories: true,
        targetProtein: true,
        timezone: true,
      },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    const todayMeals = await this.prisma.meal.findMany({
      where: {
        userId,
        logDate: keyToDate(todayKey(timezone)),
      },
    });

    const consumedCalories = todayMeals.reduce(
      (acc, m) => acc + (m.totalCalories || 0),
      0,
    );
    const consumedProtein = todayMeals.reduce(
      (acc, m) => acc + (m.totalProtein || 0),
      0,
    );
    if (!user?.targetCalories) throw new ProfileIncompleteException();
    const remainingCalories = Math.max(
      0,
      user.targetCalories - consumedCalories,
    );
    const remainingProtein = Math.max(
      0,
      (user.targetProtein ?? 0) - consumedProtein,
    );

    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    // Không có API key: không trả thực đơn giả (BR-11.2)
    if (!this.genAI) {
      throw this.aiUnavailable('GEMINI_API_KEY chưa được cấu hình');
    }

    try {
      const menu = await this.readMenu(cleanBase64, mimeType);
      return await this.buildMenuResult(
        menu,
        { dietType: user?.dietType ?? null, allergies: user?.allergies ?? [] },
        remainingCalories,
        remainingProtein,
      );
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw this.aiUnavailable(`Gemini Scan Menu: ${(err as Error).message}`);
    }
  }

  /** Bước đọc thực đơn (BR-11.3): Gemini CHỈ đọc tên món, giá, mô tả; không tính dinh dưỡng, không chọn món. */
  private async readMenu(base64Data: string, mimeType: string): Promise<ParsedMenu> {
    const model = this.model({
      model: this.visionModelName,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    });
    const prompt = `
Bạn là chuyên gia đọc thực đơn quán ăn Việt Nam từ ảnh.
Nhiệm vụ: chỉ ĐỌC thực đơn. TUYỆT ĐỐI KHÔNG tính calo hay chất dinh dưỡng, KHÔNG chọn hay khuyên món nào.

1. Nếu ảnh KHÔNG phải thực đơn hoặc bảng giá món ăn, trả về duy nhất:
{ "isMenu": false, "message": "Không đọc được thực đơn trong ảnh. Vui lòng chụp rõ toàn bộ thực đơn hơn nhé!" }

2. Nếu là thực đơn, trả về duy nhất JSON (tối đa ${MAX_MENU_ITEMS} món, theo thứ tự trên menu):
{
  "isMenu": true,
  "restaurantName": "Tên quán nếu có trên menu, không có thì để trống",
  "items": [
    {
      "name": "Tên món đúng như trên menu",
      "price": "Giá như trên menu (ví dụ: 45,000 VNĐ), không có thì để trống",
      "description": "Thành phần/mô tả ngắn nếu menu có ghi, không có thì để trống",
      "possibleNames": ["tên gọi phổ biến khác của món này, nếu có"]
    }
  ]
}
`;
    const imagePart = { inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' } };

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response;
      try {
        response = await model.generateContent([prompt, imagePart]);
      } catch (genErr) {
        if (this.isGeminiInvalidInputError(genErr)) {
          throw new BadRequestException(
            'Không thể xử lý ảnh này — ảnh có thể bị hỏng hoặc không đúng định dạng ảnh hợp lệ (JPG/PNG/WebP). Vui lòng chụp/chọn lại ảnh khác.',
          );
        }
        throw genErr;
      }
      const raw = response.response.text();
      let parsed: any = null;
      try {
        parsed = this.parseJsonText(raw);
      } catch {
        parsed = null;
      }
      if (parsed && parsed.isMenu === false) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'NOT_MENU',
          message:
            typeof parsed.message === 'string' && parsed.message.trim()
              ? parsed.message
              : 'Không đọc được thực đơn trong ảnh. Vui lòng chụp rõ toàn bộ thực đơn hơn nhé!',
          error: 'Bad Request',
        });
      }
      const menu = parseMenu(parsed);
      if (menu) {
        this.health.recordSuccess();
        return menu;
      }
      this.logger.warn(`Gemini Scan Menu trả sai schema (lần ${attempt}): ${raw.slice(0, 300)}`);
    }
    this.health.recordFailure();
    throw new BadGatewayException({
      statusCode: HttpStatus.BAD_GATEWAY,
      code: 'AI_BAD_RESPONSE',
      message: 'AI trả kết quả không hợp lệ. Bạn có thể thử lại hoặc chụp rõ thực đơn hơn.',
      error: 'Bad Gateway',
    });
  }

  /**
   * Neo thực đơn vào kho món, lọc cứng dị ứng/chế độ ăn, rồi chọn món gợi ý (BR-11.3, BR-11.5). Số liệu dinh dưỡng
   * lấy từ kho (AI_MATCHED); món ngoài kho nhờ AI ước tính một lần và gắn nhãn "Ước tính" (AI_ESTIMATE). Món nghi
   * chứa chất cần tránh luôn bị cảnh báo và không bao giờ được đề xuất. Việc chọn món do backend tính, không do AI.
   */
  private async buildMenuResult(
    menu: ParsedMenu,
    rules: { dietType: string | null; allergies: string[] },
    remainingCalories: number,
    remainingProtein: number,
  ): Promise<ScanMenuResponseDto> {
    const matcher = await this.foodMatcher();
    const threshold = this.catalogMatchThreshold();
    const allowed = new Set((await this.allowedFoods(rules)).map((f) => f.name));

    type Row = { item: MenuItemDto; hasNutrition: boolean };
    const rows: Row[] = [];
    const unmatchedIdx: number[] = [];

    menu.items.forEach((m, i) => {
      const names = [m.name, ...m.possibleNames];
      const best = matcher.nearest(names, 1)[0];
      const matched = best && best.score >= threshold ? best : null;

      const reasons = detectTextViolations(`${m.name} ${m.description} ${matched?.food.name ?? ''}`, rules);
      const catalogUnsafe = !!matched && !allowed.has(matched.food.name);
      const warning =
        reasons.length > 0
          ? `Có thể không phù hợp: ${[...new Set(reasons)].join(', ')}`
          : catalogUnsafe
            ? 'Có thể không phù hợp với dị ứng hoặc chế độ ăn của bạn, hãy hỏi lại quán.'
            : undefined;

      const base: MenuItemDto = {
        name: m.name,
        price: m.price,
        estimatedCalories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        description: m.description,
        isRecommended: false,
        ...(warning ? { warning } : {}),
      };
      if (matched) {
        const f = matched.food;
        rows.push({
          hasNutrition: true,
          item: {
            ...base,
            description: m.description || `Khẩu phần chuẩn: ${f.servingSize}`,
            estimatedCalories: Math.round(f.calories),
            protein: Math.round(f.protein),
            carbs: Math.round(f.carb),
            fat: Math.round(f.fat),
            sourceType: 'AI_MATCHED',
            sourceId: matched.id,
            isEstimate: false,
            servingSize: f.servingSize,
          },
        });
      } else {
        unmatchedIdx.push(i);
        rows.push({ hasNutrition: false, item: base });
      }
    });

    // Món ngoài kho: một yêu cầu ước tính cho cả nhóm; thất bại thì món đó chỉ được liệt kê, không có số liệu
    if (unmatchedIdx.length > 0) {
      const dishes: DetectedDish[] = unmatchedIdx.map((i) => ({
        dishName: menu.items[i].name,
        possibleNames: menu.items[i].possibleNames,
        portion: { amount: 1, unit: 'phần' },
        confidence: 0.5,
      }));
      const estimates = await this.estimateDishes(dishes);
      unmatchedIdx.forEach((rowIdx, k) => {
        const est = estimates?.[k];
        if (!est) return;
        const check = atwaterCheck(est, this.atwaterTolerancePct());
        rows[rowIdx] = {
          hasNutrition: true,
          item: {
            ...rows[rowIdx].item,
            estimatedCalories: Math.round(check.ok ? est.calories : check.computed),
            protein: Math.round(est.protein),
            carbs: Math.round(est.carb),
            fat: Math.round(est.fat),
            sourceType: 'AI_ESTIMATE',
            isEstimate: true,
            servingSize: '1 phần',
          },
        };
      });
    }
    rows.forEach((r) => {
      if (!r.hasNutrition) r.item.nutritionAvailable = false;
    });

    // Chọn món: chỉ món an toàn và có số liệu
    const maxSuggestions = this.maxSuggestions();
    const picked = rankMenuItems(
      rows
        .map((r, index) => ({
          index,
          calories: r.item.estimatedCalories,
          protein: r.item.protein,
          eligible: r.hasNutrition && !r.item.warning,
        }))
        .filter((x) => x.eligible),
      remainingCalories,
      remainingProtein,
      maxSuggestions,
    );
    for (const index of picked) {
      const it = rows[index].item;
      it.isRecommended = true;
      it.recommendationReason = `Khoảng ${it.estimatedCalories} kcal và ${it.protein}g đạm, vừa với phần ${Math.round(remainingCalories)} kcal bạn còn lại hôm nay.${it.isEstimate ? ' (Số liệu ước tính)' : ''}`;
    }

    const items = rows.map((r) => r.item);
    const recommendedItems = picked.map((i) => rows[i].item);
    const lightest = items
      .filter((it, i) => rows[i].hasNutrition && !it.warning)
      .sort((a, b) => a.estimatedCalories - b.estimatedCalories)[0];

    let summaryAdvice: string;
    if (remainingCalories <= 0) {
      summaryAdvice = `Hôm nay bạn đã đạt mục tiêu calo.${lightest ? ` Nếu vẫn muốn ăn, hãy chọn món nhẹ như ${lightest.name} (khoảng ${lightest.estimatedCalories} kcal).` : ''}`;
    } else if (recommendedItems.length > 0) {
      summaryAdvice = `Bạn còn khoảng ${Math.round(remainingCalories)} kcal và ${Math.round(remainingProtein)}g đạm. Gợi ý: ${recommendedItems.map((i) => i.name).join(', ')}.`;
    } else {
      summaryAdvice = `Bạn còn khoảng ${Math.round(remainingCalories)} kcal. Chưa có món nào trong thực đơn này vừa với phần còn lại và phù hợp với bạn${lightest ? `; món nhẹ nhất là ${lightest.name} (khoảng ${lightest.estimatedCalories} kcal)` : ''}.`;
    }

    return {
      restaurantName: menu.restaurantName || 'Thực Đơn Quán Ăn',
      items,
      recommendedItems,
      summaryAdvice,
      disclaimer: 'Thành phần thực tế tuỳ cách chế biến của quán. Số liệu chỉ mang tính tham khảo.',
    };
  }

  private maxSuggestions(): number {
    const n = Number(this.configService.get('AI_MAX_SUGGESTIONS'));
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : DEFAULT_MAX_SUGGESTIONS;
  }

  // =========================================================================
  // PHẦN 7: CÁC HÀM NHẬN DIỆN ẢNH CƠ BẢN (FOOD RECOGNITION)
  // =========================================================================

  async recognizeFoodFromBuffer(
    buffer: Buffer,
    mimeType: string = 'image/jpeg',
    userId: string,
  ): Promise<FoodRecognitionResultDto> {
    const base64Data = buffer.toString('base64');
    return this.analyzeFoodImageBase64(base64Data, mimeType, userId);
  }

  async analyzeFoodImageBase64(
    base64Data: string,
    mimeType: string = 'image/jpeg',
    userId: string,
  ): Promise<FoodRecognitionResultDto> {
    return withAiUsage(userId, 'food_recognition', () =>
      this.analyzeFoodWithQuota(base64Data, mimeType, userId),
    );
  }

  private async analyzeFoodWithQuota(
    base64Data: string,
    mimeType: string,
    userId: string,
  ): Promise<FoodRecognitionResultDto> {
    // BR-11.4: giữ chỗ lượt trước khi gọi AI (atomic); mọi lỗi sau đó đều hoàn lượt
    const reservation = await this.reservePhotoQuota(userId);
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    try {
      if (!this.genAI) {
        throw this.aiUnavailable('GEMINI_API_KEY chưa được cấu hình');
      }

      let result: FoodRecognitionResultDto | null;
      try {
        result = await this.callGeminiVision(cleanBase64, mimeType);
        if (result) this.health.recordSuccess();
      } catch (error) {
        if (error instanceof HttpException) {
          throw error; // NOT_FOOD hoặc ảnh hỏng (400)
        }
        throw this.aiUnavailable(`Gemini Vision: ${(error as Error).message}`);
      }
      if (!result) {
        throw this.aiUnavailable('Phản hồi Gemini Vision không hợp lệ');
      }

      const remaining = await this.finalizePhotoUsage(userId, reservation, {
        promptTokens: 500,
        outputTokens: 200,
        costUsd: 0.0005,
      });

      return {
        ...result,
        usedQuotaType: reservation.usedQuotaType,
        freeRemaining: remaining.freeRemaining,
        purchasedCredits: remaining.purchasedCredits,
        totalRemaining: remaining.totalRemaining,
        remainingDailyQuota: remaining.totalRemaining,
        dailyLimit: (await getPlanLimits(this.prisma, userId)).aiPhotoPerDay,
        isFallback: false,
      };
    } catch (err) {
      await this.refundPhotoQuota(userId, reservation);
      throw err;
    }
  }

  /**
   * Nhận diện ảnh neo vào kho món (BR-11.1). Gemini CHỈ nhận diện tên món và khẩu phần, KHÔNG trả calo.
   * Số liệu dinh dưỡng lấy từ kho món × khẩu phần; món không có trong kho mới nhờ AI ước tính và gắn nhãn "Ước tính".
   */
  private async callGeminiVision(
    base64Data: string,
    mimeType: string,
  ): Promise<FoodRecognitionResultDto | null> {
    if (!this.genAI) return null;
    const { dishes, healthTip } = await this.detectDishes(base64Data, mimeType);
    return this.anchorToCatalog(dishes, healthTip);
  }

  /** Bước 3–4: gọi Gemini nhận diện, kiểm tra schema, sai thì thử lại đúng một lần. */
  private async detectDishes(
    base64Data: string,
    mimeType: string,
  ): Promise<{ dishes: DetectedDish[]; healthTip: string }> {
    const model = this.model({
      model: this.visionModelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const prompt = `
Bạn là chuyên gia nhận diện món ăn từ ảnh, hiểu rõ ẩm thực Việt Nam.
Nhiệm vụ: chỉ NHẬN DIỆN món ăn và ƯỚC LƯỢNG KHẨU PHẦN trong ảnh. TUYỆT ĐỐI KHÔNG tính calo hay chất dinh dưỡng.

1. Nếu ảnh KHÔNG có món ăn, đồ uống hay thực phẩm, trả về duy nhất:
{ "isFood": false, "message": "Không nhận diện được món ăn hoặc thực phẩm trong ảnh. Vui lòng chụp rõ món ăn hơn nhé!" }

2. Nếu ảnh có đồ ăn, trả về duy nhất JSON (tối đa ${MAX_DISHES_PER_PHOTO} món, mỗi món một phần tử):
{
  "isFood": true,
  "items": [
    {
      "dishName": "Tên món tiếng Việt chuẩn, ngắn gọn (ví dụ: Phở bò, Cơm tấm sườn)",
      "possibleNames": ["tên gọi khác hoặc món dễ nhầm", "..."],
      "portion": { "amount": 1, "unit": "tô" },
      "confidence": 0.9
    }
  ],
  "healthTip": "Một lời khuyên dinh dưỡng chung 1-2 câu, KHÔNG nêu con số calo hay gram dinh dưỡng"
}

Quy tắc khẩu phần: "unit" là một trong g, ml, tô, chén, bát, đĩa, ly, quả, miếng, lát, ổ, phần. "amount" là số lớn hơn 0 (có thể 0.5, 1.5). Ưu tiên đơn vị người Việt hay dùng; nếu chỉ ước lượng được khối lượng thì dùng g hoặc ml.
"confidence" từ 0 đến 1 là độ chắc chắn của bạn về tên món.
`;

    const imagePart = {
      inlineData: { data: base64Data, mimeType: mimeType || 'image/jpeg' },
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      let response;
      try {
        response = await model.generateContent([prompt, imagePart]);
      } catch (genErr) {
        if (this.isGeminiInvalidInputError(genErr)) {
          throw new BadRequestException(
            'Không thể xử lý ảnh này — ảnh có thể bị hỏng hoặc không đúng định dạng ảnh hợp lệ (JPG/PNG/WebP). Vui lòng chụp/chọn lại ảnh khác.',
          );
        }
        throw genErr;
      }
      const text = response.response.text();
      let parsed: any = null;
      try {
        parsed = this.parseJsonText(text);
      } catch {
        parsed = null;
      }

      if (parsed && parsed.isFood === false) {
        throw new BadRequestException({
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'NOT_FOOD',
          message:
            parsed.message ||
            'Hình ảnh không phải là món ăn hoặc quá mờ. Vui lòng chụp rõ món ăn hơn nhé!',
          error: 'Bad Request',
        });
      }

      const dishes = parseDetectedDishes(parsed);
      if (dishes) {
        const tip =
          typeof parsed.healthTip === 'string' && parsed.healthTip.trim()
            ? parsed.healthTip.trim()
            : 'Hãy uống đủ nước và ăn kèm rau xanh để bữa ăn cân bằng hơn.';
        return { dishes, healthTip: tip };
      }
      this.logger.warn(
        `Gemini Vision trả sai schema (lần ${attempt}): ${text.slice(0, 300)}`,
      );
    }

    this.health.recordFailure();
    throw new BadGatewayException({
      statusCode: HttpStatus.BAD_GATEWAY,
      code: 'AI_BAD_RESPONSE',
      message:
        'AI trả kết quả không hợp lệ. Bạn có thể thử lại hoặc tìm món thủ công trong kho món.',
      error: 'Bad Gateway',
    });
  }

  private parseJsonText(text: string): any {
    return JSON.parse(
      text
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim(),
    );
  }

  /** Bước 6–7: khớp từng món vào kho; món không khớp thì xin AI ước tính một lần cho cả nhóm. */
  private async anchorToCatalog(
    dishes: DetectedDish[],
    healthTip: string,
  ): Promise<FoodRecognitionResultDto> {
    const threshold = this.catalogMatchThreshold();
    const matcher = await this.foodMatcher();

    type Slot = { dish: DetectedDish; item?: FoodItemRecognitionDto };
    const slots: Slot[] = dishes.map((dish) => ({ dish }));
    const unmatched: Slot[] = [];

    const toAlternative = (n: FoodMatch) => ({
      name: n.food.name,
      servingSize: n.food.servingSize,
      sourceId: n.id,
      calories: Math.round(n.food.calories),
      protein: round1(n.food.protein),
      carb: round1(n.food.carb),
      fat: round1(n.food.fat),
    });

    for (const slot of slots) {
      const { dish } = slot;
      const names = [dish.dishName, ...dish.possibleNames];
      const nearest = matcher.nearest(names, ALTERNATIVES_COUNT + 1);
      const best =
        nearest[0] && nearest[0].score >= threshold ? nearest[0] : null;
      if (!best) {
        unmatched.push(slot);
        continue;
      }
      const factor = portionFactor(dish.portion, best.food.servingSize);
      slot.item = {
        name: best.food.name,
        servingSize: portionLabel(dish.portion),
        calories: Math.round(best.food.calories * factor),
        protein: round1(best.food.protein * factor),
        carb: round1(best.food.carb * factor),
        fat: round1(best.food.fat * factor),
        sourceType: 'AI_MATCHED',
        sourceId: best.id,
        isEstimate: false,
        confidence: dish.confidence,
        confidenceLevel: dish.confidence >= 0.7 ? 'HIGH' : 'LOW',
        alternatives: nearest
          .filter((n) => n.id !== best.id)
          .slice(0, ALTERNATIVES_COUNT)
          .map(toAlternative),
      };
    }

    const unrecognized: string[] = [];
    if (unmatched.length > 0) {
      const estimates = await this.estimateDishes(unmatched.map((s) => s.dish));
      unmatched.forEach((slot, i) => {
        const est = estimates?.[i];
        if (!est) {
          unrecognized.push(slot.dish.dishName);
          return;
        }
        // Atwater: calo lệch > 15% so với 4P+4C+9F thì sửa theo macro và gắn cờ
        const check = atwaterCheck(est, this.atwaterTolerancePct());
        const calories = check.ok ? est.calories : check.computed;
        slot.item = {
          name: slot.dish.dishName,
          servingSize: portionLabel(slot.dish.portion),
          calories: Math.round(calories),
          protein: round1(est.protein),
          carb: round1(est.carb),
          fat: round1(est.fat),
          sourceType: 'AI_ESTIMATE',
          isEstimate: true,
          confidence: Math.min(slot.dish.confidence, 0.5),
          confidenceLevel: 'LOW',
          atwaterAdjusted: !check.ok,
          alternatives: matcher
            .nearest(
              [slot.dish.dishName, ...slot.dish.possibleNames],
              ALTERNATIVES_COUNT,
            )
            .map(toAlternative),
        };
      });
    }

    const items = slots
      .map((s) => s.item)
      .filter((i): i is FoodItemRecognitionDto => !!i);
    if (items.length === 0) {
      throw this.aiUnavailable('Không ước tính được món nào ngoài kho');
    }

    const sum = (pick: (i: FoodItemRecognitionDto) => number) =>
      items.reduce((acc, i) => acc + pick(i), 0);
    return {
      foodName: items.map((i) => i.name).join(' + '),
      confidenceScore: Math.min(...items.map((i) => i.confidence ?? 0)),
      servingSize:
        items.length === 1 ? items[0].servingSize : `${items.length} món`,
      totalCalories: Math.round(sum((i) => i.calories)),
      totalProtein: round1(sum((i) => i.protein)),
      totalCarb: round1(sum((i) => i.carb)),
      totalFat: round1(sum((i) => i.fat)),
      items,
      healthTip,
      isFallback: false,
      ...(unrecognized.length > 0 ? { unrecognized } : {}),
    };
  }

  /** Bước 7b: một yêu cầu ước tính cho các món không có trong kho. null nếu AI lỗi/sai schema sau một lần thử lại. */
  private async estimateDishes(
    dishes: DetectedDish[],
  ): Promise<DishEstimate[] | null> {
    if (!this.genAI) return null;
    const model = this.model({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });
    const list = dishes
      .map((d, i) => `${i + 1}. ${d.dishName} — khẩu phần ${portionLabel(d.portion)}`)
      .join('\n');
    const prompt = `
Ước tính dinh dưỡng cho các món ăn Việt Nam sau, theo đúng khẩu phần đã nêu:
${list}

Trả về duy nhất JSON:
{ "estimates": [ { "dishName": "tên món CHÉP NGUYÊN VĂN như trong danh sách", "calories": 0, "protein": 0, "carb": 0, "fat": 0 } ] }
Đơn vị: calories là kcal; protein, carb, fat là gram. Mỗi món đúng một phần tử, đủ tất cả các món.
`;
    const names = dishes.map((d) => d.dishName);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await model.generateContent(prompt);
        const parsed = this.parseJsonText(response.response.text());
        const estimates = parseEstimates(parsed, names);
        if (estimates) return estimates;
        this.logger.warn(`Gemini ước tính sai schema (lần ${attempt})`);
      } catch (err) {
        this.logger.warn(
          `Gemini ước tính lỗi (lần ${attempt}): ${(err as Error).message}`,
        );
      }
    }
    return null;
  }

  private catalogMatchThreshold(): number {
    const n = Number(this.configService.get('AI_CATALOG_MATCH_THRESHOLD'));
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_MATCH_THRESHOLD;
  }

  private atwaterTolerancePct(): number {
    const n = Number(this.configService.get('AI_ATWATER_TOLERANCE_PCT'));
    return Number.isFinite(n) && n > 0 ? n : 15;
  }

  /**
   * Phân biệt lỗi Gemini do INPUT SAI (ảnh hỏng/không phải ảnh hợp lệ — Gemini tự trả
   * "400 Bad Request: Unable to process input image") với lỗi hạ tầng thật (timeout,
   * network, quota Google, model không tồn tại...). Trước đây MỌI lỗi gọi Gemini đều bị
   * gộp chung và âm thầm rơi vào Smart Fallback (trả dữ liệu giả + vẫn trừ quota) — kể cả
   * khi lỗi là do user gửi file rác/không phải ảnh, khiến họ không hề biết file mình gửi
   * có vấn đề. Lỗi input-sai này nên trả 400 rõ ràng cho client, KHÔNG fallback, KHÔNG trừ quota.
   */
  private isGeminiInvalidInputError(error: any): boolean {
    const msg = String(error?.message || '');
    return (
      /Unable to process input image/i.test(msg) ||
      /\[400 Bad Request\]/.test(msg)
    );
  }

  // =========================================================================
  // TIỆN ÍCH HỆ THỐNG
  // =========================================================================

  /** Trả về múi giờ IANA hợp lệ; sai hoặc thiếu thì dùng múi giờ Việt Nam. */
  private resolveTimezone(tz?: string | null): string {
    return resolveZone(tz);
  }

  /** Ngày hiện tại của user dạng YYYY-MM-DD theo múi giờ của họ. */
  private getDateKey(timezone: string): string {
    return todayKey(timezone);
  }

  private getTimezoneDayBounds(timezone: string = 'Asia/Ho_Chi_Minh'): {
    startOfDay: Date;
    resetsAt: Date;
  } {
    return getDayBounds(timezone);
  }
}
