ALTER TABLE "EmailMessage" ADD COLUMN "isTestData" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailMessage" ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EmailMessage" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "EmailMessage_isArchived_idx" ON "EmailMessage"("workspaceId", "isArchived");
CREATE INDEX "EmailMessage_isTestData_idx" ON "EmailMessage"("workspaceId", "isTestData");
