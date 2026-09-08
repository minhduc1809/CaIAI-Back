import { Injectable, Logger, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';
import { AiQuotaResponseDto } from './dto/ai-quota-response.dto';
import { PurchaseAiQuotaDto, AiScanPackageDto } from './dto/purchase-ai-quota.dto';
import { ChatQuotaInfoDto, ChatResponseDto, ChatHistoryResponseDto, ChatMessageDto } from './dto/chat-history-response.dto';
import { PurchaseChatQuotaDto, ChatTokenPackageId } from './dto/purchase-chat-quota.dto';
import { SuggestMealResponseDto, SuggestedMealItemDto, NutritionGapDto } from './dto/suggest-meal-response.dto';

export interface ChatPackageInfo {
  id: string;
  name: string;
  credits: number;
  priceVnd: number;
  description: string;
  isPopular?: boolean;
  bestValue?: boolean;
}

@Injectable()
export class AiService {
  /**
   * Giới hạn số lượt nhận diện ảnh món ăn miễn phí mỗi ngày (5 ảnh/ngày)
   */
  public static readonly DAILY_FREE_LIMIT = 5;

  /**
   * Giới hạn số token trò chuyện với AI Coach miễn phí mỗi ngày (50,000 tokens/ngày)
   */
  public static readonly DAILY_CHAT_TOKEN_LIMIT = 50000;

  /**
   * Danh mục các gói mua thêm lượt chụp ảnh AI
   */
  public static readonly SCAN_PACKAGES: AiScanPackageDto[] = [
    {
      id: 'PACKAGE_10',
      name: 'Gói Khởi Động',
      credits: 10,
      priceVnd: 29000,
      description: '10 lượt chụp ảnh AI nhận diện món ăn (không hết hạn, dùng sau khi hết 5 lượt free/ngày)',
    },
    {
      id: 'PACKAGE_20',
      name: 'Gói Tiêu Chuẩn',
      credits: 20,
      priceVnd: 49000,
      description: '20 lượt chụp ảnh AI nhận diện món ăn (tiết kiệm 15%, không giới hạn thời gian)',
      isPopular: true,
    },
    {
      id: 'PACKAGE_50',
      name: 'Gói Nâng Cao',
      credits: 50,
      priceVnd: 99000,
      description: '50 lượt chụp ảnh AI nhận diện món ăn (tiết kiệm 30%, không giới hạn thời gian)',
    },
    {
      id: 'PACKAGE_100',
      name: 'Gói Siêu Cấp',
      credits: 100,
      priceVnd: 179000,
      description: '100 lượt chụp ảnh AI nhận diện món ăn (tiết kiệm 40%, giá tốt nhất)',
      bestValue: true,
    },
  ];

  /**
   * Danh mục các gói nạp thêm token trò chuyện AI Coach (Tăng thêm 200k, 500k, 1M tokens)
   */
  public static readonly CHAT_TOKEN_PACKAGES: ChatPackageInfo[] = [
    {
      id: 'TOKEN_200K',
      name: 'Gói 200K Tokens',
      credits: 200000,
      priceVnd: 29000,
      description: 'Nạp thêm 200,000 tokens AI Coach (không hết hạn, dùng sau khi hết 50k token free/ngày)',
    },
    {
      id: 'TOKEN_500K',
      name: 'Gói 500K Tokens',
      credits: 500000,
      priceVnd: 59000,
      description: 'Nạp thêm 500,000 tokens AI Coach (tiết kiệm 20%, không hết hạn)',
      isPopular: true,
    },
    {
      id: 'TOKEN_1M',
      name: 'Gói 1 Triệu Tokens',
      credits: 1000000,
      priceVnd: 99000,
      description: 'Nạp thêm 1,000,000 tokens AI Coach (tiết kiệm 35%, thoải mái trò chuyện dài hạn)',
      bestValue: true,
    },
  ];

  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName = this.configService.get<string>('GEMINI_MODEL') || 'gemini-2.0-flash';

    if (apiKey && apiKey !== 'your_gemini_api_key_here' && apiKey.trim() !== '') {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
        this.logger.log(`Google Gemini AI initialized successfully with model: ${this.modelName}`);
      } catch (err) {
        this.logger.warn(`Failed to initialize Google Gemini AI: ${err.message}. Using Smart Fallback.`);
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

  getAvailablePackages(): AiScanPackageDto[] {
    return AiService.SCAN_PACKAGES;
  }

  async purchaseScanCredits(userId: string, dto: PurchaseAiQuotaDto): Promise<AiQuotaResponseDto> {
    let creditsToAdd = 0;
    const packageId = dto.packageId?.trim();
    if (packageId) {
      const pkg = AiService.SCAN_PACKAGES.find((p) => p.id === packageId);
      if (!pkg) {
        throw new BadRequestException(
          `Gói '${packageId}' không tồn tại. Vui lòng chọn: ${AiService.SCAN_PACKAGES.map((p) => p.id).join(', ')}`,
        );
      }
      creditsToAdd = pkg.credits;
    } else if (dto.customCredits && dto.customCredits > 0) {
      creditsToAdd = dto.customCredits;
    } else {
      throw new BadRequestException('Vui lòng cung cấp packageId hoặc customCredits hợp lệ.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        purchasedAiQuota: { increment: creditsToAdd },
      },
    });

    this.logger.log(`User ${userId} đã mua thành công ${creditsToAdd} lượt chụp ảnh AI`);
    return this.getDailyPhotoQuota(userId);
  }

  async getDailyPhotoQuota(userId: string): Promise<AiQuotaResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, purchasedAiQuota: true },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    const freeUsedToday = await this.prisma.apiUsageLog.count({
      where: {
        userId,
        feature: 'food_recognition',
        createdAt: { gte: startOfDay },
      },
    });

    const dailyFreeLimit = AiService.DAILY_FREE_LIMIT;
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

  private async checkAndDetermineQuotaType(
    userId: string,
  ): Promise<{ quota: AiQuotaResponseDto; usedQuotaType: 'FREE' | 'PURCHASED' }> {
    const quota = await this.getDailyPhotoQuota(userId);

    if (quota.totalRemaining <= 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Bạn đã sử dụng hết 5 lượt chụp ảnh miễn phí hôm nay và không còn lượt mua thêm. Hãy mua thêm gói lượt chụp hoặc quay lại vào ngày mai nhé!',
          error: 'Too Many Requests',
          dailyFreeLimit: quota.dailyFreeLimit,
          freeUsedToday: quota.freeUsedToday,
          freeRemaining: 0,
          purchasedCredits: 0,
          totalRemaining: 0,
          resetsAt: quota.resetsAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const usedQuotaType: 'FREE' | 'PURCHASED' = quota.freeRemaining > 0 ? 'FREE' : 'PURCHASED';
    return { quota, usedQuotaType };
  }

  private async deductQuotaAfterSuccess(
    userId: string,
    usedQuotaType: 'FREE' | 'PURCHASED',
    quota: AiQuotaResponseDto,
    tokens: { promptTokens: number; outputTokens: number; costUsd: number },
  ): Promise<{ freeRemaining: number; purchasedCredits: number; totalRemaining: number }> {
    if (usedQuotaType === 'FREE') {
      await this.logApiUsage(userId, 'food_recognition', tokens.promptTokens, tokens.outputTokens, tokens.costUsd);
      const newFreeRemaining = Math.max(0, quota.freeRemaining - 1);
      const newPurchased = quota.purchasedCredits;
      return {
        freeRemaining: newFreeRemaining,
        purchasedCredits: newPurchased,
        totalRemaining: newFreeRemaining + newPurchased,
      };
    } else {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          purchasedAiQuota: { decrement: 1 },
        },
      });
      await this.logApiUsage(userId, 'food_recognition_paid', tokens.promptTokens, tokens.outputTokens, tokens.costUsd);
      const newPurchased = Math.max(0, quota.purchasedCredits - 1);
      return {
        freeRemaining: 0,
        purchasedCredits: newPurchased,
        totalRemaining: newPurchased,
      };
    }
  }

  // =========================================================================
  // PHẦN 2: QUẢN LÝ QUOTA & GÓI CHAT AI COACH THEO TOKEN (50K TOKEN/NGÀY + MUA TOKEN)
  // =========================================================================

  getAvailableChatPackages(): ChatPackageInfo[] {
    return AiService.CHAT_TOKEN_PACKAGES;
  }

  async purchaseChatCredits(userId: string, dto: PurchaseChatQuotaDto): Promise<ChatQuotaInfoDto> {
    let creditsToAdd = 0;

    if (dto.packageId === ChatTokenPackageId.CUSTOM) {
      if (!dto.customCredits || dto.customCredits <= 0) {
        throw new BadRequestException('Vui lòng nhập số token customCredits hợp lệ (> 0).');
      }
      creditsToAdd = dto.customCredits;
    } else {
      const pkg = AiService.CHAT_TOKEN_PACKAGES.find((p) => p.id === dto.packageId);
      if (!pkg) {
        throw new BadRequestException(
          `Gói token '${dto.packageId}' không tồn tại. Vui lòng chọn: ${AiService.CHAT_TOKEN_PACKAGES.map((p) => p.id).join(', ')}`,
        );
      }
      creditsToAdd = pkg.credits;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        purchasedChatQuota: { increment: creditsToAdd },
      },
    });

    this.logger.log(`User ${userId} đã nạp thành công ${creditsToAdd.toLocaleString()} tokens AI Coach`);
    return this.getDailyChatQuota(userId);
  }

  async getDailyChatQuota(userId: string): Promise<ChatQuotaInfoDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true, purchasedChatQuota: true },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    // Tính tổng số token đã dùng trong ngày hôm nay từ ApiUsageLog
    const usageToday = await this.prisma.apiUsageLog.findMany({
      where: {
        userId,
        feature: 'chat_coach',
        createdAt: { gte: startOfDay },
      },
      select: { promptTokens: true, outputTokens: true },
    });

    const freeUsedToday = usageToday.reduce(
      (acc, log) => acc + (log.promptTokens || 0) + (log.outputTokens || 0),
      0,
    );

    const dailyFreeLimit = AiService.DAILY_CHAT_TOKEN_LIMIT; // 50,000 tokens
    const freeRemaining = Math.max(0, dailyFreeLimit - freeUsedToday);
    const purchasedCredits = Math.max(0, user?.purchasedChatQuota ?? 0);
    const totalRemaining = freeRemaining + purchasedCredits;

    return {
      dailyFreeLimit,
      freeRemaining,
      purchasedCredits,
      totalRemaining,
      resetsAt: resetsAt.toISOString(),
    };
  }

  private async checkAndDetermineChatQuota(
    userId: string,
  ): Promise<{ quota: ChatQuotaInfoDto; usedQuotaType: 'FREE' | 'PURCHASED' }> {
    const quota = await this.getDailyChatQuota(userId);

    if (quota.totalRemaining <= 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Bạn đã sử dụng hết 50,000 tokens AI Coach miễn phí hôm nay và không còn đủ token mua thêm. Hãy nạp thêm gói token (+200k, +500k, +1M) để tiếp tục trò chuyện hoặc quay lại vào ngày mai nhé!',
          error: 'Too Many Requests',
          dailyFreeLimit: quota.dailyFreeLimit,
          freeRemaining: 0,
          purchasedCredits: 0,
          totalRemaining: 0,
          resetsAt: quota.resetsAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const usedQuotaType: 'FREE' | 'PURCHASED' = quota.freeRemaining > 0 ? 'FREE' : 'PURCHASED';
    return { quota, usedQuotaType };
  }

  private async deductChatQuotaAfterSuccess(
    userId: string,
    usedQuotaType: 'FREE' | 'PURCHASED',
    quota: ChatQuotaInfoDto,
    tokens: { promptTokens: number; outputTokens: number; costUsd: number },
  ): Promise<ChatQuotaInfoDto> {
    const totalTokensConsumed = tokens.promptTokens + tokens.outputTokens;

    if (usedQuotaType === 'FREE') {
      if (totalTokensConsumed <= quota.freeRemaining) {
        // Đủ quota miễn phí
        await this.logApiUsage(userId, 'chat_coach', tokens.promptTokens, tokens.outputTokens, tokens.costUsd);
        const newFree = Math.max(0, quota.freeRemaining - totalTokensConsumed);
        return {
          ...quota,
          freeRemaining: newFree,
          totalRemaining: newFree + quota.purchasedCredits,
        };
      } else {
        // Vượt quá phần free còn lại -> trừ hết phần free, phần dôi dư trừ vào purchased
        const overflow = totalTokensConsumed - quota.freeRemaining;
        await this.logApiUsage(userId, 'chat_coach', quota.freeRemaining, 0, tokens.costUsd);

        const deductFromPurchased = Math.min(quota.purchasedCredits, overflow);
        if (deductFromPurchased > 0) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { purchasedChatQuota: { decrement: deductFromPurchased } },
          });
          await this.logApiUsage(userId, 'chat_coach_paid', deductFromPurchased, 0, 0);
        }

        const newPurchased = Math.max(0, quota.purchasedCredits - deductFromPurchased);
        return {
          ...quota,
          freeRemaining: 0,
          purchasedCredits: newPurchased,
          totalRemaining: newPurchased,
        };
      }
    } else {
      // Đã hết 50k free -> Trừ thẳng vào token đã mua (purchasedChatQuota)
      const deductAmount = Math.min(quota.purchasedCredits, totalTokensConsumed);
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          purchasedChatQuota: { decrement: deductAmount },
        },
      });
      await this.logApiUsage(userId, 'chat_coach_paid', tokens.promptTokens, tokens.outputTokens, tokens.costUsd);
      const newPurchased = Math.max(0, quota.purchasedCredits - deductAmount);
      return {
        ...quota,
        freeRemaining: 0,
        purchasedCredits: newPurchased,
        totalRemaining: newPurchased,
      };
    }
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
      this.logger.warn(`Could not cleanup old chat messages for user ${userId}: ${e.message}`);
    }
  }

  /**
   * Lấy lịch sử hội thoại trong 7 ngày gần nhất
   */
  async getChatHistory(userId: string): Promise<ChatHistoryResponseDto> {
    await this.cleanupOldChatMessages(userId);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const messages = await this.prisma.aiMessage.findMany({
      where: {
        userId,
        createdAt: { gte: sevenDaysAgo },
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
  async clearChatHistory(userId: string): Promise<{ success: boolean; message: string }> {
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
    // 1. Kiểm tra hạn mức chat (10 tin free/ngày hoặc lượt mua thêm)
    const { quota, usedQuotaType } = await this.checkAndDetermineChatQuota(userId);

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
      },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    // 4. Lấy dữ liệu các bữa ăn ĐÃ ĂN HÔM NAY từ bảng Meal kèm các món chi tiết
    const todayMeals = await this.prisma.meal.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lt: resetsAt },
      },
      include: {
        items: true,
      },
      orderBy: { date: 'asc' },
    });

    const consumedCalories = todayMeals.reduce((acc, m) => acc + (m.totalCalories || 0), 0);
    const consumedProtein = todayMeals.reduce((acc, m) => acc + (m.totalProtein || 0), 0);
    const consumedCarb = todayMeals.reduce((acc, m) => acc + (m.totalCarb || 0), 0);
    const consumedFat = todayMeals.reduce((acc, m) => acc + (m.totalFat || 0), 0);

    const targetCalories = user?.targetCalories || 2000;
    const targetProtein = user?.targetProtein || 140;
    const targetCarb = user?.targetCarb || 200;
    const targetFat = user?.targetFat || 60;

    const remainingCalories = Math.round(targetCalories - consumedCalories);
    const remainingProtein = Math.round(targetProtein - consumedProtein);
    const remainingCarb = Math.round(targetCarb - consumedCarb);
    const remainingFat = Math.round(targetFat - consumedFat);

    const mealSummary =
      todayMeals.length > 0
        ? todayMeals
            .map((m) => {
              const itemNames = m.items.map((i) => `${i.name} (${Math.round(i.calories)} kcal)`).join(', ');
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
      .map((m) => `${m.role === 'user' ? 'Người dùng' : 'AI Coach'}: ${m.content}`)
      .join('\n');

    let reply = '';
    let promptTokens = 0;
    let outputTokens = 0;

    // 6. Gọi Gemini nếu có API key
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 600,
          },
        });

        const prompt = `
BẠN LÀ AI NUTRITION & FITNESS COACH CỦA ỨNG DỤNG CALAI (VIỆT NAM).
Nhiệm vụ: Tư vấn dinh dưỡng, chế độ ăn, tập luyện khoa học, thân thiện, súc tích bằng tiếng Việt.

*** QUY TẮC BẢO VỆ CHỦ ĐỀ QUAN TRỌNG (TOPIC GUARDRAILS - TIẾT KIỆM TOKEN): ***
1. BẠN CHỈ ĐƯỢC PHÉP trả lời các câu hỏi liên quan đến:
   - Dinh dưỡng, thực phẩm, calo, macro (protein, carb, fat), nước uống.
   - Giảm mỡ, tăng cơ, duy trì vóc dáng, chế độ ăn Eat Clean / Keto / IF / Gym.
   - Các bài tập thể dục, gym, cardio, phục hồi cơ bắp, thói quen vận động lành mạnh.
2. TUYỆT ĐỐI KHÔNG giải đáp các chủ đề ngoài lề (như: lập trình code, giải toán, dịch thuật, thơ ca, viết văn, lịch sử, chính trị, công nghệ, sửa xe, pháp lý, tin tức giải trí...).
3. NẾU NGƯỜI DÙNG HỎI CHỦ ĐỀ NGOÀI LỀ:
   - Hãy từ chối một cách lịch sự, NGẮN GỌN DƯỚI 30 TỪ và hướng người dùng quay lại chủ đề dinh dưỡng/gym.
   - Mẫu từ chối: "Tôi là CalAI Nutrition Coach, chỉ hỗ trợ tư vấn dinh dưỡng, calo và tập luyện thể hình. Hãy cho tôi biết bạn cần hỗ trợ gì về bữa ăn hôm nay nhé!"

--- THÔNG TIN NGƯỜI DÙNG ---
- Tên: ${user?.name || 'Bạn'}
- Mục tiêu: ${user?.goal || 'Duy trì vóc dáng'} (Cân nặng: ${user?.weightKg || 65}kg -> Mục tiêu: ${user?.targetWeightKg || 60}kg)
- Mục tiêu mỗi ngày: ${targetCalories} kcal | ${targetProtein}g Protein | ${targetCarb}g Carb | ${targetFat}g Fat
- Hôm nay đã nạp: ${consumedCalories} kcal | ${consumedProtein}g Protein | ${consumedCarb}g Carb | ${consumedFat}g Fat
- Còn lại trong ngày: ${remainingCalories} kcal | ${remainingProtein}g Protein | ${remainingCarb}g Carb | ${remainingFat}g Fat

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
        outputTokens = usage?.candidatesTokenCount || Math.ceil(reply.length / 4);
      } catch (err) {
        this.logger.error(`Lỗi khi gọi Gemini Chat: ${err.message}. Chuyển sang Smart Fallback.`);
      }
    }

    // 7. Fallback thông minh nếu không có key hoặc API lỗi
    if (!reply) {
      reply = this.generateSmartChatFallback(userMessage, remainingCalories, remainingProtein, user?.goal || '');
      promptTokens = Math.ceil((userMessage.length + formattedHistory.length + mealSummary.length) / 4);
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

    // 9. Khấu trừ quota tokens theo số token tiêu thụ thực tế
    const tokensUsed = promptTokens + outputTokens;
    const updatedQuota = await this.deductChatQuotaAfterSuccess(userId, usedQuotaType, quota, {
      promptTokens,
      outputTokens,
      costUsd: (tokensUsed / 1000) * 0.00015,
    });

    return {
      reply,
      tokensUsed,
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
    const offTopicKeywords = ['lập trình', 'viết code', 'python', 'javascript', 'bài thơ', 'toán học', 'chính trị', 'tổng thống', 'giải phương trình'];
    if (offTopicKeywords.some((k) => msgLower.includes(k))) {
      return 'Tôi là CalAI Nutrition Coach, chỉ hỗ trợ tư vấn dinh dưỡng, calo và tập luyện thể hình. Hãy cho tôi biết bạn cần hỗ trợ gì về bữa ăn hôm nay nhé!';
    }

    if (msgLower.includes('tối') || msgLower.includes('ăn gì') || msgLower.includes('gợi ý')) {
      return `Hôm nay bạn còn khoảng ${remainingCalories > 0 ? remainingCalories : 0} kcal và cần bổ sung thêm ~${remainingProtein > 0 ? remainingProtein : 0}g protein.
