import { BadRequestException } from '@nestjs/common';

/**
 * Hồ sơ chưa hoàn tất nên chưa có mục tiêu dinh dưỡng thật. Các tính năng cần mục tiêu trả lỗi này thay vì
 * tự bịa mục tiêu mặc định (2000 kcal...) rồi đưa ra gợi ý sai. App hiển thị "Hoàn tất hồ sơ".
 */
export class ProfileIncompleteException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      code: 'PROFILE_INCOMPLETE',
      message: 'Hãy hoàn tất hồ sơ để có mục tiêu dinh dưỡng.',
    });
  }
}
