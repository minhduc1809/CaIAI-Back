-- BR-10.3/10.4/10.6/10.8: mở rộng buổi tập, thêm bài tự tạo, buổi tập mẫu và kỷ lục cá nhân. Chạy lại an toàn.
ALTER TABLE "WorkoutLog"
  ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkoutLog_userId_clientRequestId_key" ON "WorkoutLog"("userId", "clientRequestId");

ALTER TABLE "WorkoutExercise"
  ADD COLUMN IF NOT EXISTS "exerciseSource" TEXT,
  ADD COLUMN IF NOT EXISTS "exerciseRefId" TEXT,
  ADD COLUMN IF NOT EXISTS "primaryMuscle" TEXT,
  ADD COLUMN IF NOT EXISTS "restSec" INTEGER;

ALTER TABLE "WorkoutSet"
  ADD COLUMN IF NOT EXISTS "isWarmup" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "durationSec" INTEGER,
  ADD COLUMN IF NOT EXISTS "distanceM" DOUBLE PRECISION;
-- RPE bước 0,5: đổi sang số thực (giá trị nguyên cũ giữ nguyên)
ALTER TABLE "WorkoutSet" ALTER COLUMN "rpe" TYPE DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "CustomExercise" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primaryMuscle" TEXT NOT NULL,
    "equipment" TEXT NOT NULL DEFAULT 'NO_EQUIPMENT',
    "kind" TEXT NOT NULL DEFAULT 'STRENGTH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomExercise_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomExercise_userId_name_key" ON "CustomExercise"("userId", "name");

CREATE TABLE IF NOT EXISTS "WorkoutRoutine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "WorkoutCategory" NOT NULL DEFAULT 'STRENGTH',
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkoutRoutine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkoutRoutine_userId_idx" ON "WorkoutRoutine"("userId");

CREATE TABLE IF NOT EXISTS "PersonalRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseKey" TEXT NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weightKey" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION NOT NULL,
    "reps" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "setId" TEXT,
    "workoutId" TEXT,
    "achievedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonalRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalRecord_userId_exerciseKey_type_weightKey_key"
  ON "PersonalRecord"("userId", "exerciseKey", "type", "weightKey");
CREATE INDEX IF NOT EXISTS "PersonalRecord_userId_exerciseKey_idx" ON "PersonalRecord"("userId", "exerciseKey");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomExercise_userId_fkey') THEN
    ALTER TABLE "CustomExercise" ADD CONSTRAINT "CustomExercise_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkoutRoutine_userId_fkey') THEN
    ALTER TABLE "WorkoutRoutine" ADD CONSTRAINT "WorkoutRoutine_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalRecord_userId_fkey') THEN
    ALTER TABLE "PersonalRecord" ADD CONSTRAINT "PersonalRecord_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
