CREATE TABLE IF NOT EXISTS "DataRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "handledBy" TEXT,
    "handledAt" TIMESTAMP(3),
    "resultNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DataRequest_status_dueAt_idx" ON "DataRequest"("status", "dueAt");
CREATE INDEX IF NOT EXISTS "DataRequest_email_idx" ON "DataRequest"("email");
