-- Task ownership: requesterUserId, TaskSource, nullable sourceThreadId.
-- Deterministic assignee backfill for RECEIVED email tasks (exact TO → User.email).

CREATE TYPE "TaskSource" AS ENUM ('EMAIL', 'MANUAL');

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "requesterUserId" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "source" "TaskSource" NOT NULL DEFAULT 'EMAIL';

-- Existing rows: EMAIL when linked to a message; MANUAL otherwise.
UPDATE "Task" SET "source" = 'EMAIL' WHERE "sourceMessageId" IS NOT NULL;
UPDATE "Task" SET "source" = 'MANUAL' WHERE "sourceMessageId" IS NULL;

ALTER TABLE "Task" ALTER COLUMN "sourceThreadId" DROP NOT NULL;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_requesterUserId_fkey"
  FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Task_workspaceId_requesterUserId_status_idx"
  ON "Task"("workspaceId", "requesterUserId", "status");

CREATE INDEX IF NOT EXISTS "Task_workspaceId_source_idx"
  ON "Task"("workspaceId", "source");

-- Deterministic assignee backfill:
-- RECEIVED (or legacy null direction) email tasks with exactly one distinct
-- active workspace member whose User.email matches a TO address.
-- Does NOT use CC, assigneeGuess, or SENT mail.
WITH to_matches AS (
  SELECT
    t.id AS task_id,
    u.id AS user_id
  FROM "Task" t
  INNER JOIN "EmailMessage" em
    ON em.id = t."sourceMessageId"
   AND em."workspaceId" = t."workspaceId"
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(em."toAddresses"::jsonb) = 'array' THEN em."toAddresses"::jsonb
      ELSE '[]'::jsonb
    END
  ) AS addr(value)
  INNER JOIN "User" u
    ON lower(trim(u.email)) = lower(trim(addr.value->>'email'))
  INNER JOIN "Membership" m
    ON m."userId" = u.id
   AND m."workspaceId" = t."workspaceId"
  WHERE t."assigneeUserId" IS NULL
    AND t."sourceMessageId" IS NOT NULL
    AND (em.direction = 'RECEIVED' OR em.direction IS NULL)
    AND addr.value->>'email' IS NOT NULL
    AND trim(addr.value->>'email') <> ''
),
unique_assignees AS (
  SELECT task_id, MIN(user_id) AS user_id
  FROM to_matches
  GROUP BY task_id
  HAVING COUNT(DISTINCT user_id) = 1
)
UPDATE "Task" t
SET "assigneeUserId" = ua.user_id
FROM unique_assignees ua
WHERE t.id = ua.task_id
  AND t."assigneeUserId" IS NULL;
