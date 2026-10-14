-- Permanent Bid Candidate: lifecycle, customer, anticipated start, durable quotes.

CREATE TYPE "BidCandidateLifecycle" AS ENUM ('OPEN', 'QUOTED', 'CONVERTED', 'LOST', 'ARCHIVED');

ALTER TABLE "BidCandidate" ADD COLUMN "lifecycle" "BidCandidateLifecycle" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "BidCandidate" ADD COLUMN "customerId" TEXT;
ALTER TABLE "BidCandidate" ADD COLUMN "anticipatedStartAt" TIMESTAMP(3);

ALTER TABLE "BidQuoteStaging" ADD COLUMN "isDurable" BOOLEAN NOT NULL DEFAULT false;

-- Durable quotes already linked to a Candidate (or user-confirmed / edited).
UPDATE "BidQuoteStaging"
SET "isDurable" = true
WHERE "bidCandidateId" IS NOT NULL
   OR "userConfirmedMatch" = true
   OR ("userEditedFields" IS NOT NULL AND "userEditedFields"::text <> 'null' AND "userEditedFields"::text <> '[]');

-- Business lifecycle backfill from analysis/import status + quote presence.
UPDATE "BidCandidate"
SET "lifecycle" = 'CONVERTED'
WHERE "status" = 'CONFIRMED' OR "canonicalJobId" IS NOT NULL;

UPDATE "BidCandidate"
SET "lifecycle" = 'QUOTED'
WHERE "lifecycle" = 'OPEN'
  AND EXISTS (
    SELECT 1 FROM "BidQuoteStaging" q
    WHERE q."bidCandidateId" = "BidCandidate"."id"
      AND q."matchStatus" <> 'REJECTED'
  );

CREATE INDEX "BidCandidate_workspaceId_lifecycle_updatedAt_idx" ON "BidCandidate"("workspaceId", "lifecycle", "updatedAt");
CREATE INDEX "BidCandidate_workspaceId_anticipatedStartAt_idx" ON "BidCandidate"("workspaceId", "anticipatedStartAt");
CREATE INDEX "BidCandidate_workspaceId_customerId_idx" ON "BidCandidate"("workspaceId", "customerId");
CREATE INDEX "BidQuoteStaging_workspaceId_isDurable_idx" ON "BidQuoteStaging"("workspaceId", "isDurable");

ALTER TABLE "BidCandidate" ADD CONSTRAINT "BidCandidate_workspaceId_customerId_fkey" FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;
