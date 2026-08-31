-- AlterTable: add Task.sourceDate (nullable first for backfill)
ALTER TABLE "Task" ADD COLUMN "sourceDate" TIMESTAMP(3);

-- Backfill from source EmailMessage canonical date (receivedAt preferred, else sentAt)
UPDATE "Task" AS t
SET "sourceDate" = COALESCE(m."receivedAt", m."sentAt")
FROM "EmailMessage" AS m
WHERE t."sourceMessageId" IS NOT NULL
  AND m.id = t."sourceMessageId"
  AND m."workspaceId" = t."workspaceId"
  AND t."sourceDate" IS NULL;

-- Orphaned / unlinked tasks: fall back to createdAt (idempotent)
UPDATE "Task"
SET "sourceDate" = "createdAt"
WHERE "sourceDate" IS NULL;

-- Make required
ALTER TABLE "Task" ALTER COLUMN "sourceDate" SET NOT NULL;

-- Index for timeline filters + bulk delete by sourceDate
CREATE INDEX "Task_workspaceId_sourceDate_idx" ON "Task"("workspaceId", "sourceDate");
