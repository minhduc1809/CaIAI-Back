import { Module } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsInsightsService } from './workouts-insights.service';
import { WorkoutRoutinesService } from './workout-routines.service';
import { WorkoutRoutinesController } from './workout-routines.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WorkoutsController, WorkoutRoutinesController],
  providers: [WorkoutsService, WorkoutsInsightsService, WorkoutRoutinesService],
  exports: [WorkoutsService],
})
export class WorkoutsModule {}
