import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { MealsService } from '../meals/meals.service';
import { WeeklySummaryResponseDto } from './dto/weekly-summary-response.dto';

@Injectable()
export class WeeklySummaryService {
  private readonly logger = new Logger(WeeklySummaryService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private readonly chatModelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mealsService: MealsService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.chatModelName =
      this.configService.get<string>('GEMINI_CHAT_MODEL') ||
      this.configService.get<string>('GEMINI_MODEL') ||
      'gemini-3.5-flash-lite';

    if (
      apiKey &&
      apiKey !== 'your_gemini_api_key_here' &&
      apiKey.trim() !== ''
    ) {
      try {
        this.genAI = new GoogleGenerativeAI(apiKey.trim());
      } catch (err) {
        this.logger.warn(
          `Failed to initialize Google Gemini AI: ${err.message}. Using Smart Fallback.`,
        );
      }
    } else {
      this.logger.warn(
        'GEMINI_API_KEY is not configured or is default. Smart Fallback Engine will be active for Weekly Summary.',
      );
    }
  }

  /**
   * Lấy tổng hợp tuần hiện tại (Thứ 2 -> hiện tại). Sinh mới & cache lại nếu
   * chưa có bản ghi cho tuần này hoặc bản ghi đã cũ (khác tuần hiện tại) —
   * tương tự cách tiếp cận "lazy-generate" đã dùng ở AiMessage/Check-in,
   * tránh gọi Gemini lặp lại nhiều lần trong cùng một tuần.
   */
  async getWeeklySummary(userId: string): Promise<WeeklySummaryResponseDto> {
    const { weekStartDate, weekEndDate } = this.getCurrentWeekRange();

    const cached = await this.prisma.weeklySummary.findUnique({
      where: { userId_weekStartDate: { userId, weekStartDate } },
    });

    if (cached) {
      return this.toDto(cached);
    }

    return this.generateWeeklySummary(userId, weekStartDate, weekEndDate);
  }

  /**
   * Buộc tạo lại tổng hợp tuần hiện tại (bỏ qua cache) — dùng nếu client
   * muốn refresh thủ công.
   */
  async regenerateWeeklySummary(
    userId: string,
  ): Promise<WeeklySummaryResponseDto> {
    const { weekStartDate, weekEndDate } = this.getCurrentWeekRange();
    return this.generateWeeklySummary(userId, weekStartDate, weekEndDate);
  }

  private async generateWeeklySummary(
    userId: string,
    weekStartDate: Date,
    weekEndDate: Date,
  ): Promise<WeeklySummaryResponseDto> {
    const now = new Date();
    const until = now < weekEndDate ? now : weekEndDate;

    const startStr = weekStartDate.toISOString().split('T')[0];
    const untilStr = until.toISOString().split('T')[0];

    // 1. Tái sử dụng thống kê dinh dưỡng đã có sẵn ở MealsService
    const nutritionStats = await this.mealsService.getNutritionStatistics(
      userId,
      startStr,
      untilStr,
    );
    const { dailyCalories, dailyProtein, dailyCarb, dailyFat } =
      nutritionStats.data.averages;
    const hasNutritionData = nutritionStats.data.dailyStats.length > 0;

    // 2. Số buổi tập đã hoàn thành trong tuần
    const workoutsCompleted = await this.prisma.workoutLog.count({
      where: { userId, date: { gte: weekStartDate, lte: until } },
    });

    // 3. Thay đổi cân nặng trong tuần (so với bản ghi gần nhất trước tuần này)
    const weightChangeKg = await this.computeWeightChange(
      userId,
      weekStartDate,
      until,
    );

    const avgCalories = hasNutritionData ? dailyCalories : null;
    const avgProtein = hasNutritionData ? dailyProtein : null;
    const avgFat = hasNutritionData ? dailyFat : null;
    const avgCarb = hasNutritionData ? dailyCarb : null;

    // 4. Sinh highlight tự nhiên bằng Gemini (kèm Smart Fallback)
    const { highlightText, isFallback } = await this.generateHighlight({
      avgCalories,
      avgProtein,
      avgFat,
      avgCarb,
      weightChangeKg,
      workoutsCompleted,
    });

    const saved = await this.prisma.weeklySummary.upsert({
      where: { userId_weekStartDate: { userId, weekStartDate } },
      update: {
        weekEndDate,
        avgCalories,
        avgProtein,
        avgFat,
        avgCarb,
        weightChangeKg,
        workoutsCompleted,
        highlightText,
        isFallback,
        generatedAt: new Date(),
      },
      create: {
        userId,
        weekStartDate,
        weekEndDate,
        avgCalories,
        avgProtein,
        avgFat,
        avgCarb,
        weightChangeKg,
        workoutsCompleted,
        highlightText,
        isFallback,
      },
    });

    return this.toDto(saved);
  }

