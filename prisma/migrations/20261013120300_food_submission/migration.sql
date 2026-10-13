CREATE TABLE IF NOT EXISTS "FoodSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customFoodId" TEXT,
    "name" TEXT NOT NULL,
    "nameNormalized" TEXT NOT NULL,
    "servingSize" TEXT NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carb" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "barcode" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfName" TEXT,
    "rejectReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "catalogFoodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FoodSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FoodSubmission_userId_status_idx" ON "FoodSubmission"("userId", "status");
CREATE INDEX IF NOT EXISTS "FoodSubmission_status_createdAt_idx" ON "FoodSubmission"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "FoodSubmission" ADD CONSTRAINT "FoodSubmission_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
