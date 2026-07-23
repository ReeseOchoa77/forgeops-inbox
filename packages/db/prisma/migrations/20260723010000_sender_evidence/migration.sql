CREATE TYPE "SenderStatus" AS ENUM ('OBSERVED', 'LIKELY_BUSINESS', 'CONFIRMED_BUSINESS', 'CONFIRMED_PERSONAL', 'BLOCKED');

CREATE TABLE "SenderEvidence" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "senderEmail" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "senderDomain" TEXT NOT NULL,
  "displayName" TEXT,
  "businessEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  "personalEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  "manualBusinessConfirmations" INTEGER NOT NULL DEFAULT 0,
  "manualPersonalConfirmations" INTEGER NOT NULL DEFAULT 0,
  "lastBusinessAt" TIMESTAMP(3),
  "lastPersonalAt" TIMESTAMP(3),
  "status" "SenderStatus" NOT NULL DEFAULT 'OBSERVED',
  "confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SenderEvidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SenderEvidence" ADD CONSTRAINT "SenderEvidence_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "SenderEvidence_workspaceId_normalizedEmail_key"
  ON "SenderEvidence"("workspaceId", "normalizedEmail");
CREATE INDEX "SenderEvidence_domain_idx" ON "SenderEvidence"("workspaceId", "senderDomain");
CREATE INDEX "SenderEvidence_status_idx" ON "SenderEvidence"("workspaceId", "status");

CREATE TABLE "DomainEvidence" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "isPublicDomain" BOOLEAN NOT NULL DEFAULT false,
  "businessEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  "personalEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  "manualBusinessConfirmations" INTEGER NOT NULL DEFAULT 0,
  "manualPersonalConfirmations" INTEGER NOT NULL DEFAULT 0,
  "status" "SenderStatus" NOT NULL DEFAULT 'OBSERVED',
  "confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DomainEvidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DomainEvidence" ADD CONSTRAINT "DomainEvidence_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
CREATE UNIQUE INDEX "DomainEvidence_workspaceId_domain_key"
  ON "DomainEvidence"("workspaceId", "domain");
CREATE INDEX "DomainEvidence_status_idx" ON "DomainEvidence"("workspaceId", "status");