  private async computeWeightChange(
    userId: string,
    weekStartDate: Date,
    until: Date,
  ): Promise<number | null> {
    // Bản ghi cuối cùng trước khi tuần bắt đầu (làm mốc baseline)
    const baselineLog = await this.prisma.weightLog.findFirst({
      where: { userId, date: { lt: weekStartDate } },
      orderBy: { date: 'desc' },
    });

    // Bản ghi mới nhất trong tuần (tính đến hiện tại)
    const latestLogInWeek = await this.prisma.weightLog.findFirst({
      where: { userId, date: { gte: weekStartDate, lte: until } },
      orderBy: { date: 'desc' },
    });

    if (!latestLogInWeek) return null;

    const baseline = baselineLog?.weightKg ?? null;
    if (baseline === null) {
      // Không có mốc trước tuần này -> so với bản ghi đầu tiên trong tuần
      const firstLogInWeek = await this.prisma.weightLog.findFirst({
        where: { userId, date: { gte: weekStartDate, lte: until } },
        orderBy: { date: 'asc' },
      });
      if (!firstLogInWeek || firstLogInWeek.id === latestLogInWeek.id) {
        return null;
      }
      return (
        Math.round(
          (latestLogInWeek.weightKg - firstLogInWeek.weightKg) * 10,
        ) / 10
      );
    }

    return Math.round((latestLogInWeek.weightKg - baseline) * 10) / 10;
  }

