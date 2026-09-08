import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';
import { RecognizeFoodBase64Dto } from './dto/recognize-food-base64.dto';
import { ChatAiDto } from './dto/chat-ai.dto';
import { AiQuotaResponseDto } from './dto/ai-quota-response.dto';
import { PurchaseAiQuotaDto, AiScanPackageDto } from './dto/purchase-ai-quota.dto';

@ApiTags('AI Engine')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('packages')
  @ApiOperation({
    summary: 'Lấy danh sách các gói nạp thêm lượt chụp ảnh AI',
    description:
      'Trả về danh sách các gói mua thêm lượt nhận diện ảnh (10, 20, 50, 100 lượt). Lượt mua không bao giờ hết hạn và được dùng sau khi dùng hết 5 lượt miễn phí mỗi ngày.',
  })
  @ApiResponse({ status: 200, type: [AiScanPackageDto] })
  getPackages(): AiScanPackageDto[] {
    return this.aiService.getAvailablePackages();
  }

  @Post('purchase-credits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Mua thêm lượt chụp ảnh AI (Không hết hạn, độc lập với 5 lượt miễn phí/ngày)',
    description:
      'Cộng thêm lượt chụp ảnh vào tài khoản người dùng. Hệ thống sẽ luôn ưu tiên dùng 5 lượt miễn phí hàng ngày trước, khi hết 5 lượt mới trừ vào số lượt mua này.',
  })
  @ApiResponse({ status: 200, type: AiQuotaResponseDto })
  async purchaseCredits(
    @CurrentUser('id') userId: string,
    @Body() dto: PurchaseAiQuotaDto,
  ): Promise<AiQuotaResponseDto> {
    return this.aiService.purchaseScanCredits(userId, dto);
  }

  @Get('quota')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Kiểm tra hạn mức chụp ảnh AI (5 lượt free/ngày + Lượt đã mua)',
    description:
      'Trả về chi tiết số lượt miễn phí hôm nay, số lượt đã mua vĩnh viễn, tổng số lượt có thể dùng và thời điểm reset 5 lượt miễn phí.',
  })
  @ApiResponse({ status: 200, type: AiQuotaResponseDto })
  async getQuota(@CurrentUser('id') userId: string): Promise<AiQuotaResponseDto> {
    return this.aiService.getDailyPhotoQuota(userId);
  }

  @Post('recognize-food')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 10 * 1024 * 1024 }, // Tối đa 10MB
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description: 'Tệp hình ảnh món ăn chụp từ Camera hoặc Bộ sưu tập',
        },
      },
      required: ['image'],
    },
  })
  @ApiOperation({
    summary: 'Nhận diện món ăn qua ảnh chụp từ Camera (Multipart Form-Data)',
    description:
      'Gửi file ảnh chụp món ăn, mô hình Google Gemini Vision sẽ phân tích và bóc tách calo, protein, carb, fat, danh sách thành phần và lời khuyên sức khỏe. Tự động ưu tiên 5 lượt miễn phí/ngày trước khi trừ lượt mua.',
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
  @ApiResponse({
    status: 429,
    description: 'Đã sử dụng hết cả 5 lượt miễn phí hôm nay và không còn lượt mua thêm.',
  })
  async recognizeFood(
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<FoodRecognitionResultDto> {
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên tệp hình ảnh món ăn (field: image)');
    }

    return this.aiService.recognizeFoodFromBuffer(file.buffer, file.mimetype, userId);
  }

  @Post('recognize-food-base64')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Nhận diện món ăn qua chuỗi Base64 (Dành cho Mobile App)',
    description:
      'Cho phép mobile app gửi trực tiếp chuỗi base64 của ảnh chụp từ Camera để nhận diện. Tự động ưu tiên 5 lượt miễn phí/ngày trước khi trừ lượt mua.',
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
  @ApiResponse({
    status: 429,
    description: 'Đã sử dụng hết cả 5 lượt miễn phí hôm nay và không còn lượt mua thêm.',
  })
  async recognizeFoodBase64(
    @CurrentUser('id') userId: string,
    @Body() dto: RecognizeFoodBase64Dto,
  ): Promise<FoodRecognitionResultDto> {
    return this.aiService.analyzeFoodImageBase64(dto.base64Image, dto.mimeType, userId);
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chatbot tư vấn dinh dưỡng AI Coach',
    description:
      'Trò chuyện với AI Coach về thực đơn, mục tiêu calo, gợi ý món ăn dựa trên dữ liệu sức khỏe cá nhân của người dùng.',
  })
  @ApiResponse({ status: 200, description: 'Phản hồi từ AI Coach' })
  async chat(@CurrentUser('id') userId: string, @Body() dto: ChatAiDto) {
    return this.aiService.chat(userId, dto.message);
  }
}
