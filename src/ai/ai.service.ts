import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PrismaService } from '../prisma/prisma.service';
import { MealsService } from '../meals/meals.service';
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';
import { MenuItemDto, ScanMenuResponseDto } from './dto/scan-menu-response.dto';
import { NutritionGapDto, SuggestMealResponseDto, SuggestedMealItemDto } from './dto/suggest-meal-response.dto';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mealsService: MealsService,
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
   * Quét thực đơn nhà hàng từ Buffer (Multipart file) — nhận diện nhiều món cùng lúc
   */
  async scanMenuFromBuffer(
    buffer: Buffer,
    mimeType: string = 'image/jpeg',
    userId: string,
    note?: string,
  ): Promise<ScanMenuResponseDto> {
    const base64Data = buffer.toString('base64');
    return this.scanMenuBase64(base64Data, mimeType, userId, note);
  }

  /**
   * Quét thực đơn nhà hàng từ chuỗi Base64 — nhận diện nhiều món, đối chiếu ngân sách calo còn lại hôm nay
   */
  async scanMenuBase64(
    base64Data: string,
    mimeType: string = 'image/jpeg',
    userId: string,
    note?: string,
  ): Promise<ScanMenuResponseDto> {
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const nutritionGap = await this.getRemainingNutritionGap(userId);

    if (this.genAI) {
      try {
        const result = await this.callGeminiMenuVision(cleanBase64, mimeType, nutritionGap, note);
        if (result) {
          this.logApiUsage(userId, 'menu_scan', 800, 400, 0.001);
          return result;
        }
      } catch (error) {
        this.logger.error(`Lỗi khi gọi Gemini Vision cho quét thực đơn: ${error.message}. Chuyển sang Smart Fallback.`);
      }
    }

    return this.getSmartFallbackMenuScan();
  }

  private async callGeminiMenuVision(
    base64Data: string,
    mimeType: string,
    nutritionGap: NutritionGapDto,
    note?: string,
  ): Promise<ScanMenuResponseDto | null> {
    if (!this.genAI) return null;
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.3,
      },
    });

    const prompt = `
Bạn là chuyên gia dinh dưỡng AI. Nhiệm vụ: đọc bức ảnh THỰC ĐƠN NHÀ HÀNG (menu) này, liệt kê TẤT CẢ các món ăn xuất hiện trong ảnh (không chỉ 1 món), ước lượng calo/macro cho mỗi món, và gợi ý những món phù hợp nhất với ngân sách dinh dưỡng còn lại của người dùng hôm nay.

Ngân sách còn lại hôm nay: ${nutritionGap.remainingCalories} kcal, protein còn thiếu ${nutritionGap.remainingProtein}g, carb còn lại ${nutritionGap.remainingCarbs}g, fat còn lại ${nutritionGap.remainingFat}g.
${note ? `Ghi chú thêm từ người dùng: ${note}` : ''}

Trả về duy nhất JSON theo schema (không thêm văn bản ngoài JSON):
{
  "restaurantName": "Tên quán nếu đọc được trên menu, null nếu không rõ",
  "items": [
    {
      "name": "Tên món",
      "price": "Giá tiền nếu có trên menu, null nếu không có",
      "estimatedCalories": 480,
      "protein": 34,
      "carbs": 60,
      "fat": 10,
      "description": "Mô tả ngắn món ăn",
      "isRecommended": true,
      "recommendationReason": "Vì sao món này phù hợp ngân sách hôm nay, null nếu không được đề xuất"
    }
  ],
  "summaryAdvice": "Lời khuyên tổng quan 1-2 câu khi chọn món trong thực đơn này"
}
Đánh dấu isRecommended=true cho tối đa 3 món phù hợp nhất với ngân sách còn lại.
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
      const items: MenuItemDto[] = Array.isArray(parsed.items)
        ? parsed.items.map((it: any) => ({
            name: it.name || 'Món ăn',
            price: it.price ?? null,
            estimatedCalories: Math.round(it.estimatedCalories || 0),
            protein: Math.round(it.protein || 0),
            carbs: Math.round(it.carbs || 0),
            fat: Math.round(it.fat || 0),
            description: it.description || '',
            isRecommended: Boolean(it.isRecommended),
            recommendationReason: it.recommendationReason ?? null,
          }))
        : [];

      return {
        restaurantName: parsed.restaurantName ?? null,
        items,
        recommendedItems: items.filter((it) => it.isRecommended),
        summaryAdvice: parsed.summaryAdvice || 'Ưu tiên món giàu đạm, ít dầu mỡ để cân đối ngân sách calo hôm nay.',
      };
    } catch (e) {
      this.logger.error(`Failed to parse Gemini menu-scan JSON response: ${responseText}`);
      return null;
    }
  }

  private getSmartFallbackMenuScan(): ScanMenuResponseDto {
    const items: MenuItemDto[] = [
      {
        name: 'Phở bò tái nạc',
        price: '55.000đ',
        estimatedCalories: 480,
        protein: 34,
        carbs: 60,
        fat: 10,
        description: 'Bò tái tươi ngon, nước dùng thanh',
        isRecommended: true,
        recommendationReason: 'Giàu protein chất lượng cao, phù hợp ngân sách dinh dưỡng hôm nay',
      },
      {
        name: 'Cơm tấm sườn nướng',
        price: '50.000đ',
        estimatedCalories: 580,
        protein: 28,
        carbs: 70,
        fat: 18,
        description: 'Sườn nướng than hoa, cơm tấm dẻo',
        isRecommended: false,
        recommendationReason: null,
      },
      {
        name: 'Bún chả Hà Nội',
        price: '45.000đ',
        estimatedCalories: 510,
        protein: 27,
        carbs: 65,
        fat: 15,
        description: 'Chả nướng thơm, nước chấm chua ngọt',
        isRecommended: true,
        recommendationReason: 'Cân bằng đạm/carb, khẩu phần vừa phải',
      },
    ];

    return {
      restaurantName: 'Thực Đơn Quán Cơm & Bún (Smart Fallback)',
      items,
      recommendedItems: items.filter((it) => it.isRecommended),
      summaryAdvice:
        'Ưu tiên các món nước có nước dùng thanh và nhiều đạm nạc. (💡 Lưu ý: Hệ thống đang chạy chế độ Smart Fallback vì chưa cấu hình GEMINI_API_KEY trong .env)',
    };
  }

  /**
   * Gợi ý bữa ăn tiếp theo dựa trên phần dinh dưỡng còn thiếu trong ngày của người dùng
   */
  async suggestMeal(userId: string): Promise<SuggestMealResponseDto> {
    const nutritionGap = await this.getRemainingNutritionGap(userId);

    if (this.genAI) {
      try {
        const result = await this.callGeminiSuggestMeal(nutritionGap);
        if (result) {
          this.logApiUsage(userId, 'suggest_meal', 400, 250, 0.0006);
          return result;
        }
      } catch (error) {
        this.logger.error(`Lỗi khi gọi Gemini gợi ý bữa ăn: ${error.message}. Chuyển sang Smart Fallback.`);
      }
    }

    return this.getSmartFallbackSuggestMeal(nutritionGap);
  }

  private async callGeminiSuggestMeal(nutritionGap: NutritionGapDto): Promise<SuggestMealResponseDto | null> {
    if (!this.genAI) return null;
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.5,
      },
    });

    const prompt = `
