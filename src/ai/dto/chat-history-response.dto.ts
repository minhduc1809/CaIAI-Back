import { ApiProperty } from '@nestjs/swagger';

export class ChatMessageDto {
  @ApiProperty({ description: 'ID tin nhắn' })
  id: string;

  @ApiProperty({
    enum: ['user', 'assistant'],
    description: 'Vai trò người gửi',
  })
  role: 'user' | 'assistant';

  @ApiProperty({ description: 'Nội dung tin nhắn' })
  content: string;

  @ApiProperty({ description: 'Thời điểm gửi' })
  createdAt: Date;
}

export class ChatQuotaInfoDto {
  @ApiProperty({
    example: true,
    description: 'Người dùng còn hạn mức để trò chuyện hay không',
  })
  hasQuota: boolean;

  @ApiProperty({
    example: 'PREMIUM',
    enum: ['FREE', 'PREMIUM'],
    description: 'Gói hiện tại',
  })
  currentTier: 'FREE' | 'PREMIUM';

  @ApiProperty({
    example: 'Gói Pro',
    description: 'Tên hiển thị của gói thành viên',
  })
  tierName: string;

  @ApiProperty({
    example: 85,
    description: 'Tỷ lệ % hạn mức trò chuyện còn lại',
  })
  remainingPercent: number;

  @ApiProperty({
    example: 'COMFORTABLE',
    enum: ['COMFORTABLE', 'GOOD', 'LOW', 'EXHAUSTED'],
    description: 'Trạng thái dung lượng trò chuyện',
  })
  status: 'COMFORTABLE' | 'GOOD' | 'LOW' | 'EXHAUSTED';

  @ApiProperty({
    example: 'Hạn mức trò chuyện dồi dào',
    description: 'Thông báo trạng thái thân thiện',
  })
  statusMessage: string;

  @ApiProperty({
    example: '2026-09-09T00:00:00+07:00',
    description: 'Thời điểm làm mới lượt miễn phí tiếp theo',
  })
  resetsAt: string;

  @ApiProperty({
    example: 'MESSAGES',
    enum: ['MESSAGES', 'TOKENS'],
    description: 'Đơn vị đếm hạn mức: Free đếm tin nhắn, Premium đếm token',
  })
  unit: 'MESSAGES' | 'TOKENS';

  @ApiProperty({ example: 10, description: 'Hạn mức mỗi ngày theo đơn vị `unit`' })
  limit: number;

  @ApiProperty({ example: 3, description: 'Đã dùng hôm nay theo đơn vị `unit`' })
  used: number;
}

export class ChatResponseDto {
  @ApiProperty({ description: 'Tin nhắn trả lời từ AI Coach' })
  reply: string;

  @ApiProperty({
    description: 'Thông tin trạng thái hạn mức sau khi gửi tin nhắn',
    type: () => ChatQuotaInfoDto,
  })
  quota: ChatQuotaInfoDto;
}

export class ChatHistoryResponseDto {
  @ApiProperty({
    description: 'Danh sách tin nhắn trong 7 ngày gần nhất',
    type: [ChatMessageDto],
  })
  messages: ChatMessageDto[];

  @ApiProperty({ description: 'Tổng số tin nhắn hiện có trong 7 ngày' })
  totalMessages: number;

  @ApiProperty({
    description: 'Thông tin trạng thái hạn mức',
    type: () => ChatQuotaInfoDto,
  })
  quota: ChatQuotaInfoDto;
}
