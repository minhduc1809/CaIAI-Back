import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { requestMetrics } from '../metrics/request-metrics';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorDetails: any = null;
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = (res as any).message || exception.message;
        errorDetails = (res as any).error || null;
        // Giữ mã lỗi máy đọc được (QUOTA_EXCEEDED, AI_UNAVAILABLE, NOT_FOOD...) và các trường kèm theo
        // (feature, limit, resetsAt...) để app xử lý theo mã thay vì dò chữ trong thông báo.
        const {
          statusCode: _s,
          message: _m,
          error: _e,
          code: rawCode,
          ...rest
        } = res as Record<string, unknown>;
        if (typeof rawCode === 'string') code = rawCode;
        if (Object.keys(rest).length > 0) details = rest;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled Error: ${exception.message}`,
        exception.stack,
      );
    }

    if (status >= 500) {
      // Ghi vào số đo vận hành (trang Sức khỏe hệ thống); không ghi nội dung yêu cầu
      requestMetrics.recordError(request.method, request.url, Array.isArray(message) ? message.join('; ') : String(message));
      // Sản phẩm thật: không trả chi tiết nội bộ của lỗi hệ thống cho client
      if (!(exception instanceof HttpException) && process.env.NODE_ENV === 'production') message = 'Lỗi máy chủ, vui lòng thử lại sau';
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      error: errorDetails,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
