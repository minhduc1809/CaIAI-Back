-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELED', 'IN_GRACE_PERIOD', 'ON_HOLD', 'PAUSED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "Product" (
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SUBSCRIPTION',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "purchaseToken" TEXT NOT NULL,
    "orderId" TEXT,
    "userId" TEXT,
    "productId" TEXT NOT NULL,
    "purchaseTime" TIMESTAMP(3) NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "linkedPurchaseToken" TEXT,
    "rawResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionState" (
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "SubStatus" NOT NULL,
    "expiryTime" TIMESTAMP(3) NOT NULL,
    "autoRenewing" BOOLEAN NOT NULL,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "currentPurchaseToken" TEXT NOT NULL,
    "lastReconciledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionState_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ManualGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,

    CONSTRAINT "ManualGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "purchaseToken" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "messageId" TEXT,
    "actorId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_purchaseToken_key" ON "Purchase"("purchaseToken");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "ManualGrant_userId_idx" ON "ManualGrant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_messageId_key" ON "BillingEvent"("messageId");

-- CreateIndex
CREATE INDEX "BillingEvent_userId_idx" ON "BillingEvent"("userId");

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionState" ADD CONSTRAINT "SubscriptionState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualGrant" ADD CONSTRAINT "ManualGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sản phẩm bán (giá cấu hình trên Google Play Console, không lưu ở đây)
INSERT INTO "Product" ("productId", "type", "isActive") VALUES
  ('premium_monthly', 'SUBSCRIPTION', true),
  ('premium_yearly', 'SUBSCRIPTION', true);
