import { Injectable, Logger, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';
import { AiQuotaResponseDto } from './dto/ai-quota-response.dto';

@Injectable()
export class AiService {
  /**
   * Giới hạn số lượt nhận diện ảnh món ăn tối đa mỗi ngày của một người dùng
   */
  public static readonly DAILY_PHOTO_LIMIT = 5;

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

  /**
   * Lấy thông tin hạn mức chụp ảnh nhận diện món ăn trong ngày của người dùng
   */
  async getDailyPhotoQuota(userId: string): Promise<AiQuotaResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });

    const timezone = user?.timezone || 'Asia/Ho_Chi_Minh';
    const { startOfDay, resetsAt } = this.getTimezoneDayBounds(timezone);

    const usedToday = await this.prisma.apiUsageLog.count({
      where: {
        userId,
        feature: 'food_recognition',
        createdAt: { gte: startOfDay },
      },
    });

    const dailyLimit = AiService.DAILY_PHOTO_LIMIT;
    const remainingQuota = Math.max(0, dailyLimit - usedToday);

    return {
      feature: 'food_recognition',
      dailyLimit,
      usedToday,
      remainingQuota,
      resetsAt: resetsAt.toISOString(),
    };
  }

  /**
   * Kiểm tra hạn mức sử dụng trước khi phân tích ảnh.
   * Nếu đã dùng hết 5 ảnh/ngày -> ném HttpException 429 (Too Many Requests).
   */
  private async checkDailyPhotoQuota(userId: string): Promise<AiQuotaResponseDto> {
    const quota = await this.getDailyPhotoQuota(userId);
    if (quota.usedToday >= quota.dailyLimit) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Bạn đã sử dụng hết giới hạn nhận diện ảnh trong ngày (${quota.dailyLimit}/${quota.dailyLimit} ảnh). Hãy quay lại vào ngày mai hoặc nhập món ăn thủ công nhé!`,
          error: 'Too Many Requests',
          dailyLimit: quota.dailyLimit,
          usedToday: quota.usedToday,
          remainingQuota: 0,
          resetsAt: quota.resetsAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return quota;
  }

  /**
   * Tính mốc 00:00:00 bắt đầu ngày và thời điểm reset (00:00:00 ngày mai) theo múi giờ
   */
  private getTimezoneDayBounds(timezone: string = 'Asia/Ho_Chi_Minh'): { startOfDay: Date; resetsAt: Date } {
    const now = new Date();
    const ymd = now.toLocaleDateString('en-CA', { timeZone: timezone });
    const startOfDay = new Date(`${ymd}T00:00:00+07:00`);
    const resetsAt = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    return { startOfDay, resetsAt };
  }

  /**
   * Phân tích hình ảnh món ăn từ Buffer (Multipart file)
   */
  async recognizeFoodFromBuffer(
    buffer: Buffer,
    mimeType: string = 'image/jpeg',
    userId: string,
  ): Promise<FoodRecognitionResultDto> {
    const base64Data = buffer.toString('base64');
    return this.analyzeFoodImageBase64(base64Data, mimeType, userId);
  }

  /**
   * Phân tích hình ảnh món ăn từ chuỗi Base64
   */
  async analyzeFoodImageBase64(
    base64Data: string,
    mimeType: string = 'image/jpeg',
    userId: string,
  ): Promise<FoodRecognitionResultDto> {
    // 1. Kiểm tra hạn mức 5 ảnh / ngày
    const quota = await this.checkDailyPhotoQuota(userId);

    // Làm sạch tiền tố base64 (ví dụ: "data:image/jpeg;base64,") nếu có
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    // 2. Thử gọi Gemini AI nếu có key hợp lệ
    if (this.genAI) {
      try {
        const result = await this.callGeminiVision(cleanBase64, mimeType);
        if (result) {
          // Nhận diện thành công -> tiêu tốn 1 lượt quota
          await this.logApiUsage(userId, 'food_recognition', 500, 200, 0.0005);
          return {
            ...result,
            remainingDailyQuota: Math.max(0, quota.remainingQuota - 1),
            dailyLimit: quota.dailyLimit,
            isFallback: false,
          };
        }
      } catch (error) {
        if (error instanceof BadRequestException) {
          // Lỗi do người dùng gửi ảnh không phải đồ ăn -> ném ra ngoài, KHÔNG trừ quota
          throw error;
        }
        this.logger.error(`Lỗi khi gọi Gemini Vision API: ${error.message}. Chuyển sang Smart Fallback.`);
      }
    }

    // 3. Kích hoạt Smart Fallback Engine (khi chưa cấu hình API key hoặc mạng lỗi)
    await this.logApiUsage(userId, 'food_recognition', 100, 50, 0);
    const fallback = this.getSmartFallbackRecognition();
    return {
      ...fallback,
      remainingDailyQuota: Math.max(0, quota.remainingQuota - 1),
      dailyLimit: quota.dailyLimit,
      isFallback: true,
    };
  }

  /**
   * Gọi mô hình Gemini Vision để phân tích ảnh chuyên sâu cho ẩm thực Việt Nam
   */
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
- Nếu ảnh hoàn toàn KHÔNG phải đồ ăn/thực phẩm (ví dụ: phong cảnh, đồ vật, màn hình máy tính, khuôn mặt, động vật, ảnh đen mờ không rõ...):
Hãy trả về duy nhất định dạng JSON:
{
  "isFood": false,
  "message": "Không nhận diện được món ăn hoặc thực phẩm trong ảnh. Vui lòng chụp rõ món ăn hơn nhé!"
}

2. Nếu ảnh LÀ món ăn/thực phẩm:
- Nhận diện tên món ăn chính xác nhất bằng tiếng Việt (đặc biệt ưu tiên các món ăn Việt Nam như Phở bò, Cơm tấm, Bún chả, Bánh mì, Bún bò Huế, Hủ tiếu Nam Vang, Bún riêu cua, Bún đậu mắm tôm, Gỏi cuốn, Canh chua, Cá kho tộ, Cơm bình dân...).
- Ước lượng khẩu phần thực tế dựa trên đồ chứa (đĩa, tô, bát, hộp) kèm gram ước tính (ví dụ: 1 tô vừa ~450g, 1 đĩa tiêu chuẩn ~400g, 1 ổ bánh mì, 1 ly ~350ml).
- Tính toán tổng Calo (kcal) và 3 chỉ số đa lượng Protein (g), Carbohydrate (g), Chất béo Fat (g) chuẩn theo Bảng thành phần thực phẩm Việt Nam (Viện Dinh Dưỡng Quốc Gia).
- Bóc tách chi tiết từng thành phần con cấu thành món ăn (ví dụ: bún, thịt bò nạm, chả cua, nước dùng...).
- Đưa ra lời khuyên dinh dưỡng (healthTip) khoa học, súc tích (1-2 câu), gợi ý cách ăn lành mạnh (ví dụ: giảm nước béo, thêm rau sống, hạn chế đồ chiên).

YÊU CẦU ĐẦU RA:
Chỉ trả về DUY NHẤT một chuỗi JSON hợp lệ (không thêm bất kỳ văn bản giải thích hay markdown code blocks ngoài JSON), theo đúng cấu trúc:
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
      "name": "Tên thành phần con (ví dụ: Bánh phở)",
      "servingSize": "Khẩu phần con (ví dụ: 200g)",
      "calories": 220,
      "protein": 5,
      "carb": 48,
      "fat": 1
    }
  ],
  "healthTip": "Lời khuyên dinh dưỡng hữu ích và thân thiện (1-2 câu)"
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

  /**
   * Chatbot tư vấn dinh dưỡng cá nhân hóa với ngữ cảnh người dùng
   */
  async chat(userId: string, userMessage: string): Promise<{ reply: string; isFallback: boolean }> {
    // 1. Lấy ngữ cảnh sức khỏe & dinh dưỡng ngày hôm nay của user
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
      },
    });

    const contextPrompt = user
      ? `Ngữ cảnh người dùng:
- Tên: ${user.name || 'Người dùng'}
- Mục tiêu: ${user.goal} (Hiện tại: ${user.weightKg || 'N/A'}kg, Mục tiêu: ${user.targetWeightKg || 'N/A'}kg)
- Ngân sách dinh dưỡng: ${user.targetCalories || 2000} kcal (Protein: ${user.targetProtein || 150}g, Carb: ${user.targetCarb || 200}g, Fat: ${user.targetFat || 60}g).`
      : '';

    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600,
          },
        });

        const prompt = `
Bạn là AI Nutrition & Fitness Coach của ứng dụng CalAI. Hãy trả lời người dùng bằng tiếng Việt thân thiện, khoa học, súc tích, mang tính động viên cao.
${contextPrompt}

Người dùng hỏi: "${userMessage}"
Hãy trả lời trực tiếp câu hỏi, đưa ra gợi ý món ăn Việt Nam cụ thể (kèm calo/protein ước tính nếu phù hợp).
`;

        const response = await model.generateContent(prompt);
        const reply = response.response.text();

        this.logApiUsage(userId, 'chat_coach', 300, 150, 0.0003);

        return {
          reply: reply.trim(),
          isFallback: false,
        };
      } catch (err) {
        this.logger.error(`Lỗi khi gọi Gemini Chat: ${err.message}`);
      }
    }

    // Fallback response khi chưa có key
    return {
      reply: `Chào bạn! Tôi là CalAI Nutrition Coach. Dựa trên mục tiêu dinh dưỡng của bạn, tôi khuyến nghị bạn nên ưu tiên nguồn protein nạc (ức gà, cá basa, đậu hũ, trứng luộc) kết hợp tinh bột hấp thu chậm (gạo lứt, khoai lang) và nhiều rau củ tươi. Đừng quên uống đủ 2-2.5 lít nước mỗi ngày nhé!`,
      isFallback: true,
    };
  }

  /**
   * Bộ dữ liệu thông minh Fallback phong phú khi chưa có API key
   */
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
      {
        foodName: 'Bún chả Hà Nội',
        confidenceScore: 0.91,
        servingSize: '1 phần vừa (~420g)',
        totalCalories: 510,
        totalProtein: 27,
        totalCarb: 65,
        totalFat: 15,
        items: [
          { name: 'Bún tươi', servingSize: '200g', calories: 220, protein: 3, carb: 48, fat: 1 },
          { name: 'Chả viên & chả miếng', servingSize: '120g', calories: 230, protein: 22, carb: 3, fat: 14 },
          { name: 'Nước chấm đu đủ', servingSize: '1 bát', calories: 50, protein: 1, carb: 12, fat: 0 },
          { name: 'Rau sống ăn kèm', servingSize: '1 đĩa', calories: 10, protein: 1, carb: 2, fat: 0 },
        ],
        healthTip: 'Ăn kèm nhiều rau kinh giới, xà lách, tía tô giúp tăng chất xơ và làm chậm quá trình hấp thu đường huyết.',
        isFallback: true,
      },
      {
        foodName: 'Bánh mì kẹp thịt xá xíu',
        confidenceScore: 0.93,
        servingSize: '1 ổ (~200g)',
        totalCalories: 430,
        totalProtein: 20,
        totalCarb: 54,
        totalFat: 14,
        items: [
          { name: 'Bánh mì giòn', servingSize: '1 ổ (~90g)', calories: 230, protein: 7, carb: 46, fat: 2 },
          { name: 'Thịt xá xíu & chả lụa', servingSize: '70g', calories: 150, protein: 12, carb: 2, fat: 10 },
          { name: 'Pate, bơ & sốt', servingSize: '20g', calories: 40, protein: 1, carb: 2, fat: 3 },
          { name: 'Dưa leo, ngò & đồ chua', servingSize: '20g', calories: 10, protein: 0, carb: 4, fat: 0 },
        ],
        healthTip: 'Bữa sáng nhanh gọn, tiện lợi. Bạn có thể đề nghị không cho sốt bơ trứng nếu đang trong chế độ giảm béo.',
        isFallback: true,
      },
      {
        foodName: 'Salad ức gà sốt mè rang',
        confidenceScore: 0.95,
        servingSize: '1 đĩa lớn (~350g)',
        totalCalories: 340,
        totalProtein: 35,
        totalCarb: 18,
        totalFat: 14,
        items: [
          { name: 'Ức gà áp chảo', servingSize: '150g', calories: 195, protein: 32, carb: 0, fat: 4 },
          { name: 'Xà lách & cà chua bi', servingSize: '150g', calories: 35, protein: 2, carb: 7, fat: 0 },
          { name: 'Sốt mè rang Kewpie', servingSize: '2 thìa (~25ml)', calories: 110, protein: 1, carb: 11, fat: 10 },
        ],
        healthTip: 'Món ăn chuẩn Eat Clean giàu protein nạc và chất xơ vi lượng, rất lý tưởng cho bữa tối hoặc người tập gym.',
        isFallback: true,
      },
    ];

    const selected = mockDishes[Math.floor(Math.random() * mockDishes.length)];
    return {
      ...selected,
      healthTip: `${selected.healthTip} (💡 Smart Fallback đang kích hoạt: bạn có thể cấu hình GEMINI_API_KEY trong .env để nhận diện ảnh thực tế)`,
    };
  }

  /**
   * Ghi log lượng token sử dụng vào database
   */
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
