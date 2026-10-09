-- CreateTable
CREATE TABLE "UsageCounter" (
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "aiPhoto" INTEGER NOT NULL DEFAULT 0,
    "chatTokens" INTEGER NOT NULL DEFAULT 0,
    "chatMessages" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("userId","date")
);

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
