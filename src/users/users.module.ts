import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { HealthCalculatorService } from './health-calculator.service';
import { AdaptiveExpenditureService } from './adaptive-expenditure.service';
import { StorageService } from '../storage/storage.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    HealthCalculatorService,
    AdaptiveExpenditureService,
    StorageService,
  ],
  exports: [UsersService, HealthCalculatorService, AdaptiveExpenditureService],
})
export class UsersModule {}
