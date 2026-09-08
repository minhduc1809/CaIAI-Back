import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ description: 'ID tin nhắn' })
  id: string;

  @ApiProperty({ enum: ['user', 'assistant'], description: 'Vai trò người gửi' })
  role: 'user' | 'assistant';

  @ApiProperty({ description: 'Nội dung tin nhắn' })
  content: string;

  @ApiProperty({ description: 'Thời điểm gửi' })
  createdAt: Date;
}

export class ChatQuotaInfoDto {
  @ApiProperty({ example: 10, description: 'Giới hạn tin nhắn miễn phí mỗi ngày' })
  dailyFreeLimit: number;

  @ApiProperty({ example: 8, description: 'Số tin nhắn miễn phí còn lại hôm nay' })
  freeRemaining: number;

  @ApiProperty({ example: 20, description: 'Số tin nhắn đã mua thêm còn lại (vĩnh viễn)' })
  purchasedCredits: number;

  @ApiProperty({ example: 28, description: 'Tổng số tin nhắn có thể gửi ngay bây giờ' })
  totalRemaining: number;

  @ApiProperty({ example: '2026-09-09T00:00:00+07:00', description: 'Thời điểm reset lượt miễn phí tiếp theo' })
  resetsAt: string;
}

export class ChatResponseDto {
  @ApiProperty({ description: 'Tin nhắn trả lời từ AI Coach' })
  reply: string;

  @ApiProperty({ description: 'Thông tin quota tin nhắn sau khi chat', type: () => ChatQuotaInfoDto })
  quota: ChatQuotaInfoDto;
}

export class ChatHistoryResponseDto {
  @ApiProperty({ description: 'Danh sách tin nhắn trong 7 ngày gần nhất', type: [ChatMessageDto] })
  messages: ChatMessageDto[];

  @ApiProperty({ description: 'Tổng số tin nhắn hiện có trong 7 ngày' })
  totalMessages: number;

  @ApiProperty({ description: 'Thông tin quota', type: () => ChatQuotaInfoDto })
  quota: ChatQuotaInfoDto;
}
