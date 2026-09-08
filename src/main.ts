import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // 1. Security Headers với Helmet
  app.use(helmet());

  // 2. Enable CORS
  app.enableCors({
    origin: '*',
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
  app.useGlobalInterceptors(new TransformInterceptor());

  // 6. Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('CalAI API')
    .setDescription(
      'Tài liệu API Backend cho ứng dụng CalAI (Health Tracking & AI Nutritionist)',
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
