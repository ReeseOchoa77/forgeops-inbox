-- Repair Business/Personal tab mismatches caused by writers updating
-- Classification.businessCategory without EmailMessage.mailboxCategory.
-- Inbox tabs filter EmailMessage.mailboxCategory; keep it aligned with
-- the latest Classification.businessCategory for BUSINESS/PERSONAL only
-- (do not touch SPAM/TRASH).

UPDATE "EmailMessage" AS em
SET "mailboxCategory" = 'PERSONAL'
FROM "Classification" AS c
WHERE c."messageId" = em."id"
  AND c."businessCategory" = 'NON_BUSINESS'
  AND em."mailboxCategory" = 'BUSINESS';

UPDATE "EmailMessage" AS em
SET "mailboxCategory" = 'BUSINESS'
FROM "Classification" AS c
WHERE c."messageId" = em."id"
  AND c."businessCategory" = 'BUSINESS'
  AND em."mailboxCategory" = 'PERSONAL';

-- Also backfill Classification.mailboxCategory when missing/out of sync.
UPDATE "Classification"
SET "mailboxCategory" = 'PERSONAL'
WHERE "businessCategory" = 'NON_BUSINESS'
  AND ("mailboxCategory" IS NULL OR "mailboxCategory" = 'BUSINESS');

UPDATE "Classification"
SET "mailboxCategory" = 'BUSINESS'
WHERE "businessCategory" = 'BUSINESS'
  AND ("mailboxCategory" IS NULL OR "mailboxCategory" = 'PERSONAL');
