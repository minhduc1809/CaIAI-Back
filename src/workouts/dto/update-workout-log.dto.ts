import { PartialType } from '@nestjs/swagger';
import { CreateWorkoutLogDto } from './create-workout-log.dto';

export class UpdateWorkoutLogDto extends PartialType(CreateWorkoutLogDto) {}
