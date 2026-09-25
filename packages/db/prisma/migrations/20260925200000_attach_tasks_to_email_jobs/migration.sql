-- Job → Tasks lists Task.jobId. Classifier tasks were saved without it
-- even when the source email already belonged to a job.
UPDATE "Task" AS t
SET "jobId" = e."jobId"
FROM "EmailMessage" AS e
WHERE t."sourceMessageId" = e.id
  AND t."workspaceId" = e."workspaceId"
  AND e."jobId" IS NOT NULL
  AND t."jobId" IS DISTINCT FROM e."jobId"
  AND EXISTS (
    SELECT 1
    FROM "Job" AS j
    WHERE j.id = e."jobId"
      AND j."workspaceId" = e."workspaceId"
  );
