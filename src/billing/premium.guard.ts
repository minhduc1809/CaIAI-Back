import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { isPremiumNow } from './entitlement.util';

export const REQUIRES_PREMIUM = 'requiresPremium';

/** BR-19.8: đánh dấu endpoint chỉ dành cho Premium. Dùng cùng PremiumGuard sau JwtAuthGuard. */
export const RequiresPremium = () => SetMetadata(REQUIRES_PREMIUM, true);

/**
 * Trả 402 PREMIUM_REQUIRED khi user chưa có Premium. Chỉ thực thi khi BILLING_ENFORCE=true để có thể
 * bật sau khi cấu hình Google Play xong (nếu bật sớm, không ai mua được nên mất cả tính năng đang có).
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRES_PREMIUM, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || process.env.BILLING_ENFORCE !== 'true') return true;

    const userId = ctx.switchToHttp().getRequest().user?.id;
    if (userId && (await isPremiumNow(this.prisma, userId))) return true;
    throw new HttpException(
      { statusCode: HttpStatus.PAYMENT_REQUIRED, code: 'PREMIUM_REQUIRED', message: 'Tính năng này dành cho gói Premium.' },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
