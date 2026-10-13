import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkoutCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoutineDto, CreateCustomExerciseDto, RoutineItemDto, UpdateRoutineDto } from './dto/workout-routine.dto';

/** Số mẫu tối đa mỗi người dùng. */
export const MAX_ROUTINES_PER_USER = 30;
export const MAX_CUSTOM_EXERCISES_PER_USER = 200;

const toItems = (items: RoutineItemDto[]) =>
  items.map((it) => ({
    name: it.name.trim(),
    exerciseSource: it.exerciseSource ?? null,
    exerciseId: it.exerciseId ?? null,
    primaryMuscle: it.primaryMuscle ?? null,
    restSec: it.restSec ?? null,
    sets: it.sets.map((s, i) => ({
      setNumber: s.setNumber ?? i + 1,
      reps: s.reps,
      weightKg: s.weightKg,
      isWarmup: s.isWarmup ?? false,
    })),
  }));

/** Buổi tập mẫu (BR-10.6) và bài tập do người dùng tự tạo (BR-10.3). Mọi thao tác chỉ trên dữ liệu của chính người dùng. */
@Injectable()
export class WorkoutRoutinesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.workoutRoutine.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } });
  }

  async create(userId: string, dto: CreateRoutineDto) {
    const count = await this.prisma.workoutRoutine.count({ where: { userId } });
    if (count >= MAX_ROUTINES_PER_USER) {
      throw new BadRequestException(`Mỗi người chỉ lưu tối đa ${MAX_ROUTINES_PER_USER} buổi tập mẫu`);
    }
    return this.prisma.workoutRoutine.create({
      data: {
        userId,
        name: dto.name.trim(),
        category: dto.category ?? WorkoutCategory.STRENGTH,
        items: toItems(dto.items),
      },
    });
  }

  /** Lưu buổi vừa tập thành mẫu: sao chép danh sách bài và số liệu; sửa mẫu sau này không đổi buổi đã ghi. */
  async createFromWorkout(userId: string, workoutId: string, name?: string) {
    const w = await this.prisma.workoutLog.findFirst({
      where: { id: workoutId, userId },
      include: { exercises: { include: { sets: { orderBy: { setNumber: 'asc' } } }, orderBy: { order: 'asc' } } },
    });
    if (!w) throw new NotFoundException('Không tìm thấy buổi tập');
    const count = await this.prisma.workoutRoutine.count({ where: { userId } });
    if (count >= MAX_ROUTINES_PER_USER) {
      throw new BadRequestException(`Mỗi người chỉ lưu tối đa ${MAX_ROUTINES_PER_USER} buổi tập mẫu`);
    }
    return this.prisma.workoutRoutine.create({
      data: {
        userId,
        name: (name ?? w.name).trim(),
        category: w.category,
        items: w.exercises.map((e) => ({
          name: e.name,
          exerciseSource: e.exerciseSource,
          exerciseId: e.exerciseRefId,
          primaryMuscle: e.primaryMuscle,
          restSec: e.restSec,
          sets: e.sets.map((s) => ({ setNumber: s.setNumber, reps: s.reps, weightKg: s.weightKg, isWarmup: s.isWarmup })),
        })),
      },
    });
  }

  private async own(userId: string, id: string) {
    const r = await this.prisma.workoutRoutine.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Không tìm thấy buổi tập mẫu');
    return r;
  }

  async update(userId: string, id: string, dto: UpdateRoutineDto) {
    await this.own(userId, id);
    return this.prisma.workoutRoutine.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.items !== undefined ? { items: toItems(dto.items) } : {}),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.own(userId, id);
    await this.prisma.workoutRoutine.delete({ where: { id } });
    return { success: true };
  }

  // ── Bài tập tự tạo ──
  listCustomExercises(userId: string) {
    return this.prisma.customExercise.findMany({ where: { userId }, orderBy: { name: 'asc' } });
  }

  async createCustomExercise(userId: string, dto: CreateCustomExerciseDto) {
    const name = dto.name.trim();
    const count = await this.prisma.customExercise.count({ where: { userId } });
    if (count >= MAX_CUSTOM_EXERCISES_PER_USER) {
      throw new BadRequestException(`Mỗi người chỉ tạo tối đa ${MAX_CUSTOM_EXERCISES_PER_USER} bài tập riêng`);
    }
    const dup = await this.prisma.customExercise.findFirst({ where: { userId, name } });
    if (dup) throw new ConflictException('Bạn đã có bài tập trùng tên');
    return this.prisma.customExercise.create({
      data: {
        userId,
        name,
        primaryMuscle: dto.primaryMuscle.trim(),
        equipment: dto.equipment ?? 'NO_EQUIPMENT',
        kind: dto.kind ?? 'STRENGTH',
      },
    });
  }

  /** Xoá bài tự tạo: các buổi đã ghi giữ nguyên tên và số liệu (đã lưu snapshot). */
  async removeCustomExercise(userId: string, id: string) {
    const ex = await this.prisma.customExercise.findFirst({ where: { id, userId } });
    if (!ex) throw new NotFoundException('Không tìm thấy bài tập');
    await this.prisma.customExercise.delete({ where: { id } });
    return { success: true };
  }
}
