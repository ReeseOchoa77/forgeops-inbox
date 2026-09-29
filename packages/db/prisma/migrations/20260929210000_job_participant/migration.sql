-- Job CRM Phase A: JobParticipant + activity actions

CREATE TYPE "JobParticipantRole" AS ENUM (
  'PROJECT_MANAGER',
  'ESTIMATOR',
  'GENERAL_CONTRACTOR',
  'CLIENT',
  'OWNER',
  'ARCHITECT',
  'ENGINEER',
  'DETAILER',
  'ERECTOR',
  'SUPPLIER',
  'OTHER'
);

CREATE TYPE "JobParticipantPartyType" AS ENUM (
  'USER',
  'CUSTOMER',
  'VENDOR',
  'CONTACT'
);

ALTER TYPE "JobActivityAction" ADD VALUE 'PARTICIPANT_ADDED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PARTICIPANT_UPDATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'PARTICIPANT_REMOVED';

CREATE TABLE "JobParticipant" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "role" "JobParticipantRole" NOT NULL,
  "partyType" "JobParticipantPartyType" NOT NULL,
  "userId" TEXT,
  "customerId" TEXT,
  "vendorId" TEXT,
  "contactId" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobParticipant_jobId_role_userId_key"
  ON "JobParticipant"("jobId", "role", "userId");

CREATE UNIQUE INDEX "JobParticipant_jobId_role_customerId_key"
  ON "JobParticipant"("jobId", "role", "customerId");

CREATE UNIQUE INDEX "JobParticipant_jobId_role_vendorId_key"
  ON "JobParticipant"("jobId", "role", "vendorId");

CREATE UNIQUE INDEX "JobParticipant_jobId_role_contactId_key"
  ON "JobParticipant"("jobId", "role", "contactId");

CREATE INDEX "JobParticipant_workspaceId_jobId_idx"
  ON "JobParticipant"("workspaceId", "jobId");

CREATE INDEX "JobParticipant_workspaceId_role_idx"
  ON "JobParticipant"("workspaceId", "role");

CREATE INDEX "JobParticipant_jobId_role_isPrimary_idx"
  ON "JobParticipant"("jobId", "role", "isPrimary");

ALTER TABLE "JobParticipant"
  ADD CONSTRAINT "JobParticipant_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobParticipant"
  ADD CONSTRAINT "JobParticipant_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobParticipant"
  ADD CONSTRAINT "JobParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobParticipant"
  ADD CONSTRAINT "JobParticipant_workspaceId_customerId_fkey"
  FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobParticipant"
  ADD CONSTRAINT "JobParticipant_workspaceId_vendorId_fkey"
  FOREIGN KEY ("workspaceId", "vendorId") REFERENCES "Vendor"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JobParticipant"
  ADD CONSTRAINT "JobParticipant_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "EntityContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
