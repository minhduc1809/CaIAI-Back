import {
  Injectable,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Role } from '@prisma/client';

@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const parentPass = await super.canActivate(context);
    if (!parentPass) return false;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Chưa đăng nhập');
    }

    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Truy cập bị từ chối: Bạn không có quyền truy cập vào giao diện quản trị',
      );
    }

    return true;
  }
}