Bạn có thể tham khảo 1 tô Phở gà ức ít bánh (~420 kcal, 38g đạm) hoặc 1 đĩa Salad ức gà áp chảo sốt mè rang (~350 kcal, 35g đạm). Cả hai món đều bổ sung đạm rất tốt mà không lo vượt calo trong ngày!`;
    }

    if (msgLower.includes('tập') || msgLower.includes('gym') || msgLower.includes('cardio')) {
      return `Với mục tiêu ${goal || 'sức khỏe'} hiện tại, bạn nên duy trì 45-60 phút tập kháng lực (kháng tạ) kết hợp 15 phút cardio cuối buổi. Nhớ uống đủ nước và nạp 20-30g protein sau buổi tập để cơ bắp phục hồi tối ưu nhé!`;
    }

    return `Chào bạn! Dựa trên mục tiêu dinh dưỡng hôm nay (còn thiếu ${remainingCalories > 0 ? remainingCalories : 0} kcal, ${remainingProtein > 0 ? remainingProtein : 0}g protein), tôi khuyến nghị bạn tập trung vào nguồn đạm sạch (ức gà, cá basa, trứng chần, đậu hũ) kết hợp nhiều rau xanh. Nếu bạn cần gợi ý thực đơn cụ thể cho từng bữa, cứ hỏi tôi nhé!`;
  }

  // =========================================================================
  // PHẦN 5: AI SUGGEST MEAL (GỢI Ý MÓN ĂN VIỆT NAM THÔNG MINH BÙ TRỪ DINH DƯỠNG)
  // =========================================================================

  async suggestMeal(userId: string): Promise<SuggestMealResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        goal: true,
        targetCalories: true,
        targetProtein: true,
        targetCarb: true,
        targetFat: true,
        timezone: true,
      },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    const todayMeals = await this.prisma.meal.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lt: resetsAt },
      },
    });

    const consumedCalories = todayMeals.reduce((acc, m) => acc + (m.totalCalories || 0), 0);
    const consumedProtein = todayMeals.reduce((acc, m) => acc + (m.totalProtein || 0), 0);
    const consumedCarb = todayMeals.reduce((acc, m) => acc + (m.totalCarb || 0), 0);
    const consumedFat = todayMeals.reduce((acc, m) => acc + (m.totalFat || 0), 0);

    const targetCalories = user?.targetCalories || 2000;
    const targetProtein = user?.targetProtein || 140;
    const targetCarb = user?.targetCarb || 200;
    const targetFat = user?.targetFat || 60;

    const remainingCalories = Math.max(0, Math.round(targetCalories - consumedCalories));
    const remainingProtein = Math.max(0, Math.round(targetProtein - consumedProtein));
    const remainingCarbs = Math.max(0, Math.round(targetCarb - consumedCarb));
    const remainingFat = Math.max(0, Math.round(targetFat - consumedFat));

    const nutritionGap: NutritionGapDto = {
      remainingCalories,
      remainingProtein,
      remainingCarbs,
      remainingFat,
    };

    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3,
          },
        });

        const prompt = `
