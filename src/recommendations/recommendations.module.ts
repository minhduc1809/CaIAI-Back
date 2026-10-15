import { Module } from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';
import { FoodCatalogModule } from '../food-catalog/food-catalog.module';
import { ExerciseCatalogModule } from '../exercise-catalog/exercise-catalog.module';

@Module({
  imports: [FoodCatalogModule, ExerciseCatalogModule],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
