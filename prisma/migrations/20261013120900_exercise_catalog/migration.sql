CREATE TABLE IF NOT EXISTS "ExerciseCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "genderTarget" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "targetMuscle" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OFFICIAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExerciseCatalog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExerciseCatalog_genderTarget_level_isActive_idx" ON "ExerciseCatalog"("genderTarget", "level", "isActive");
CREATE INDEX IF NOT EXISTS "ExerciseCatalog_nameNormalized_idx" ON "ExerciseCatalog"("nameNormalized");
