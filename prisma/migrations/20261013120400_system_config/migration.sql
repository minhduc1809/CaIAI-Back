CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "SystemConfigHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT,
    "reason" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemConfigHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SystemConfigHistory_key_createdAt_idx" ON "SystemConfigHistory"("key", "createdAt");
CREATE INDEX IF NOT EXISTS "SystemConfigHistory_configVersion_idx" ON "SystemConfigHistory"("configVersion");
