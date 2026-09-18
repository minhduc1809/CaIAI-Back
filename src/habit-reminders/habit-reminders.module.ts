import { Module } from '@nestjs/common';
import { HabitRemindersService } from './habit-reminders.service';
import { HabitRemindersController } from './habit-reminders.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [PrismaModule, AiModule],
  controllers: [HabitRemindersController],
  providers: [HabitRemindersService],
})
export class HabitRemindersModule {}
