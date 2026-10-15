import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoodCatalogModule } from '../food-catalog/food-catalog.module';
import { FoodSubmissionsController } from './food-submissions.controller';
import { FoodSubmissionsService } from './food-submissions.service';

@Module({
  imports: [PrismaModule, FoodCatalogModule],
  controllers: [FoodSubmissionsController],
  providers: [FoodSubmissionsService],
  exports: [FoodSubmissionsService],
})
export class FoodSubmissionsModule {}
