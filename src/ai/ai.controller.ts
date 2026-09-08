import {
  Controller,
  Get,
  Post,
  Delete,
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
import { AiService, ChatPackageInfo } from './ai.service';
import { FoodRecognitionResultDto } from './dto/food-recognition-response.dto';
import { RecognizeFoodBase64Dto } from './dto/recognize-food-base64.dto';
import { ChatAiDto } from './dto/chat-ai.dto';
import { AiQuotaResponseDto } from './dto/ai-quota-response.dto';
import { PurchaseAiQuotaDto, AiScanPackageDto } from './dto/purchase-ai-quota.dto';
import { ChatQuotaInfoDto, ChatResponseDto, ChatHistoryResponseDto } from './dto/chat-history-response.dto';
import { PurchaseChatQuotaDto } from './dto/purchase-chat-quota.dto';

@ApiTags('AI Engine')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // =========================================================================
  // 1. CHỤP ẢNH MÓN ĂN & QUOTA ẢNH (5 LƯỢT/NGÀY + MUA LƯỢT)
  // =========================================================================

  @Get('packages')
  @ApiOperation({
    summary: 'Lấy danh sách các gói mua thêm lượt chụp ảnh AI',
    description: 'Trả về danh sách các gói mua thêm lượt chụp ảnh (10, 20, 50, 100 lượt). Lượt mua không bao giờ hết hạn.',
  })
  @ApiResponse({ status: 200, type: [AiScanPackageDto] })
  getPackages(): AiScanPackageDto[] {
    return this.aiService.getAvailablePackages();
  }

  @Post('purchase-credits')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Mua thêm lượt chụp ảnh AI (Tăng số lượt chụp, không hết hạn)',
    description: 'Cộng thêm lượt chụp ảnh vào tài khoản. Hệ thống luôn ưu tiên dùng 5 lượt miễn phí mỗi ngày trước.',
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
      limits: { fileSize: 10 * 1024 * 1024 },
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
          description: 'Tệp hình ảnh món ăn chụp từ Camera hoặc Thư viện ảnh',
        },
      },
      required: ['image'],
    },
  })
  @ApiOperation({
    summary: 'Nhận diện món ăn qua ảnh chụp từ Camera (Multipart Form-Data)',
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
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
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
  async recognizeFoodBase64(
    @CurrentUser('id') userId: string,
    @Body() dto: RecognizeFoodBase64Dto,
  ): Promise<FoodRecognitionResultDto> {
    return this.aiService.analyzeFoodImageBase64(dto.base64Image, dto.mimeType, userId);
  }

  // =========================================================================
  // 2. AI CHATBOT COACH & QUOTA TIN NHẮN (10 TIN/NGÀY + MUA THÊM TIN NHẮN)
  // =========================================================================

  @Get('chat/packages')
  @ApiOperation({
    summary: 'Lấy danh sách các gói nạp thêm token AI Coach',
    description: 'Danh sách các gói nạp token giúp người dùng trò chuyện nhiều hơn với AI Coach (+200k, +500k, +1 triệu tokens).',
  })
  @ApiResponse({ status: 200, description: 'Danh sách gói token' })
  getChatPackages(): ChatPackageInfo[] {
    return this.aiService.getAvailableChatPackages();
  }

  @Post('chat/purchase')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Nạp thêm token AI Coach (Tăng thêm token, không hết hạn)',
    description: 'Nạp thêm token vào tài khoản (+200k, +500k, +1M). Hệ thống luôn ưu tiên dùng hết 50,000 token miễn phí mỗi ngày trước.',
  })
  @ApiResponse({ status: 200, type: ChatQuotaInfoDto })
  async purchaseChatQuota(
    @CurrentUser('id') userId: string,
    @Body() dto: PurchaseChatQuotaDto,
  ): Promise<ChatQuotaInfoDto> {
    return this.aiService.purchaseChatCredits(userId, dto);
  }

  @Get('chat/quota')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Kiểm tra hạn mức token AI Coach (50k token free/ngày + Token đã mua)',
  })
  @ApiResponse({ status: 200, type: ChatQuotaInfoDto })
  async getChatQuota(@CurrentUser('id') userId: string): Promise<ChatQuotaInfoDto> {
    return this.aiService.getDailyChatQuota(userId);
  }

  @Get('chat/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Lấy lịch sử trò chuyện AI Coach trong 7 ngày gần nhất',
    description: 'Hệ thống tự động lưu trữ và lưu giữ tin nhắn trong 7 ngày để duy trì ngữ cảnh dinh dưỡng liên tục.',
  })
  @ApiResponse({ status: 200, type: ChatHistoryResponseDto })
  async getChatHistory(@CurrentUser('id') userId: string): Promise<ChatHistoryResponseDto> {
    return this.aiService.getChatHistory(userId);
  }

  @Delete('chat/history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Xóa toàn bộ lịch sử trò chuyện AI Coach',
  })
  @ApiResponse({ status: 200, description: 'Đã xóa lịch sử trò chuyện' })
  async clearChatHistory(@CurrentUser('id') userId: string) {
    return this.aiService.clearChatHistory(userId);
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trò chuyện với AI Coach (Kèm ngữ cảnh bữa ăn hôm nay & bảo vệ chủ đề)',
    description: 'Gửi tin nhắn hỏi AI Coach. Tự động kết nối dữ liệu calo/macro đã nạp hôm nay và lịch sử 7 ngày.',
  })
  @ApiResponse({ status: 200, type: ChatResponseDto })
  async chat(@CurrentUser('id') userId: string, @Body() dto: ChatAiDto): Promise<ChatResponseDto> {
    return this.aiService.chat(userId, dto.message);
  }
}
