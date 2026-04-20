-- AddColumn: provider-neutral ID columns alongside Gmail-named originals
ALTER TABLE "EmailThread" ADD COLUMN "providerThreadId" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "providerMessageId" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN "providerThreadId" TEXT;

-- Backfill from existing Gmail-named columns
UPDATE "EmailThread" SET "providerThreadId" = "gmailThreadId" WHERE "providerThreadId" IS NULL;
UPDATE "EmailMessage" SET "providerMessageId" = "gmailMessageId" WHERE "providerMessageId" IS NULL;
UPDATE "EmailMessage" SET "providerThreadId" = "gmailThreadId" WHERE "providerThreadId" IS NULL;

-- Create indexes on the new columns (matching the pattern of the originals)
CREATE INDEX "EmailThread_providerThreadId_idx" ON "EmailThread"("providerThreadId");
CREATE INDEX "EmailThread_workspaceId_providerThreadId_idx" ON "EmailThread"("workspaceId", "providerThreadId");
CREATE INDEX "EmailMessage_providerMessageId_idx" ON "EmailMessage"("providerMessageId");
CREATE INDEX "EmailMessage_providerThreadId_idx" ON "EmailMessage"("providerThreadId");
CREATE INDEX "EmailMessage_workspaceId_providerMessageId_idx" ON "EmailMessage"("workspaceId", "providerMessageId");
CREATE INDEX "EmailMessage_workspaceId_providerThreadId_idx" ON "EmailMessage"("workspaceId", "providerThreadId");
