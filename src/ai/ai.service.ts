import { ProfileIncompleteException } from '../common/errors/profile-incomplete.exception';
import { getPlanLimits, isFreeTierLimited } from '../billing/entitlement.util';
import { PLAN_LIMITS } from '../billing/billing.constants';
import { refundDaily, reserveDaily } from '../billing/daily-counter';
import { QuotaExceededException } from '../common/errors/quota-exceeded.exception';
import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
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
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';
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

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mealsService: MealsService,
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

    const dailyFreeLimit = (await getPlanLimits(this.prisma, userId)).aiPhotoPerDay;
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

    const ok = await reserveDaily(this.prisma, userId, date, cfg.column, cfg.limit);
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
    await this.logApiUsage(
      userId,
      r.usedQuotaType === 'FREE' ? 'food_recognition' : 'food_recognition_paid',
      tokens.promptTokens,
      tokens.outputTokens,
      tokens.costUsd,
    );
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
        userId_date: { userId, date: this.getDateKey(this.resolveTimezone(timezone)) },
      },
    });

    const limits = await getPlanLimits(this.prisma, userId);
    const byTokens = limits.chatTokensPerDay !== null;
    const unit: 'MESSAGES' | 'TOKENS' = byTokens ? 'TOKENS' : 'MESSAGES';
    const limit = (byTokens ? limits.chatTokensPerDay : limits.chatMessagesPerDay) ?? 0;
    const used = byTokens ? (counter?.chatTokens ?? 0) : (counter?.chatMessages ?? 0);

    const remaining = Math.max(0, limit - used);
    const remainingPercent = limit > 0 ? Math.min(100, Math.max(0, Math.round((remaining / limit) * 100))) : 0;
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
      const ok = await reserveDaily(this.prisma, userId, date, 'chatMessages', limits.chatMessagesPerDay);
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
    if (r.countedMessage) await refundDaily(this.prisma, userId, r.date, 'chatMessages');
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
        ...(reservation.countedMessage ? {} : { chatMessages: { increment: 1 } }),
      },
    });

    await this.logApiUsage(
      userId,
      'chat_coach',
      tokens.promptTokens,
      tokens.outputTokens,
      tokens.costUsd,
    );

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
    // 1. Giữ chỗ hạn mức (Free: 10 tin/ngày; Premium: 50.000 token/ngày); lỗi bất kỳ sau đó đều hoàn lượt
    const reservation = await this.reserveChat(userId);
    try {
      return await this.chatInner(userId, userMessage, reservation);
    } catch (err) {
      await this.releaseChat(userId, reservation);
      throw err;
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
      },
    });

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
        const model = this.genAI.getGenerativeModel({
          model: this.chatModelName,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 2048,
          },
        });

        const prompt = `
BẠN LÀ AI NUTRITION & FITNESS COACH CỦA ỨNG DỤNG CALAI (VIỆT NAM).
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

--- THÔNG TIN NGƯỜI DÙNG ---
- Tên: ${user?.name || 'Bạn'}
- Mục tiêu: ${user?.goal || 'Duy trì vóc dáng'} (Cân nặng: ${user?.weightKg || 65}kg -> Mục tiêu: ${user?.targetWeightKg || 60}kg)
${hasTarget ? `- Mục tiêu mỗi ngày: ${targetCalories} kcal | ${targetProtein}g Protein | ${targetCarb}g Carb | ${targetFat}g Fat` : '- Mục tiêu mỗi ngày: người dùng CHƯA thiết lập (đừng nêu con số mục tiêu hay lượng còn lại, hãy nhắc họ hoàn tất hồ sơ nếu liên quan)'}
- Hôm nay đã nạp: ${consumedCalories} kcal | ${consumedProtein}g Protein | ${consumedCarb}g Carb | ${consumedFat}g Fat
${hasTarget ? `- Còn lại trong ngày: ${remainingCalories} kcal | ${remainingProtein}g Protein | ${remainingCarb}g Carb | ${remainingFat}g Fat` : ''}

--- CÁC MÓN ĐÃ ĂN HÔM NAY ---
${mealSummary}

--- LỊCH SỬ HỘI THOẠI GẦN ĐÂY ---
${formattedHistory || '(Chưa có hội thoại nào trước đó)'}

--- CÂU HỎI MỚI CỦA NGƯỜI DÙNG ---
"${userMessage}"

Hãy đưa ra lời tư vấn thực tế, ưu tiên gợi ý các món ăn Việt Nam quen thuộc dễ tìm, phân tích dựa trên lượng calo/macro còn lại hôm nay của họ.
`;

        const response = await model.generateContent(prompt);
        reply = response.response.text().trim();

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

    // 7. Fallback thông minh nếu không có key hoặc API lỗi
    if (!reply) {
      reply = this.generateSmartChatFallback(
        userMessage,
        remainingCalories,
        remainingProtein,
        user?.goal || '',
      );
      promptTokens = Math.ceil(
        (userMessage.length + formattedHistory.length + mealSummary.length) / 4,
      );
      outputTokens = Math.ceil(reply.length / 4);
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

    // 9. Khấu trừ quota dung lượng theo mức tiêu thụ thực tế
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

  private generateSmartChatFallback(
    message: string,
    remainingCalories: number,
    remainingProtein: number,
    goal: string,
  ): string {
    const msgLower = message.toLowerCase();

    // Check Guardrails trong fallback
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

    if (
      msgLower.includes('tối') ||
      msgLower.includes('ăn gì') ||
      msgLower.includes('gợi ý')
    ) {
      return `Hôm nay bạn còn khoảng ${remainingCalories > 0 ? remainingCalories : 0} kcal và cần bổ sung thêm ~${remainingProtein > 0 ? remainingProtein : 0}g protein.
Bạn có thể tham khảo 1 tô Phở gà ức ít bánh (~420 kcal, 38g đạm) hoặc 1 đĩa Salad ức gà áp chảo sốt mè rang (~350 kcal, 35g đạm). Cả hai món đều bổ sung đạm rất tốt mà không lo vượt calo trong ngày!`;
    }

    if (
      msgLower.includes('tập') ||
      msgLower.includes('gym') ||
      msgLower.includes('cardio')
    ) {
      return `Với mục tiêu ${goal || 'sức khỏe'} hiện tại, bạn nên duy trì 45-60 phút tập kháng lực (kháng tạ) kết hợp 15 phút cardio cuối buổi. Nhớ uống đủ nước và nạp 20-30g protein sau buổi tập để cơ bắp phục hồi tối ưu nhé!`;
    }

    return `Chào bạn! Dựa trên mục tiêu dinh dưỡng hôm nay (còn thiếu ${remainingCalories > 0 ? remainingCalories : 0} kcal, ${remainingProtein > 0 ? remainingProtein : 0}g protein), tôi khuyến nghị bạn tập trung vào nguồn đạm sạch (ức gà, cá basa, trứng chần, đậu hũ) kết hợp nhiều rau xanh. Nếu bạn cần gợi ý thực đơn cụ thể cho từng bữa, cứ hỏi tôi nhé!`;
  }

  // =========================================================================
  // PHẦN 5: AI SUGGEST MEAL (GỢI Ý MÓN ĂN VIỆT NAM THÔNG MINH BÙ TRỪ DINH DƯỠNG)
  // =========================================================================

  async suggestMeal(userId: string): Promise<SuggestMealResponseDto> {
    // Hạn mức theo gói (Free 2 lượt/ngày); hồ sơ chưa đủ hoặc lỗi bất kỳ thì hoàn lượt
    const reservation = await this.reserveFeature(userId, 'AI_SUGGEST_MEAL');
    try {
      return await this.suggestMealCore(userId);
    } catch (err) {
      await this.releaseDaily(userId, reservation);
      throw err;
    }
  }

  private async suggestMealCore(userId: string): Promise<SuggestMealResponseDto> {
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
      getAllowedFoods({ dietType, allergies }),
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
        const model = this.genAI.getGenerativeModel({
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
              reason: String(p?.reason || '').trim() || this.defaultReason(food, nutritionGap),
            });
          }
        }
        picks = picks.slice(0, 2);
        advice = typeof parsed.advice === 'string' ? parsed.advice.trim() : '';
      } catch (err) {
        this.logger.error(
          `Lỗi khi gọi Gemini Suggest Meal: ${(err as Error).message}. Dùng xếp hạng theo kho món.`,
        );
      }
    }

    // Không có AI hoặc AI trả kết quả không hợp lệ: xếp hạng theo kho món. Đây là số liệu thật của kho
    // món (đã lọc an toàn), không phải dữ liệu bịa.
    if (picks.length === 0) {
      picks = candidates
        .slice(0, 2)
        .map((food) => ({ food, reason: this.defaultReason(food, nutritionGap) }));
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
    const pool = fitting.length > 0 ? fitting : [...foods].sort((a, b) => a.calories - b.calories).slice(0, 5);

    return pool
      .map((food) => ({
        food,
        cost:
          Math.abs(food.calories - targetCal) / targetCal +
          (targetPro > 0 ? (Math.max(0, targetPro - food.protein) / targetPro) * 0.8 : 0),
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

    // 3. Gọi Gemini Vision nếu có key
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.visionModelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        });

        const prompt = `
Bạn là AI chuyên gia đọc thực đơn quán ăn và dinh dưỡng thể thao tại Việt Nam.
Nhiệm vụ:
1. Đọc và phân tích ảnh MENU THỰC ĐƠN quán ăn (nhận diện tên quán nếu có, danh sách các món ăn kèm giá tiền).
2. Ước tính dinh dưỡng chuẩn xác (Calo, Protein, Carbs, Fat) cho từng món ăn trên menu theo bảng thành phần thực phẩm Việt Nam.
3. Người dùng đang có mục tiêu: ${user?.goal || 'Duy trì vóc dáng'}.
   Ngân sách còn lại hôm nay: ${remainingCalories} kcal và ${remainingProtein}g Protein.
   ${note ? `Ghi chú thêm của người dùng: "${note}"` : ''}
   ${(user?.allergies?.length ?? 0) > 0 ? `Người dùng DỊ ỨNG: ${user!.allergies.join(', ')}. Không đánh dấu isRecommended cho món có thể chứa các chất này.` : ''}
   ${user?.dietType && user.dietType !== 'OMNIVORE' ? `Chế độ ăn của người dùng: ${user.dietType}. Không đánh dấu isRecommended cho món không phù hợp.` : ''}
4. Chọn ra TOP 1-2 MÓN TỐI ƯU NHẤT từ menu phù hợp với ngân sách calo và protein còn lại này. Đánh dấu isRecommended = true và ghi rõ recommendationReason.

ĐỊNH DẠNG JSON TRẢ VỀ DUY NHẤT:
{
  "restaurantName": "Tên quán ăn nếu có trên menu",
  "summaryAdvice": "Lời khuyên tổng kết ngắn gọn cho người dùng khi gọi món tại quán này",
  "items": [
    {
      "name": "Tên món ăn trên menu",
      "price": "Giá tiền (ví dụ: 45,000 VNĐ)",
      "estimatedCalories": 550,
      "protein": 28,
      "carbs": 65,
      "fat": 18,
      "description": "Thành phần món chính",
      "isRecommended": false,
      "recommendationReason": ""
    }
  ]
}
`;

        const imagePart = {
          inlineData: {
            data: cleanBase64,
            mimeType: mimeType || 'image/jpeg',
          },
        };

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
        const text = response.response
          .text()
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(text);

        await this.logApiUsage(userId, 'menu_scan', 600, 350, 0.0007);

        const rules = {
          dietType: user?.dietType ?? null,
          allergies: user?.allergies ?? [],
        };
        // BR-11.3: kiểm tra lại ở backend — món có thể vi phạm dị ứng/chế độ ăn bị gắn cảnh báo
        // và không bao giờ được đề xuất, dù AI có đánh dấu isRecommended.
        const allItems: MenuItemDto[] = (
          Array.isArray(parsed.items) ? (parsed.items as MenuItemDto[]) : []
        ).map((it) => {
          const reasons = detectTextViolations(
            `${it.name ?? ''} ${it.description ?? ''}`,
            rules,
          );
          return reasons.length > 0
            ? {
                ...it,
                isRecommended: false,
                warning: `Có thể không phù hợp: ${[...new Set(reasons)].join(', ')}`,
              }
            : it;
        });
        const safeItems = allItems.filter((it) => !it.warning);
        const recommendedItems = safeItems.filter((it) => it.isRecommended);

        return {
          restaurantName: parsed.restaurantName || 'Thực Đơn Quán Ăn',
          items: allItems,
          recommendedItems:
            recommendedItems.length > 0
              ? recommendedItems
              : safeItems.slice(0, 2),
          summaryAdvice:
            parsed.summaryAdvice ||
            `Hôm nay bạn còn ${remainingCalories} kcal và ${remainingProtein}g protein. Hãy chọn món giàu đạm nhé!`,
        };
      } catch (err) {
        if (err instanceof HttpException) {
          throw err;
        }
        throw this.aiUnavailable(`Gemini Scan Menu: ${(err as Error).message}`);
      }
    }

    // Không có API key: không trả thực đơn giả (BR-11.2)
    throw this.aiUnavailable('GEMINI_API_KEY chưa được cấu hình');
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

  private async callGeminiVision(
    base64Data: string,
    mimeType: string,
  ): Promise<FoodRecognitionResultDto | null> {
    if (!this.genAI) return null;
    const model = this.genAI.getGenerativeModel({
      model: this.visionModelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const prompt = `
Bạn là chuyên gia dinh dưỡng và thị giác máy tính AI hàng đầu tại Việt Nam.
Nhiệm vụ: Phân tích bức ảnh này để nhận diện bữa ăn và bóc tách thành phần dinh dưỡng.

QUY TẮC QUAN TRỌNG:
1. Xác định xem ảnh có chứa MÓN ĂN, ĐỒ UỐNG, THỰC PHẨM hay BỮA ĂN hay không.
- Nếu ảnh hoàn toàn KHÔNG phải đồ ăn/thực phẩm:
Hãy trả về duy nhất định dạng JSON:
{
  "isFood": false,
  "message": "Không nhận diện được món ăn hoặc thực phẩm trong ảnh. Vui lòng chụp rõ món ăn hơn nhé!"
}

2. Nếu ảnh LÀ món ăn/thực phẩm:
- Nhận diện tên món ăn chính xác nhất bằng tiếng Việt (đặc biệt ưu tiên ẩm thực Việt Nam).
- Ước lượng khẩu phần thực tế kèm gram ước tính (ví dụ: 1 tô vừa ~450g).
- Tính toán tổng Calo (kcal) và Protein (g), Carbs (g), Fat (g).
- Bóc tách chi tiết từng thành phần con.
- Đưa ra lời khuyên dinh dưỡng (healthTip) khoa học, súc tích (1-2 câu).

YÊU CẦU ĐẦU RA DUY NHẤT JSON:
{
  "isFood": true,
  "foodName": "Tên món ăn tiếng Việt chuẩn",
  "confidenceScore": 0.95,
  "servingSize": "Khẩu phần ước tính (ví dụ: 1 tô vừa ~450g)",
  "totalCalories": 520,
  "totalProtein": 28,
  "totalCarb": 64,
  "totalFat": 16,
  "items": [
    {
      "name": "Tên thành phần con",
      "servingSize": "Khẩu phần con",
      "calories": 220,
      "protein": 5,
      "carb": 48,
      "fat": 1
    }
  ],
  "healthTip": "Lời khuyên dinh dưỡng (1-2 câu)"
}
`;

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType || 'image/jpeg',
      },
    };

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
    const responseText = response.response.text();

    try {
      const cleanJson = responseText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.isFood === false) {
        throw new BadRequestException(
          parsed.message ||
            'Hình ảnh không phải là món ăn hoặc quá mờ. Vui lòng chụp rõ món ăn hơn nhé!',
        );
      }

      return {
        foodName: parsed.foodName || 'Món ăn hỗn hợp',
        confidenceScore:
          typeof parsed.confidenceScore === 'number'
            ? parsed.confidenceScore
            : 0.9,
        servingSize: parsed.servingSize || '1 phần tiêu chuẩn',
        totalCalories: Math.round(parsed.totalCalories || 0),
        totalProtein: Math.round(parsed.totalProtein || 0),
        totalCarb: Math.round(parsed.totalCarb || 0),
        totalFat: Math.round(parsed.totalFat || 0),
        items: Array.isArray(parsed.items)
          ? parsed.items.map((it: any) => ({
              name: it.name || 'Thành phần',
              servingSize: it.servingSize || '1 phần',
              calories: Math.round(it.calories || 0),
              protein: Math.round(it.protein || 0),
              carb: Math.round(it.carb || 0),
              fat: Math.round(it.fat || 0),
            }))
          : [],
        healthTip:
          parsed.healthTip ||
          'Bữa ăn cung cấp nguồn năng lượng tốt. Hãy uống thêm nước lọc và ăn kèm rau xanh để tăng cường vi chất.',
        isFallback: false,
      };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error(
        `Failed to parse Gemini JSON response: ${responseText}`,
      );
      return null;
    }
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

  private async logApiUsage(
    userId: string,
    feature: string,
    promptTokens: number,
    outputTokens: number,
    costUsd: number,
  ) {
    try {
      await this.prisma.apiUsageLog.create({
        data: {
          userId,
          feature,
          promptTokens,
          outputTokens,
          costUsd,
        },
      });
    } catch (e) {
      this.logger.debug(`Could not log API usage: ${e.message}`);
    }
  }
}
