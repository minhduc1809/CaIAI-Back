import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { HealthCalculatorService } from './health-calculator.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, HealthCalculatorService],
  exports: [UsersService, HealthCalculatorService],
})
export class UsersModule {}
