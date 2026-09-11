-- AlterTable
ALTER TABLE "User" ADD COLUMN     "purchasedAiQuota" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "purchasedChatQuota" INTEGER NOT NULL DEFAULT 0;
