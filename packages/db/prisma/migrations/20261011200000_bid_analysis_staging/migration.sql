-- Bid Analysis staging: BidCandidate + BidCandidateEmail + BidAnalysisRun.
-- Discovered bids are NOT Jobs until human confirmation.

CREATE TYPE "BidCandidateStatus" AS ENUM ('DISCOVERED', 'READY', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED');
CREATE TYPE "BidCandidateEmailRole" AS ENUM ('BID_INVITE', 'QUOTE', 'SUPPORTING', 'ADDENDUM');
CREATE TYPE "BidAnalysisRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "BidAnalysisRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "status" "BidAnalysisRunStatus" NOT NULL DEFAULT 'PENDING',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "initiatedByUserId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidAnalysisRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BidCandidate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "status" "BidCandidateStatus" NOT NULL DEFAULT 'DISCOVERED',
    "proposedProjectName" TEXT,
    "proposedCustomerName" TEXT,
    "proposedBidDueAt" TIMESTAMP(3),
    "proposedEstimatorUserId" TEXT,
    "proposedJobNumber" TEXT,
    "evidence" JSONB,
    "confidence" DECIMAL(5,4),
    "reviewNotes" TEXT,
    "canonicalJobId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BidCandidateEmail" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bidCandidateId" TEXT NOT NULL,
    "emailMessageId" TEXT NOT NULL,
    "role" "BidCandidateEmailRole" NOT NULL,
    "matchConfidence" DECIMAL(5,4),
    "matchEvidence" JSONB,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidCandidateEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BidAnalysisRun_workspaceId_createdAt_idx" ON "BidAnalysisRun"("workspaceId", "createdAt");
CREATE INDEX "BidAnalysisRun_workspaceId_inboxConnectionId_status_idx" ON "BidAnalysisRun"("workspaceId", "inboxConnectionId", "status");

CREATE UNIQUE INDEX "BidCandidate_workspaceId_identityKey_key" ON "BidCandidate"("workspaceId", "identityKey");
CREATE INDEX "BidCandidate_workspaceId_status_updatedAt_idx" ON "BidCandidate"("workspaceId", "status", "updatedAt");
CREATE INDEX "BidCandidate_workspaceId_proposedBidDueAt_idx" ON "BidCandidate"("workspaceId", "proposedBidDueAt");
CREATE INDEX "BidCandidate_canonicalJobId_idx" ON "BidCandidate"("canonicalJobId");

CREATE UNIQUE INDEX "BidCandidateEmail_bidCandidateId_emailMessageId_key" ON "BidCandidateEmail"("bidCandidateId", "emailMessageId");
CREATE INDEX "BidCandidateEmail_workspaceId_bidCandidateId_idx" ON "BidCandidateEmail"("workspaceId", "bidCandidateId");
CREATE INDEX "BidCandidateEmail_emailMessageId_idx" ON "BidCandidateEmail"("emailMessageId");
CREATE INDEX "BidCandidateEmail_workspaceId_role_idx" ON "BidCandidateEmail"("workspaceId", "role");

ALTER TABLE "BidAnalysisRun" ADD CONSTRAINT "BidAnalysisRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BidCandidate" ADD CONSTRAINT "BidCandidate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BidCandidate" ADD CONSTRAINT "BidCandidate_proposedEstimatorUserId_fkey" FOREIGN KEY ("proposedEstimatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidCandidate" ADD CONSTRAINT "BidCandidate_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BidCandidate" ADD CONSTRAINT "BidCandidate_canonicalJobId_fkey" FOREIGN KEY ("canonicalJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BidCandidateEmail" ADD CONSTRAINT "BidCandidateEmail_bidCandidateId_fkey" FOREIGN KEY ("bidCandidateId") REFERENCES "BidCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BidCandidateEmail" ADD CONSTRAINT "BidCandidateEmail_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