  private async generateHighlight(stats: {
    avgCalories: number | null;
    avgProtein: number | null;
    avgFat: number | null;
    avgCarb: number | null;
    weightChangeKg: number | null;
    workoutsCompleted: number;
  }): Promise<{ highlightText: string; isFallback: boolean }> {
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.chatModelName,
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 256,
          },
        });

        const prompt = `
Bạn là AI Nutrition & Fitness Coach của ứng dụng CalAI (Việt Nam).
Dựa trên dữ liệu tổng hợp 7 ngày gần nhất của người dùng, hãy viết một đoạn highlight ngắn gọn (2-4 câu), bằng tiếng Việt, giọng văn thân thiện, động viên, để hiển thị trong mục "Weekly Summary" của app.

--- DỮ LIỆU TUẦN QUA ---
- Trung bình calo/ngày: ${stats.avgCalories !== null ? `${stats.avgCalories} kcal` : 'chưa có dữ liệu log bữa ăn'}
- Trung bình protein/ngày: ${stats.avgProtein !== null ? `${stats.avgProtein} g` : 'chưa có dữ liệu'}
- Trung bình carb/ngày: ${stats.avgCarb !== null ? `${stats.avgCarb} g` : 'chưa có dữ liệu'}
- Trung bình fat/ngày: ${stats.avgFat !== null ? `${stats.avgFat} g` : 'chưa có dữ liệu'}
- Thay đổi cân nặng trong tuần: ${stats.weightChangeKg !== null ? `${stats.weightChangeKg > 0 ? '+' : ''}${stats.weightChangeKg} kg` : 'chưa có dữ liệu cân nặng mới'}
- Số buổi tập đã hoàn thành: ${stats.workoutsCompleted} buổi

Yêu cầu: KHÔNG lặp lại nguyên văn các con số dạng bảng, hãy viết thành câu văn tự nhiên, súc tích, nêu bật điểm tích cực và một gợi ý nhỏ nếu phù hợp. CHỈ trả về đoạn văn, không thêm tiêu đề hay ký hiệu markdown.
`;

        const response = await model.generateContent(prompt);
        const text = response.response.text().trim();
        if (text) {
          return { highlightText: text, isFallback: false };
        }
      } catch (err) {
        this.logger.error(
          `Lỗi khi gọi Gemini Weekly Summary: ${err.message}. Chuyển sang Smart Fallback.`,
        );
      }
    }

    return {
      highlightText: this.buildFallbackHighlight(stats),
      isFallback: true,
    };
  }

  /**
   * Smart Fallback: câu văn tiếng Việt được ghép từ số liệu, dùng khi Gemini
   * không khả dụng hoặc chưa cấu hình — cùng nguyên tắc "Smart Fallback"
   * đã áp dụng ở ai/suggest-meal và ai/recognize-food.
   */
  private buildFallbackHighlight(stats: {
    avgCalories: number | null;
    weightChangeKg: number | null;
    workoutsCompleted: number;
  }): string {
    const parts: string[] = [];

    if (stats.avgCalories !== null) {
      parts.push(
        `Tuần này bạn duy trì ăn uống quanh mức ${stats.avgCalories} kcal/ngày`,
      );
    } else {
      parts.push('Tuần này bạn chưa ghi nhận nhiều bữa ăn');
    }

    if (stats.weightChangeKg !== null) {
      if (stats.weightChangeKg < 0) {
        parts.push(`giảm được ${Math.abs(stats.weightChangeKg)} kg`);
      } else if (stats.weightChangeKg > 0) {
        parts.push(`tăng ${stats.weightChangeKg} kg`);
      } else {
        parts.push('giữ cân nặng ổn định');
      }
    }

    if (stats.workoutsCompleted > 0) {
      parts.push(`đã hoàn thành ${stats.workoutsCompleted} buổi tập`);
    } else {
      parts.push('chưa ghi nhận buổi tập nào');
    }

    const sentence = `${parts.join(', ')}. `;
    const tip =
      stats.workoutsCompleted === 0
        ? 'Hãy thử thêm 1-2 buổi vận động nhẹ trong tuần tới nhé!'
        : 'Tiếp tục duy trì thói quen tốt này nhé! 💪';

    return `${sentence}${tip} (💡 Smart Fallback đang kích hoạt: bạn có thể cấu hình GEMINI_API_KEY trong .env để nhận narrative do AI viết)`;
  }

  private toDto(row: {
    weekStartDate: Date;
    weekEndDate: Date;
    avgCalories: number | null;
    avgProtein: number | null;
    avgFat: number | null;
    avgCarb: number | null;
    weightChangeKg: number | null;
    workoutsCompleted: number;
    highlightText: string;
    isFallback: boolean;
    generatedAt: Date;
  }): WeeklySummaryResponseDto {
    return {
      weekStartDate: row.weekStartDate.toISOString().split('T')[0],
      weekEndDate: row.weekEndDate.toISOString().split('T')[0],
      avgCalories: row.avgCalories,
      avgProtein: row.avgProtein,
      avgFat: row.avgFat,
      avgCarb: row.avgCarb,
      weightChangeKg: row.weightChangeKg,
      workoutsCompleted: row.workoutsCompleted,
      highlightText: row.highlightText,
      isFallback: row.isFallback,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  /**
   * Tuần bắt đầu Thứ 2, kết thúc Chủ Nhật — cùng quy ước với CheckinsService.
   */
  private getCurrentWeekRange(): { weekStartDate: Date; weekEndDate: Date } {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStartDate = new Date(now);
    weekStartDate.setDate(now.getDate() + diffToMonday);
    weekStartDate.setHours(0, 0, 0, 0);

    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);

    return { weekStartDate, weekEndDate };
  }
}
