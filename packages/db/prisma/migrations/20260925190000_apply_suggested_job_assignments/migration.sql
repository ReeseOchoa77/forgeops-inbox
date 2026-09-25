-- Auto-matched jobs were stored on Classification only until a user clicked Confirm.
-- Put that job on the email. Leave manual removals and protected assignments alone.
UPDATE "EmailMessage" AS em
SET
  "jobId" = picked."jobId",
  "jobAssignedAt" = COALESCE(em."jobAssignedAt", NOW())
FROM (
  SELECT DISTINCT ON (c."messageId")
    c."messageId",
    c."jobId"
  FROM "Classification" c
  INNER JOIN "Job" j
    ON j.id = c."jobId"
   AND j."workspaceId" = c."workspaceId"
  WHERE c."messageId" IS NOT NULL
    AND c."jobId" IS NOT NULL
  ORDER BY c."messageId", c."updatedAt" DESC
) AS picked
WHERE em.id = picked."messageId"
  AND em."jobId" IS NULL
  AND em."jobAssignmentIsManual" = false
  AND em."jobAssignmentSource" IN ('AI_SUGGESTED', 'AI_AUTO_ASSIGNED', 'JOB_NUMBER_MATCH');
