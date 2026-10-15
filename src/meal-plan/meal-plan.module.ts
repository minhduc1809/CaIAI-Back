import { Module } from '@nestjs/common';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';
import { FoodCatalogModule } from '../food-catalog/food-catalog.module';

@Module({
  imports: [FoodCatalogModule],
  controllers: [MealPlanController],
  providers: [MealPlanService],
  exports: [MealPlanService],
})
export class MealPlanModule {}
