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
  @ApiProperty({ example: 50000, description: 'Hạn mức token miễn phí mỗi ngày (50k tokens/ngày)' })
  dailyFreeLimit: number;

  @ApiProperty({ example: 42500, description: 'Số token miễn phí còn lại hôm nay' })
  freeRemaining: number;

  @ApiProperty({ example: 200000, description: 'Số token đã mua thêm còn lại (vĩnh viễn, không hết hạn)' })
  purchasedCredits: number;

  @ApiProperty({ example: 242500, description: 'Tổng số token có thể sử dụng ngay bây giờ' })
  totalRemaining: number;

  @ApiProperty({ example: '2026-09-09T00:00:00+07:00', description: 'Thời điểm reset 50k token miễn phí tiếp theo' })
  resetsAt: string;
}

export class ChatResponseDto {
  @ApiProperty({ description: 'Tin nhắn trả lời từ AI Coach' })
  reply: string;

  @ApiProperty({ example: 650, description: 'Số token tiêu thụ cho lượt trò chuyện này (prompt + context + reply)' })
  tokensUsed: number;

  @ApiProperty({ description: 'Thông tin quota token sau khi chat', type: () => ChatQuotaInfoDto })
  quota: ChatQuotaInfoDto;
}

export class ChatHistoryResponseDto {
  @ApiProperty({ description: 'Danh sách tin nhắn trong 7 ngày gần nhất', type: [ChatMessageDto] })
  messages: ChatMessageDto[];

  @ApiProperty({ description: 'Tổng số tin nhắn hiện có trong 7 ngày' })
  totalMessages: number;

  @ApiProperty({ description: 'Thông tin hạn mức token', type: () => ChatQuotaInfoDto })
  quota: ChatQuotaInfoDto;
}
