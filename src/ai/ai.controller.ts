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
import { ScanMenuBase64Dto } from './dto/scan-menu-base64.dto';
import { ScanMenuResponseDto } from './dto/scan-menu-response.dto';
import { SuggestMealResponseDto } from './dto/suggest-meal-response.dto';

@ApiTags('AI Engine')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

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
      'Gửi file ảnh chụp món ăn, mô hình Google Gemini 2.0 Flash Vision sẽ phân tích và bóc tách calo, protein, carb, fat, danh sách thành phần và lời khuyên sức khỏe.',
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
    description: 'Cho phép mobile app gửi trực tiếp chuỗi base64 của ảnh chụp từ Camera để nhận diện.',
  })
  @ApiResponse({ status: 200, type: FoodRecognitionResultDto })
  async recognizeFoodBase64(
    @CurrentUser('id') userId: string,
    @Body() dto: RecognizeFoodBase64Dto,
  ): Promise<FoodRecognitionResultDto> {
    return this.aiService.analyzeFoodImageBase64(dto.base64Image, dto.mimeType, userId);
  }

  @Post('scan-menu')
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
        image: { type: 'string', format: 'binary', description: 'Ảnh chụp thực đơn nhà hàng' },
        note: { type: 'string', description: 'Ghi chú thêm (tuỳ chọn)' },
      },
      required: ['image'],
    },
  })
  @ApiOperation({
    summary: 'Quét thực đơn nhà hàng qua ảnh chụp (Multipart Form-Data)',
    description:
      'Nhận diện TẤT CẢ món ăn trong ảnh thực đơn, ước lượng calo/macro từng món và gợi ý món phù hợp với ngân sách dinh dưỡng còn lại của người dùng hôm nay.',
  })
  @ApiResponse({ status: 200, type: ScanMenuResponseDto })
  async scanMenu(
    @CurrentUser('id') userId: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('note') note?: string,
  ): Promise<ScanMenuResponseDto> {
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên tệp hình ảnh thực đơn (field: image)');
    }

    return this.aiService.scanMenuFromBuffer(file.buffer, file.mimetype, userId, note);
  }

  @Post('scan-menu-base64')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quét thực đơn nhà hàng qua chuỗi Base64 (Dành cho Mobile App)',
    description: 'Cho phép mobile app gửi trực tiếp chuỗi base64 của ảnh chụp thực đơn để nhận diện nhiều món cùng lúc.',
  })
  @ApiResponse({ status: 200, type: ScanMenuResponseDto })
  async scanMenuBase64(
    @CurrentUser('id') userId: string,
    @Body() dto: ScanMenuBase64Dto,
  ): Promise<ScanMenuResponseDto> {
    return this.aiService.scanMenuBase64(dto.imageBase64, undefined, userId, dto.note);
  }

  @Get('suggest-meal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Gợi ý bữa ăn tiếp theo dựa trên phần dinh dưỡng còn thiếu trong ngày',
    description: 'Tính phần calo/protein/carb/fat còn lại của user hôm nay rồi gợi ý 2-3 món ăn Việt Nam cụ thể để lấp đầy.',
  })
  @ApiResponse({ status: 200, type: SuggestMealResponseDto })
  async suggestMeal(@CurrentUser('id') userId: string): Promise<SuggestMealResponseDto> {
    return this.aiService.suggestMeal(userId);
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
