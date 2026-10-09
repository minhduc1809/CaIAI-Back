-- CreateTable
CREATE TABLE "ExpenditureSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adaptiveExpenditure" DOUBLE PRECISION,
    "staticTdee" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenditureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenditureSnapshot_userId_recordedAt_idx" ON "ExpenditureSnapshot"("userId", "recordedAt");

-- AddForeignKey
ALTER TABLE "ExpenditureSnapshot" ADD CONSTRAINT "ExpenditureSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
