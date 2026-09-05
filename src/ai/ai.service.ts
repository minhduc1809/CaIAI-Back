import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';

@Injectable()
export class AiService {
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
   * Phân tích hình ảnh món ăn từ Buffer (Multipart file)
   */
  async recognizeFoodFromBuffer(
    buffer: Buffer,
    mimeType: string = 'image/jpeg',
    userId?: string,
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
    userId?: string,
  ): Promise<FoodRecognitionResultDto> {
    // Làm sạch tiền tố base64 (ví dụ: "data:image/jpeg;base64,") nếu có
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    // 1. Thử gọi Gemini AI nếu có key hợp lệ
    if (this.genAI) {
      try {
        const result = await this.callGeminiVision(cleanBase64, mimeType);
        if (result) {
          if (userId) {
            this.logApiUsage(userId, 'food_recognition', 500, 200, 0.0005);
          }
          return {
            ...result,
            isFallback: false,
          };
        }
      } catch (error) {
        this.logger.error(`Lỗi khi gọi Gemini Vision API: ${error.message}. Chuyển sang Smart Fallback.`);
      }
    }

    // 2. Kích hoạt Smart Fallback Engine (giúp trải nghiệm app không bao giờ bị gián đoạn)
    return this.getSmartFallbackRecognition();
  }

  /**
   * Gọi mô hình Gemini 2.0 Flash Vision để phân tích ảnh
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
Nhiệm vụ: Phân tích bức ảnh món ăn này, nhận diện chính xác món ăn (đặc biệt ưu tiên ẩm thực Việt Nam và Châu Á), ước lượng khẩu phần thực tế, và tính toán bảng giá trị dinh dưỡng chuẩn xác nhất theo Viện Dinh Dưỡng Quốc Gia.

YÊU CẦU ĐẦU RA:
Trả về duy nhất định dạng JSON chuẩn theo schema sau (không thêm văn bản ngoài JSON):
{
  "foodName": "Tên món ăn chính bằng tiếng Việt chuẩn (Ví dụ: Phở bò tái nạm, Cơm tấm sườn bì chả, Bún chả Hà Nội, Bánh mì xíu mại, v.v.)",
  "confidenceScore": 0.95,
  "servingSize": "Khẩu phần ước tính (Ví dụ: 1 tô vừa ~450g, 1 đĩa tiêu chuẩn ~350g, 1 ổ bánh mì)",
  "totalCalories": 520,
  "totalProtein": 28,
  "totalCarb": 64,
  "totalFat": 16,
  "items": [
    {
      "name": "Tên thành phần con (Ví dụ: Bánh phở, Thịt bò tái, Nước dùng)",
      "servingSize": "Khẩu phần của thành phần (Ví dụ: 200g, 100g)",
      "calories": 220,
      "protein": 5,
      "carb": 48,
      "fat": 1
    }
  ],
  "healthTip": "Lời khuyên dinh dưỡng ngắn gọn, tích cực, mang tính cá nhân hóa (1-2 câu)."
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
      const parsed = JSON.parse(responseText);
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
Bạn là AI Nutrition & Fitness Coach của ứng dụng NutriWise. Hãy trả lời người dùng bằng tiếng Việt thân thiện, khoa học, súc tích, mang tính động viên cao.
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
      reply: `Chào bạn! Tôi là NutriWise Nutrition Coach. Dựa trên mục tiêu dinh dưỡng của bạn, tôi khuyến nghị bạn nên ưu tiên nguồn protein nạc (ức gà, cá basa, đậu hũ, trứng luộc) kết hợp tinh bột hấp thu chậm (gạo lứt, khoai lang) và nhiều rau củ tươi. Đừng quên uống đủ 2-2.5 lít nước mỗi ngày nhé!`,
      isFallback: true,
    };
  }

  /**
   * Bộ dữ liệu thông minh Fallback khi chưa có API key
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
    ];

    const selected = mockDishes[Math.floor(Math.random() * mockDishes.length)];
    return {
      ...selected,
      healthTip: `${selected.healthTip} (💡 Lưu ý: Hệ thống đang chạy chế độ Smart Fallback vì chưa cấu hình GEMINI_API_KEY trong .env)`,
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
