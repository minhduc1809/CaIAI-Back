import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { HealthCalculatorService } from './health-calculator.service';
import { AdaptiveExpenditureService } from './adaptive-expenditure.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    HealthCalculatorService,
    AdaptiveExpenditureService,
  ],
  exports: [UsersService, HealthCalculatorService, AdaptiveExpenditureService],
})
export class UsersModule {}
