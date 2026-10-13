import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { MealsModule } from '../meals/meals.module';
import { FoodCatalogModule } from '../food-catalog/food-catalog.module';

@Module({
  imports: [PrismaModule, MealsModule, FoodCatalogModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
