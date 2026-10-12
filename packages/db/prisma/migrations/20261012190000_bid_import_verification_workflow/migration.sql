-- Bid Import + Verification workflow: quote staging + existing-job proposals + override fields.

CREATE TYPE "BidExistingJobMatchStatus" AS ENUM ('NONE', 'POSSIBLE', 'STRONG', 'NEEDS_REVIEW', 'RESOLVED_SAME', 'RESOLVED_DIFFERENT');
CREATE TYPE "BidQuoteMatchStatus" AS ENUM ('UNMATCHED', 'POSSIBLE_MATCH', 'MATCHED', 'NEEDS_REVIEW', 'USER_UNMATCHED');

ALTER TABLE "BidCandidate" ADD COLUMN "proposedScope" TEXT;
ALTER TABLE "BidCandidate" ADD COLUMN "proposedNotes" TEXT;
ALTER TABLE "BidCandidate" ADD COLUMN "userEditedFields" JSONB;
ALTER TABLE "BidCandidate" ADD COLUMN "proposedExistingJobId" TEXT;
ALTER TABLE "BidCandidate" ADD COLUMN "existingJobMatchStatus" "BidExistingJobMatchStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "BidCandidate" ADD COLUMN "existingJobMatchEvidence" JSONB;
ALTER TABLE "BidCandidate" ADD COLUMN "existingJobMatchConfidence" DECIMAL(5,4);
ALTER TABLE "BidCandidate" ADD COLUMN "importBlockedReason" TEXT;

CREATE TABLE "BidQuoteStaging" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "sourceSubject" TEXT,
    "extractedScope" TEXT,
    "extractedAmount" DECIMAL(14,2),
    "currency" TEXT,
    "extractedNotes" TEXT,
    "extractionEvidence" JSONB,
    "extractionConfidence" DECIMAL(5,4),
    "bidCandidateId" TEXT,
    "matchStatus" "BidQuoteMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matchConfidence" DECIMAL(5,4),
    "matchEvidence" JSONB,
    "userConfirmedMatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidQuoteStaging_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidQuoteStaging_workspaceId_emailMessageId_key" ON "BidQuoteStaging"("workspaceId", "emailMessageId");
CREATE INDEX "BidQuoteStaging_workspaceId_inboxConnectionId_matchStatus_idx" ON "BidQuoteStaging"("workspaceId", "inboxConnectionId", "matchStatus");
CREATE INDEX "BidQuoteStaging_bidCandidateId_idx" ON "BidQuoteStaging"("bidCandidateId");
CREATE INDEX "BidQuoteStaging_emailMessageId_idx" ON "BidQuoteStaging"("emailMessageId");

CREATE INDEX "BidCandidate_proposedExistingJobId_idx" ON "BidCandidate"("proposedExistingJobId");
CREATE INDEX "BidCandidate_workspaceId_existingJobMatchStatus_idx" ON "BidCandidate"("workspaceId", "existingJobMatchStatus");

ALTER TABLE "BidCandidate" ADD CONSTRAINT "BidCandidate_proposedExistingJobId_fkey" FOREIGN KEY ("proposedExistingJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidQuoteStaging" ADD CONSTRAINT "BidQuoteStaging_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BidQuoteStaging" ADD CONSTRAINT "BidQuoteStaging_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BidQuoteStaging" ADD CONSTRAINT "BidQuoteStaging_bidCandidateId_fkey" FOREIGN KEY ("bidCandidateId") REFERENCES "BidCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
