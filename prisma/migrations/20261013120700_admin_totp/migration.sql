CREATE TABLE IF NOT EXISTS "AdminTotp" (
    "userId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "backupCodeHashes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminTotp_pkey" PRIMARY KEY ("userId")
);
