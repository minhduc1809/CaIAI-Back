import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { requestMetrics } from '../metrics/request-metrics';

/** Đo thời gian xử lý mỗi yêu cầu cho trang Sức khỏe hệ thống. Lỗi được ghi riêng ở bộ lọc ngoại lệ. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const res = context.switchToHttp().getResponse();
    return next.handle().pipe(
      tap({
        next: () => requestMetrics.recordRequest(Date.now() - started, res.statusCode ?? 200),
        error: () => requestMetrics.recordRequest(Date.now() - started, 500),
      }),
    );
  }
}
