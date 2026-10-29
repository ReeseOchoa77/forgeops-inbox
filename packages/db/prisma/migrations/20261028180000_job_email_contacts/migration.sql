-- Durable Job ↔ EntityContact links learned from confirmed email assignment.

CREATE TYPE "JobEmailContactSource" AS ENUM ('LEARNED_FROM_EMAIL', 'MANUAL');

CREATE TABLE "JobEmailContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "source" "JobEmailContactSource" NOT NULL DEFAULT 'LEARNED_FROM_EMAIL',
    "firstEmailMessageId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobEmailContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobEmailContact_jobId_contactId_key" ON "JobEmailContact"("jobId", "contactId");

CREATE INDEX "JobEmailContact_workspaceId_jobId_idx" ON "JobEmailContact"("workspaceId", "jobId");

CREATE INDEX "JobEmailContact_contactId_idx" ON "JobEmailContact"("contactId");

CREATE INDEX "JobEmailContact_firstEmailMessageId_idx" ON "JobEmailContact"("firstEmailMessageId");

ALTER TABLE "JobEmailContact"
  ADD CONSTRAINT "JobEmailContact_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobEmailContact"
  ADD CONSTRAINT "JobEmailContact_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobEmailContact"
  ADD CONSTRAINT "JobEmailContact_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "EntityContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobEmailContact"
  ADD CONSTRAINT "JobEmailContact_firstEmailMessageId_fkey"
  FOREIGN KEY ("firstEmailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