Bạn là chuyên gia dinh dưỡng AI. Người dùng còn lại trong ngày hôm nay: ${nutritionGap.remainingCalories} kcal, protein ${nutritionGap.remainingProtein}g, carb ${nutritionGap.remainingCarbs}g, fat ${nutritionGap.remainingFat}g.
Hãy gợi ý 2-3 món ăn Việt Nam cụ thể giúp lấp đầy phần dinh dưỡng còn thiếu này mà không vượt quá calo còn lại.

Trả về duy nhất JSON theo schema (không thêm văn bản ngoài JSON):
{
  "suggestions": [
    {
      "name": "Tên món cụ thể",
      "mealType": "Bữa trưa/Bữa tối/Bữa phụ tuỳ thời điểm hợp lý",
      "calories": 450,
      "protein": 38,
      "carbs": 42,
      "fat": 12,
      "reason": "Vì sao món này phù hợp phần dinh dưỡng còn thiếu",
      "ingredients": ["Nguyên liệu 1", "Nguyên liệu 2"]
    }
  ],
  "advice": "Lời khuyên tổng quan 1-2 câu"
}
`;

    const response = await model.generateContent(prompt);
    const responseText = response.response.text();

    try {
      const parsed = JSON.parse(responseText);
      const suggestions: SuggestedMealItemDto[] = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((it: any) => ({
            name: it.name || 'Món ăn gợi ý',
            mealType: it.mealType || 'Bữa ăn',
            calories: Math.round(it.calories || 0),
            protein: Math.round(it.protein || 0),
            carbs: Math.round(it.carbs || 0),
            fat: Math.round(it.fat || 0),
            reason: it.reason || '',
            ingredients: Array.isArray(it.ingredients) ? it.ingredients : [],
          }))
        : [];

      return {
        nutritionGap,
        suggestions,
        advice: parsed.advice || 'Hãy ưu tiên bổ sung phần dinh dưỡng còn thiếu ở bữa ăn tiếp theo nhé!',
      };
    } catch (e) {
      this.logger.error(`Failed to parse Gemini suggest-meal JSON response: ${responseText}`);
      return null;
    }
  }

  private getSmartFallbackSuggestMeal(nutritionGap: NutritionGapDto): SuggestMealResponseDto {
    return {
      nutritionGap,
      suggestions: [
        {
          name: 'Phở gà ức ít bánh + 2 trứng chần',
          mealType: 'Bữa tối',
          calories: 450,
          protein: 38,
          carbs: 42,
          fat: 12,
          reason: 'Bổ sung protein chất lượng cao mà không vượt calo còn lại trong ngày',
          ingredients: ['Ức gà', 'Bánh phở', 'Trứng gà', 'Nước dùng gà'],
        },
        {
          name: 'Salad ức gà áp chảo + khoai lang hấp',
          mealType: 'Bữa phụ',
          calories: 380,
          protein: 32,
          carbs: 35,
          fat: 9,
          reason: 'Giàu đạm, ít chất béo, phù hợp khi calo còn lại không nhiều',
          ingredients: ['Ức gà', 'Khoai lang', 'Rau xà lách', 'Cà chua bi'],
        },
      ],
      advice: `Bạn còn thiếu khoảng ${nutritionGap.remainingProtein}g protein hôm nay — hãy ưu tiên bổ sung ở bữa ăn tiếp theo nhé! (💡 Lưu ý: Hệ thống đang chạy chế độ Smart Fallback vì chưa cấu hình GEMINI_API_KEY trong .env)`,
    };
  }

  /**
   * Tính phần dinh dưỡng còn lại trong ngày hôm nay của user — dùng chung cho scan-menu và suggest-meal
   */
  private async getRemainingNutritionGap(userId: string): Promise<NutritionGapDto> {
    const summaryResponse = await this.mealsService.getDailyNutritionSummary(userId);
    const summary = summaryResponse.data.summary;

    return {
      remainingCalories: summary.remainingCalories,
      remainingProtein: Math.max(0, summary.macros.protein.target - summary.macros.protein.consumed),
      remainingCarbs: Math.max(0, summary.macros.carb.target - summary.macros.carb.consumed),
      remainingFat: Math.max(0, summary.macros.fat.target - summary.macros.fat.consumed),
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
