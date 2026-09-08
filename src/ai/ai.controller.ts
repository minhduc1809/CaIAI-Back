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

@ApiTags('AI Engine')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('quota')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Kiểm tra hạn mức chụp ảnh AI trong ngày (Tối đa 5 ảnh/ngày)',
    description:
      'Trả về số lượt nhận diện ảnh món ăn đã dùng hôm nay, số lượt còn lại và thời gian reset quota sang ngày mới.',
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
      'Gửi file ảnh chụp món ăn, mô hình Google Gemini Vision sẽ phân tích và bóc tách calo, protein, carb, fat, danh sách thành phần và lời khuyên sức khỏe. Giới hạn tối đa 5 ảnh/ngày.',
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
  @ApiResponse({
    status: 429,
    description: 'Đã sử dụng hết hạn mức 5 ảnh trong ngày. Vui lòng quay lại vào ngày mai.',
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
      'Cho phép mobile app gửi trực tiếp chuỗi base64 của ảnh chụp từ Camera để nhận diện. Giới hạn tối đa 5 ảnh/ngày.',
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
  @ApiResponse({
    status: 429,
    description: 'Đã sử dụng hết hạn mức 5 ảnh trong ngày. Vui lòng quay lại vào ngày mai.',
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
