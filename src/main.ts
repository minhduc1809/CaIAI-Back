import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { MetricsInterceptor } from './common/interceptors/metrics.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Cho phép nhập CSV kho món (tối đa 1000 dòng) qua JSON
  app.useBodyParser('json', { limit: '2mb' });

  // 1. Security Headers với Helmet
  app.use(helmet());

  // 2. Enable CORS
  // Phát hành: chỉ cho các tên miền trong CORS_ORIGINS (ví dụ tên miền web quản trị, phân cách bằng dấu phẩy). App di
  // động là client gốc nên không cần CORS. Dev/thử nghiệm không khai báo thì mở cho mọi nơi.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
    logger.warn('NODE_ENV=production nhưng chưa đặt CORS_ORIGINS: đang mở CORS cho mọi nơi, hãy khai báo tên miền quản trị');
  }
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 3. Global Prefix cho API
  app.setGlobalPrefix('api/v1');

  // 4. Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Tự động loại bỏ các field thừa ngoài DTO
      forbidNonWhitelisted: true, // Báo lỗi nếu client gửi field không được định nghĩa
      transform: true, // Tự động convert kiểu dữ liệu theo DTO
    }),
  );

  // 5. Global Exception Filter & Response Interceptor
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new MetricsInterceptor(), new TransformInterceptor());

  // 6. Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('NutriWise API')
    .setDescription(
      'Tài liệu API Backend cho ứng dụng NutriWise (Health Tracking & AI Nutritionist)',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 Server đang chạy tại: http://localhost:${port}/api/v1`);
  logger.log(`📚 Tài liệu Swagger UI: http://localhost:${port}/api`);
}
bootstrap();
