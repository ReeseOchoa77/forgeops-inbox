-- CreateEnum
CREATE TYPE "MailboxReclassifyRunStatus" AS ENUM ('PENDING', 'RUNNING', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "MailboxReclassifyRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "status" "MailboxReclassifyRunStatus" NOT NULL DEFAULT 'PENDING',
    "filtersSnapshot" JSONB NOT NULL,
    "selectedMessageIds" JSONB,
    "totalMatched" INTEGER NOT NULL DEFAULT 0,
    "queued" INTEGER NOT NULL DEFAULT 0,
    "completed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "initiatedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailboxReclassifyRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailboxReclassifyRun_workspaceId_createdAt_idx" ON "MailboxReclassifyRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "MailboxReclassifyRun_workspaceId_inboxConnectionId_status_idx" ON "MailboxReclassifyRun"("workspaceId", "inboxConnectionId", "status");

-- AddForeignKey
ALTER TABLE "MailboxReclassifyRun" ADD CONSTRAINT "MailboxReclassifyRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
