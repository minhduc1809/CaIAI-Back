import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChatAiDto {
  @ApiProperty({
    example: 'Hôm nay tôi đã ăn 1500 calo và tập tạ 45 phút, bữa tối tôi nên ăn gì để đủ protein?',
    description: 'Câu hỏi hoặc yêu cầu tư vấn dinh dưỡng gửi tới AI Coach',
  })
  @IsString()
  @IsNotEmpty({ message: 'Nội dung tin nhắn không được để trống' })
  message: string;
}
