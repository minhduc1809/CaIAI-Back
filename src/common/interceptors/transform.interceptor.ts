import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message?: string;
  data: T;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data) => {
        // File tải về (ví dụ ZIP xuất dữ liệu) trả nguyên vẹn, không bọc JSON
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) {
          return data as unknown as ApiResponse<T>;
        }
        let message = 'Success';
        let responseData = data;

        if (
          data &&
          typeof data === 'object' &&
          'message' in data &&
          'data' in data
        ) {
          message = data.message;
          responseData = data.data;
        } else if (
          data &&
          typeof data === 'object' &&
          'message' in data &&
          Object.keys(data).length === 1
        ) {
          message = data.message;
          responseData = null;
        }

        return {
          success: true,
          statusCode,
          message,
          data: responseData,
        };
      }),
    );
  }
}