Bạn là chuyên gia dinh dưỡng thể hình hàng đầu tại Việt Nam.
Người dùng đang có mục tiêu: ${user?.goal || 'Duy trì vóc dáng'}.
Ngân sách dinh dưỡng CÒN THIẾU hôm nay cần bù đắp:
- Calo còn thiếu: ${remainingCalories} kcal
- Protein còn thiếu: ${remainingProtein} g
- Carbs còn thiếu: ${remainingCarbs} g
- Fat còn thiếu: ${remainingFat} g

Nhiệm vụ: Gợi ý CHÍNH XÁC 1-2 món ăn Việt Nam quen thuộc, phổ biến, dễ mua hoặc dễ nấu để bù đắp vừa vặn nhất cho lượng calo và macro còn thiếu này.

Định dạng JSON trả về DUY NHẤT:
{
  "advice": "Lời khuyên tổng quan súc tích về tình trạng dinh dưỡng hôm nay (1-2 câu)",
  "suggestions": [
    {
      "name": "Tên món ăn Việt Nam (kèm định lượng)",
      "mealType": "Bữa tối / Bữa phụ",
      "calories": 450,
      "protein": 38,
      "carbs": 45,
      "fat": 10,
      "reason": "Giải thích vì sao món này phù hợp nhất với lượng calo/macro còn thiếu hôm nay",
      "ingredients": ["Thành phần 1", "Thành phần 2"]
    }
  ]
}
`;

        const response = await model.generateContent(prompt);
        const text = response.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);

        return {
          nutritionGap,
          suggestions: parsed.suggestions || [],
          advice: parsed.advice || `Bạn còn thiếu ${remainingProtein}g protein và ${remainingCalories} kcal. Hãy nạp thêm bữa ăn lành mạnh nhé!`,
        };
      } catch (err) {
        this.logger.error(`Lỗi khi gọi Gemini Suggest Meal: ${err.message}. Chuyển sang Smart Fallback.`);
      }
    }

    // Smart Fallback gợi ý món Việt thông minh
    return this.getSmartMealSuggestions(nutritionGap);
  }

  private getSmartMealSuggestions(gap: NutritionGapDto): SuggestMealResponseDto {
    const suggestions: SuggestedMealItemDto[] = [];

    if (gap.remainingProtein >= 30) {
      suggestions.push({
        name: 'Phở gà ức ít bánh + 2 trứng chần',
        mealType: 'Bữa tối giàu đạm',
        calories: Math.min(gap.remainingCalories, 480),
        protein: 42,
        carbs: 50,
        fat: 10,
        reason: 'Cung cấp lượng protein tinh khiết dồi dào từ ức gà và trứng, bù đắp tức thì chỉ tiêu protein còn thiếu trong ngày.',
        ingredients: ['150g ức gà xé', '150g bánh phở tươi', '2 quả trứng chần', 'Giá đỗ và rau thơm'],
      });
      suggestions.push({
        name: 'Cơm gạo lứt + Ức gà nướng áp chảo + Bông cải luộc',
        mealType: 'Bữa tối Eat Clean',
        calories: Math.min(gap.remainingCalories, 450),
        protein: 45,
        carbs: 48,
        fat: 8,
        reason: 'Tinh bột hấp thu chậm từ gạo lứt và protein nạc giúp no lâu, chống dị hóa cơ ban đêm.',
        ingredients: ['150g cơm gạo lứt', '180g ức gà ướp sốt tỏi ớt', '150g bông cải xanh luộc'],
      });
    } else if (gap.remainingCalories > 200) {
      suggestions.push({
        name: 'Salad ức gà xé sốt mè rang',
        mealType: 'Bữa tối nhẹ nhàng',
        calories: 320,
        protein: 28,
        carbs: 16,
        fat: 12,
        reason: 'Lượng calo vừa phải, bổ sung chất xơ và đủ lượng protein còn thiếu nhẹ trong ngày.',
        ingredients: ['100g ức gà luộc xé', 'Xà lách, dưa leo, cà chua bi', '2 thìa sốt mè rang'],
      });
    } else {
      suggestions.push({
        name: '1 Hũ Sữa chua Hy Lạp + 1 thìa hạt chia',
        mealType: 'Bữa phụ nhẹ',
        calories: 140,
        protein: 15,
        carbs: 10,
        fat: 4,
        reason: 'Calo rất thấp, bổ sung men vi sinh và đạm casein tiêu hóa chậm giúp ngủ ngon.',
        ingredients: ['100g sữa chua Hy Lạp không đường', '10g hạt chia'],
      });
    }

    return {
      nutritionGap: gap,
      suggestions,
      advice: `Hôm nay bạn còn thiếu ${gap.remainingProtein}g Protein và ${gap.remainingCalories} kcal. Hãy ưu tiên nạp nguồn đạm nạc để hoàn thành mục tiêu ngày nhé!`,
    };
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
    const { quota, usedQuotaType } = await this.checkAndDetermineQuotaType(userId);
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    if (this.genAI) {
      try {
        const result = await this.callGeminiVision(cleanBase64, mimeType);
        if (result) {
          const remaining = await this.deductQuotaAfterSuccess(userId, usedQuotaType, quota, {
            promptTokens: 500,
            outputTokens: 200,
            costUsd: 0.0005,
          });

          return {
            ...result,
            usedQuotaType,
            freeRemaining: remaining.freeRemaining,
            purchasedCredits: remaining.purchasedCredits,
            totalRemaining: remaining.totalRemaining,
            remainingDailyQuota: remaining.totalRemaining,
            dailyLimit: AiService.DAILY_FREE_LIMIT,
            isFallback: false,
          };
        }
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        this.logger.error(`Lỗi khi gọi Gemini Vision API: ${error.message}. Chuyển sang Smart Fallback.`);
      }
    }

    const remaining = await this.deductQuotaAfterSuccess(userId, usedQuotaType, quota, {
      promptTokens: 100,
      outputTokens: 50,
      costUsd: 0,
    });

    const fallback = this.getSmartFallbackRecognition();
    return {
      ...fallback,
      usedQuotaType,
      freeRemaining: remaining.freeRemaining,
      purchasedCredits: remaining.purchasedCredits,
      totalRemaining: remaining.totalRemaining,
      remainingDailyQuota: remaining.totalRemaining,
      dailyLimit: AiService.DAILY_FREE_LIMIT,
      isFallback: true,
    };
  }

  private async callGeminiVision(base64Data: string, mimeType: string): Promise<FoodRecognitionResultDto | null> {
    if (!this.genAI) return null;
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
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

    const response = await model.generateContent([prompt, imagePart]);
    const responseText = response.response.text();

    try {
      const cleanJson = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.isFood === false) {
        throw new BadRequestException(
          parsed.message || 'Hình ảnh không phải là món ăn hoặc quá mờ. Vui lòng chụp rõ món ăn hơn nhé!',
        );
      }

      return {
        foodName: parsed.foodName || 'Món ăn hỗn hợp',
        confidenceScore: typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.9,
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
      this.logger.error(`Failed to parse Gemini JSON response: ${responseText}`);
      return null;
    }
  }

  private getSmartFallbackRecognition(): FoodRecognitionResultDto {
    const mockDishes: FoodRecognitionResultDto[] = [
      {
        foodName: 'Phở bò tái nạm',
        confidenceScore: 0.94,
        servingSize: '1 tô vừa (~450g)',
        totalCalories: 480,
        totalProtein: 32,
        totalCarb: 62,
        totalFat: 12,
        items: [
          { name: 'Bánh phở tươi', servingSize: '200g', calories: 220, protein: 4, carb: 48, fat: 1 },
          { name: 'Thịt bò tái & nạm', servingSize: '120g', calories: 200, protein: 26, carb: 0, fat: 10 },
          { name: 'Nước dùng & hành ngò', servingSize: '1 tô', calories: 60, protein: 2, carb: 14, fat: 1 },
        ],
        healthTip:
          'Món ăn giàu đạm chất lượng cao và năng lượng dễ hấp thu. Có thể thêm giá đỗ, húng quế và vắt thêm chanh để bổ sung vitamin C.',
        isFallback: true,
      },
      {
        foodName: 'Cơm tấm sườn nướng',
        confidenceScore: 0.92,
        servingSize: '1 đĩa vừa (~400g)',
        totalCalories: 560,
        totalProtein: 28,
        totalCarb: 70,
        totalFat: 18,
        items: [
          { name: 'Cơm tấm trắng', servingSize: '1 chén (~160g)', calories: 220, protein: 4, carb: 48, fat: 1 },
          { name: 'Sườn heo nướng', servingSize: '1 miếng (~120g)', calories: 280, protein: 22, carb: 6, fat: 17 },
          { name: 'Đồ chua & dưa leo', servingSize: '1 phần', calories: 30, protein: 1, carb: 6, fat: 0 },
          { name: 'Mỡ hành', servingSize: '1 thìa', calories: 30, protein: 0, carb: 0, fat: 3 },
        ],
        healthTip:
          'Bữa ăn ngon miệng và giàu protein. Nếu đang kiểm soát calo nghiêm ngặt, bạn có thể yêu cầu giảm lượng mỡ hành chan lên cơm.',
        isFallback: true,
      },
    ];

    const selected = mockDishes[Math.floor(Math.random() * mockDishes.length)];
    return {
      ...selected,
      healthTip: `${selected.healthTip} (💡 Smart Fallback đang kích hoạt: bạn có thể cấu hình GEMINI_API_KEY trong .env để nhận diện ảnh thực tế)`,
    };
  }

  // =========================================================================
  // TIỆN ÍCH HỆ THỐNG
  // =========================================================================

  private getTimezoneDayBounds(timezone: string = 'Asia/Ho_Chi_Minh'): { startOfDay: Date; resetsAt: Date } {
    const now = new Date();
    const ymd = now.toLocaleDateString('en-CA', { timeZone: timezone });
    const startOfDay = new Date(`${ymd}T00:00:00+07:00`);
    const resetsAt = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    return { startOfDay, resetsAt };
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
