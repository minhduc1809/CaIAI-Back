/**
 * Script 1-lần: tạo tài khoản minnh_anh với đầy đủ dữ liệu (profile onboarding + lịch sử).
 * Tái dùng logic từ scripts/seed-demo-accounts.ts.
 * Chạy: npx ts-node scripts/seed-minnh-anh.ts
 */
import {
  PrismaClient,
  Role,
  Gender,
  ActivityLevel,
  GoalType,
  MacroStyle,
  StressLevel,
  DietType,
  FoodBudgetLevel,
  WorkoutLevel,
  TrainingGoal,
  SessionsPerWeek,
  EquipmentAccess,
  ProgramType,
  ProteinPreference,
  MealType,
  WorkoutCategory,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Test@123456';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(8, 0, 0, 0);
  return d;
}

async function seedProfileAndHistory(userId: string, opts: { startWeight: number; name: string }) {
  for (let i = 13; i >= 0; i--) {
    const w = opts.startWeight - (13 - i) * 0.1;
    await prisma.weightLog.create({
      data: {
        userId,
        weightKg: Math.round(w * 10) / 10,
        date: daysAgo(i),
        note: i === 13 ? 'Cân lúc bắt đầu' : null,
      },
    });
  }

  const mealTemplates: { type: MealType; name: string; calories: number; protein: number; carb: number; fat: number }[] = [
    { type: MealType.BREAKFAST, name: 'Phở bò', calories: 480, protein: 28, carb: 60, fat: 14 },
    { type: MealType.LUNCH, name: 'Cơm gà', calories: 680, protein: 40, carb: 75, fat: 20 },
    { type: MealType.DINNER, name: 'Cá hồi áp chảo + cơm', calories: 520, protein: 38, carb: 45, fat: 24 },
  ];

  for (let i = 4; i >= 0; i--) {
    const logDate = daysAgo(i);
    for (const t of mealTemplates) {
      const meal = await prisma.meal.create({
        data: {
          userId,
          mealType: t.type,
          date: logDate,
          logDate,
          totalCalories: t.calories,
          totalProtein: t.protein,
          totalCarb: t.carb,
          totalFat: t.fat,
        },
      });
      await prisma.mealItem.create({
        data: {
          mealId: meal.id,
          name: t.name,
          servingSize: '1 phần',
          calories: t.calories,
          protein: t.protein,
          carb: t.carb,
          fat: t.fat,
          source: 'manual',
        },
      });
    }
  }

  for (let i = 0; i < 3; i++) {
    const wl = await prisma.workoutLog.create({
      data: {
        userId,
        name: `Buổi tập ${opts.name} #${i + 1}`,
        category: WorkoutCategory.STRENGTH,
        date: daysAgo(i * 2 + 1),
        durationMinutes: 45,
        caloriesBurned: 350,
        rpe: 7,
      },
    });
    const ex = await prisma.workoutExercise.create({
      data: {
        workoutLogId: wl.id,
        name: 'Squat',
        order: 0,
        primaryMuscle: 'LEGS',
      },
    });
    await prisma.workoutSet.createMany({
      data: [
        { exerciseId: ex.id, setNumber: 1, reps: 10, weightKg: 40 },
        { exerciseId: ex.id, setNumber: 2, reps: 8, weightKg: 45 },
      ],
    });
  }

  await prisma.goal.create({
    data: {
      userId,
      goalType: GoalType.LOSE_WEIGHT,
      startWeight: opts.startWeight,
      targetWeight: opts.startWeight - 5,
      rateKgPerWeek: 0.5,
      status: 'ACTIVE',
    },
  });
}

async function upsertUser(params: { username: string; email: string; name: string; role: Role; gender: Gender; startWeight: number }) {
  const hashedPassword = await bcrypt.hash(PASSWORD, 12);
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 24);

  const data = {
    email: params.email,
    username: params.username,
    password: hashedPassword,
    name: params.name,
    role: params.role,
    isActive: true,
    isEmailVerified: true,
    emailVerifiedAt: new Date(),
    gender: params.gender,
    dateOfBirth: dob,
    heightCm: params.gender === Gender.FEMALE ? 160 : 175,
    weightKg: params.startWeight,
    targetWeightKg: params.startWeight - 5,
    weightRateKgPerWeek: 0.5,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    goal: GoalType.LOSE_WEIGHT,
    macroStyle: MacroStyle.BALANCED,
    allergies: ['Hải sản'],
    sleepHours: 7,
    stressLevel: StressLevel.MEDIUM,
    takesSupplements: false,
    dietType: DietType.OMNIVORE,
    mealsPerDay: 3,
    cookTimeMinutes: 30,
    foodBudgetLevel: FoodBudgetLevel.MEDIUM,
    trainingExperience: WorkoutLevel.BEGINNER,
    trainingGoal: TrainingGoal.LOSE_FAT,
    sessionsPerWeek: SessionsPerWeek.THREE_TO_FOUR,
    trainingDaysPerWeek: 3,
    equipmentAccess: EquipmentAccess.BASIC_GYM,
    programType: ProgramType.COACHED,
    proteinPreference: ProteinPreference.HIGH,
    bmi: 21.5,
    bmr: 1400,
    tdee: 2000,
    targetCalories: 1600,
    targetProtein: 120,
    targetCarb: 160,
    targetFat: 55,
    privacyAcceptedVersion: '1.0',
    privacyAcceptedAt: new Date(),
  };

  const existing = await prisma.user.findFirst({ where: { username: params.username } });
  if (existing) {
    const updated = await prisma.user.update({ where: { id: existing.id }, data });
    console.log(`[Seed minnh_anh] Cập nhật: ${updated.username} (${updated.id})`);
    return updated;
  }
  const created = await prisma.user.create({ data });
  console.log(`[Seed minnh_anh] Tạo mới: ${created.username} (${created.id})`);
  return created;
}

async function main() {
  const user = await upsertUser({
    username: 'minnh_anh',
    email: 'minnh_anh@calai.test',
    name: 'Minh Anh',
    role: Role.USER,
    gender: Gender.FEMALE,
    startWeight: 55,
  });
  await seedProfileAndHistory(user.id, { startWeight: 55, name: 'MinhAnh' });

  console.log('\n[Seed minnh_anh] Hoàn tất.');
  console.log(` - Username: ${user.username}`);
  console.log(` - Email:    ${user.email}`);
  console.log(` - Password: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('[Seed minnh_anh] Lỗi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
