import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoodCatalogService } from './food-catalog.service';

@Module({
  imports: [PrismaModule],
  providers: [FoodCatalogService],
  exports: [FoodCatalogService],
})
export class FoodCatalogModule {}
