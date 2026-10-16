/**
 * Script 1-lần: tạo 4 tài khoản demo đầy đủ dữ liệu cho việc demo app (FREE, MONTHLY, YEARLY, ADMIN).
 * Mỗi tài khoản có hồ sơ onboarding đầy đủ + lịch sử (meal logs, weight logs, workout logs).
 * Chạy: npx ts-node scripts/seed-demo-accounts.ts
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
  SubStatus,
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

async function seedProfileAndHistory(
  userId: string,
  opts: { startWeight: number; name: string },
) {
  // --- Weight logs: 14 ngày gần nhất, giảm dần nhẹ ---
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

  // --- Meal logs: 5 ngày gần nhất, 3 bữa/ngày ---
  const mealTemplates: {
    type: MealType;
    name: string;
    calories: number;
    protein: number;
    carb: number;
    fat: number;
  }[] = [
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

  // --- Workout logs: 3 buổi gần nhất ---
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

  // --- Goal hiện hành ---
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

async function upsertUser(params: {
  username: string;
  email: string;
  name: string;
  role: Role;
  gender: Gender;
  startWeight: number;
}) {
  const hashedPassword = await bcrypt.hash(PASSWORD, 12);
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 28);

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
    heightCm: params.gender === Gender.FEMALE ? 162 : 175,
    weightKg: params.startWeight,
    targetWeightKg: params.startWeight - 5,
    weightRateKgPerWeek: 0.5,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    goal: GoalType.LOSE_WEIGHT,
    macroStyle: MacroStyle.BALANCED,
    allergies: ['Đậu phộng'],
    sleepHours: 7,
    stressLevel: StressLevel.MEDIUM,
    takesSupplements: true,
    dietType: DietType.OMNIVORE,
    mealsPerDay: 3,
    cookTimeMinutes: 30,
    foodBudgetLevel: FoodBudgetLevel.MEDIUM,
    trainingExperience: WorkoutLevel.INTERMEDIATE,
    trainingGoal: TrainingGoal.LOSE_FAT,
    sessionsPerWeek: SessionsPerWeek.THREE_TO_FOUR,
    trainingDaysPerWeek: 4,
    equipmentAccess: EquipmentAccess.BASIC_GYM,
    programType: ProgramType.COACHED,
    proteinPreference: ProteinPreference.HIGH,
    bmi: 22.5,
    bmr: 1600,
    tdee: 2200,
    targetCalories: 1800,
    targetProtein: 140,
    targetCarb: 180,
    targetFat: 60,
    privacyAcceptedVersion: '1.0',
    privacyAcceptedAt: new Date(),
  };

  const existing = await prisma.user.findFirst({ where: { email: params.email } });
  if (existing) {
    const updated = await prisma.user.update({ where: { id: existing.id }, data });
    console.log(`[Seed Demo] Cập nhật: ${params.email} (${updated.id})`);
    return updated;
  }
  const created = await prisma.user.create({ data });
  console.log(`[Seed Demo] Tạo mới: ${params.email} (${created.id})`);
  return created;
}

async function ensureSubscription(
  userId: string,
  productId: 'premium_monthly' | 'premium_yearly',
) {
  await prisma.product.upsert({
    where: { productId },
    update: { isActive: true },
    create: { productId, type: 'SUBSCRIPTION', isActive: true },
  });

  const now = new Date();
  const expiry = new Date(now);
  if (productId === 'premium_monthly') {
    expiry.setMonth(expiry.getMonth() + 1);
  } else {
    expiry.setFullYear(expiry.getFullYear() + 1);
  }

  const purchaseToken = `demo-token-${userId}`;

  await prisma.purchase.upsert({
    where: { purchaseToken },
    update: {},
    create: {
      purchaseToken,
      orderId: `demo-order-${userId}`,
      userId,
      productId,
      purchaseTime: now,
      acknowledged: true,
      rawResponse: { demo: true, productId },
    },
  });

  await prisma.subscriptionState.upsert({
    where: { userId },
    update: {
      productId,
      status: SubStatus.ACTIVE,
      expiryTime: expiry,
      autoRenewing: true,
      isTrial: false,
      currentPurchaseToken: purchaseToken,
      lastReconciledAt: now,
    },
    create: {
      userId,
      productId,
      status: SubStatus.ACTIVE,
      expiryTime: expiry,
      autoRenewing: true,
      isTrial: false,
      currentPurchaseToken: purchaseToken,
      lastReconciledAt: now,
    },
  });
}

async function main() {
  // 1. FREE user
  const free = await upsertUser({
    username: 'free_demo',
    email: 'free@calai.test',
    name: 'Nguyễn Văn Free',
    role: Role.USER,
    gender: Gender.MALE,
    startWeight: 75,
  });
  await seedProfileAndHistory(free.id, { startWeight: 75, name: 'Free' });

  // 2. MONTHLY paid user
  const monthly = await upsertUser({
    username: 'monthly_demo',
    email: 'monthly@calai.test',
    name: 'Trần Thị Monthly',
    role: Role.USER,
    gender: Gender.FEMALE,
    startWeight: 62,
  });
  await seedProfileAndHistory(monthly.id, { startWeight: 62, name: 'Monthly' });
  await ensureSubscription(monthly.id, 'premium_monthly');

  // 3. YEARLY paid user
  const yearly = await upsertUser({
    username: 'yearly_demo',
    email: 'yearly@calai.test',
    name: 'Lê Văn Yearly',
    role: Role.USER,
    gender: Gender.MALE,
    startWeight: 80,
  });
  await seedProfileAndHistory(yearly.id, { startWeight: 80, name: 'Yearly' });
  await ensureSubscription(yearly.id, 'premium_yearly');

  // 4. ADMIN user
  const admin = await upsertUser({
    username: 'admin_demo',
    email: 'admin@calai.test',
    name: 'Quản Trị Viên',
    role: Role.ADMIN,
    gender: Gender.FEMALE,
    startWeight: 58,
  });
  await seedProfileAndHistory(admin.id, { startWeight: 58, name: 'Admin' });

  console.log('\n[Seed Demo] Hoàn tất 4 tài khoản demo. Mật khẩu chung: ' + PASSWORD);
  console.log(` - FREE:    ${free.email} / ${PASSWORD}`);
  console.log(` - MONTHLY: ${monthly.email} / ${PASSWORD}`);
  console.log(` - YEARLY:  ${yearly.email} / ${PASSWORD}`);
  console.log(` - ADMIN:   ${admin.email} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('[Seed Demo] Lỗi:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
