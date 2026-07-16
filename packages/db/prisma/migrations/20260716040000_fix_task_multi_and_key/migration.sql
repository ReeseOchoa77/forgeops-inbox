-- Add sourceTaskKey column for stable per-task identity
ALTER TABLE "Task" ADD COLUMN "sourceTaskKey" TEXT;

-- Drop the old one-task-per-message unique constraint
DROP INDEX IF EXISTS "Task_workspaceId_sourceMessageId_key";

-- Create new composite unique: workspaceId + sourceMessageId + sourceTaskKey
-- This allows multiple tasks per message, each with a distinct key
CREATE UNIQUE INDEX "Task_workspaceId_sourceMessageId_sourceTaskKey_key"
  ON "Task"("workspaceId", "sourceMessageId", "sourceTaskKey");

-- Backfill existing tasks with a key derived from their title
UPDATE "Task" SET "sourceTaskKey" = LEFT(MD5("title"), 16) WHERE "sourceTaskKey" IS NULL;
