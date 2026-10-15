import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExerciseCatalogService } from './exercise-catalog.service';

@Module({
  imports: [PrismaModule],
  providers: [ExerciseCatalogService],
  exports: [ExerciseCatalogService],
})
export class ExerciseCatalogModule {}
