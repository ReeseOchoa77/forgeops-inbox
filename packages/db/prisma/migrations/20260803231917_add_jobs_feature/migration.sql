-- CreateEnum
CREATE TYPE "JobAssignmentSource" AS ENUM ('AI_SUGGESTED', 'AI_AUTO_ASSIGNED', 'USER_ASSIGNED', 'FOLDER_ALIAS', 'JOB_NUMBER_MATCH', 'IMPORT');

-- CreateEnum
CREATE TYPE "JobActivityAction" AS ENUM ('JOB_CREATED', 'JOB_UPDATED', 'JOB_ARCHIVED', 'JOB_RESTORED', 'JOB_STATUS_CHANGED', 'EMAIL_ASSIGNED', 'EMAIL_REMOVED', 'EMAIL_REASSIGNED', 'TASK_LINKED', 'TASK_REMOVED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'ALIAS_ADDED', 'ALIAS_REMOVED', 'CUSTOMER_CHANGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobStatus" ADD VALUE 'LEAD';
ALTER TYPE "JobStatus" ADD VALUE 'BIDDING';
ALTER TYPE "JobStatus" ADD VALUE 'AWARDED';
ALTER TYPE "JobStatus" ADD VALUE 'COMPLETE';
ALTER TYPE "JobStatus" ADD VALUE 'ARCHIVED';

-- DropForeignKey
ALTER TABLE "BusinessType" DROP CONSTRAINT "BusinessType_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationCorrection" DROP CONSTRAINT "ClassificationCorrection_classificationId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationCorrection" DROP CONSTRAINT "ClassificationCorrection_reviewedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationCorrection" DROP CONSTRAINT "ClassificationCorrection_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationInstruction" DROP CONSTRAINT "ClassificationInstruction_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "ClassificationInstruction" DROP CONSTRAINT "ClassificationInstruction_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "DiscoveredFolder" DROP CONSTRAINT "DiscoveredFolder_job_fkey";

-- DropForeignKey
ALTER TABLE "DiscoveredFolder" DROP CONSTRAINT "DiscoveredFolder_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "DomainEvidence" DROP CONSTRAINT "DomainEvidence_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "EmailAttachment" DROP CONSTRAINT "EmailAttachment_emailMessageId_fkey";

-- DropForeignKey
ALTER TABLE "EmailAttachment" DROP CONSTRAINT "EmailAttachment_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "EntityAlias" DROP CONSTRAINT "EntityAlias_customer_fkey";

-- DropForeignKey
ALTER TABLE "EntityAlias" DROP CONSTRAINT "EntityAlias_job_fkey";

-- DropForeignKey
ALTER TABLE "EntityAlias" DROP CONSTRAINT "EntityAlias_vendor_fkey";

-- DropForeignKey
ALTER TABLE "EntityAlias" DROP CONSTRAINT "EntityAlias_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "EntityContact" DROP CONSTRAINT "EntityContact_customer_fkey";

-- DropForeignKey
ALTER TABLE "EntityContact" DROP CONSTRAINT "EntityContact_vendor_fkey";

-- DropForeignKey
ALTER TABLE "EntityContact" DROP CONSTRAINT "EntityContact_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRun" DROP CONSTRAINT "ImportRun_knowledgeDocumentId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRun" DROP CONSTRAINT "ImportRun_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "JobFolderRoot" DROP CONSTRAINT "JobFolderRoot_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeDocument" DROP CONSTRAINT "KnowledgeDocument_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "KnowledgeDocument" DROP CONSTRAINT "KnowledgeDocument_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "SenderEvidence" DROP CONSTRAINT "SenderEvidence_workspaceId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceMailbox" DROP CONSTRAINT "WorkspaceMailbox_inboxConnectionId_fkey";

-- DropForeignKey
ALTER TABLE "WorkspaceMailbox" DROP CONSTRAINT "WorkspaceMailbox_workspaceId_fkey";

-- DropIndex
DROP INDEX "Classification_businessTypeKey_idx";

-- DropIndex
DROP INDEX "Classification_mailboxCategory_idx";

-- DropIndex
DROP INDEX "EmailMessage_internetMessageId_idx";

-- DropIndex
DROP INDEX "EmailMessage_isArchived_idx";

-- DropIndex
DROP INDEX "EmailMessage_isTestData_idx";

-- DropIndex
DROP INDEX "EmailMessage_mailboxCategory_idx";

-- DropIndex
DROP INDEX "InboxConnection_ingestionSource_idx";

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "jobAssignedAt" TIMESTAMP(3),
ADD COLUMN     "jobAssignedByUserId" TEXT,
ADD COLUMN     "jobAssignmentIsManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jobAssignmentSource" "JobAssignmentSource",
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "jobMatchConfidence" DOUBLE PRECISION,
ADD COLUMN     "jobMatchEvidence" JSONB;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "targetCompletionDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobMember" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobActivityLog" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "JobActivityAction" NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobMember_userId_idx" ON "JobMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "JobMember_jobId_userId_key" ON "JobMember"("jobId", "userId");

-- CreateIndex
CREATE INDEX "JobActivityLog_jobId_createdAt_idx" ON "JobActivityLog"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobActivityLog_workspaceId_createdAt_idx" ON "JobActivityLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "JobActivityLog_actorUserId_idx" ON "JobActivityLog"("actorUserId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_mailboxCategory_receivedAt_idx" ON "EmailMessage"("workspaceId", "mailboxCategory", "receivedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_jobId_idx" ON "EmailMessage"("jobId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_jobId_sentAt_idx" ON "EmailMessage"("workspaceId", "jobId", "sentAt");

-- CreateIndex
CREATE INDEX "Job_workspaceId_archivedAt_idx" ON "Job"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "Job_createdByUserId_idx" ON "Job"("createdByUserId");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMember" ADD CONSTRAINT "JobMember_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobActivityLog" ADD CONSTRAINT "JobActivityLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobActivityLog" ADD CONSTRAINT "JobActivityLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMailbox" ADD CONSTRAINT "WorkspaceMailbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMailbox" ADD CONSTRAINT "WorkspaceMailbox_inboxConnectionId_fkey" FOREIGN KEY ("inboxConnectionId") REFERENCES "InboxConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_workspaceId_customerId_fkey" FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_workspaceId_vendorId_fkey" FOREIGN KEY ("workspaceId", "vendorId") REFERENCES "Vendor"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_workspaceId_jobId_fkey" FOREIGN KEY ("workspaceId", "jobId") REFERENCES "Job"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityContact" ADD CONSTRAINT "EntityContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityContact" ADD CONSTRAINT "EntityContact_workspaceId_customerId_fkey" FOREIGN KEY ("workspaceId", "customerId") REFERENCES "Customer"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityContact" ADD CONSTRAINT "EntityContact_workspaceId_vendorId_fkey" FOREIGN KEY ("workspaceId", "vendorId") REFERENCES "Vendor"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessType" ADD CONSTRAINT "BusinessType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "Classification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationCorrection" ADD CONSTRAINT "ClassificationCorrection_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationInstruction" ADD CONSTRAINT "ClassificationInstruction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationInstruction" ADD CONSTRAINT "ClassificationInstruction_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredFolder" ADD CONSTRAINT "DiscoveredFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredFolder" ADD CONSTRAINT "DiscoveredFolder_workspaceId_matchedJobId_fkey" FOREIGN KEY ("workspaceId", "matchedJobId") REFERENCES "Job"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFolderRoot" ADD CONSTRAINT "JobFolderRoot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderEvidence" ADD CONSTRAINT "SenderEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainEvidence" ADD CONSTRAINT "DomainEvidence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "BusinessType_active_idx" RENAME TO "BusinessType_workspaceId_active_idx";

-- RenameIndex
ALTER INDEX "BusinessType_displayGroup_idx" RENAME TO "BusinessType_displayGroup_displayOrder_idx";

-- RenameIndex
ALTER INDEX "ClassificationCorrection_classification_idx" RENAME TO "ClassificationCorrection_workspaceId_classificationId_idx";

-- RenameIndex
ALTER INDEX "ClassificationCorrection_reviewedAt_idx" RENAME TO "ClassificationCorrection_workspaceId_reviewedAt_idx";

-- RenameIndex
ALTER INDEX "ClassificationInstruction_active_idx" RENAME TO "ClassificationInstruction_workspaceId_active_idx";

-- RenameIndex
ALTER INDEX "DiscoveredFolder_normalizedFolderName_idx" RENAME TO "DiscoveredFolder_workspaceId_normalizedFolderName_idx";

-- RenameIndex
ALTER INDEX "DiscoveredFolder_status_idx" RENAME TO "DiscoveredFolder_workspaceId_status_idx";

-- RenameIndex
ALTER INDEX "DomainEvidence_status_idx" RENAME TO "DomainEvidence_workspaceId_status_idx";

-- RenameIndex
ALTER INDEX "EmailAttachment_workspace_email_idx" RENAME TO "EmailAttachment_workspaceId_emailMessageId_idx";

-- RenameIndex
ALTER INDEX "EntityAlias_normalizedAlias_idx" RENAME TO "EntityAlias_workspaceId_normalizedAlias_idx";

-- RenameIndex
ALTER INDEX "EntityAlias_workspace_type_alias_idx" RENAME TO "EntityAlias_workspaceId_entityType_normalizedAlias_key";

-- RenameIndex
ALTER INDEX "EntityContact_domain_idx" RENAME TO "EntityContact_workspaceId_domain_idx";

-- RenameIndex
ALTER INDEX "EntityContact_normalizedEmail_idx" RENAME TO "EntityContact_workspaceId_normalizedEmail_idx";

-- RenameIndex
ALTER INDEX "ImportRun_importType_idx" RENAME TO "ImportRun_workspaceId_importType_idx";

-- RenameIndex
ALTER INDEX "ImportRun_status_idx" RENAME TO "ImportRun_workspaceId_status_idx";

-- RenameIndex
ALTER INDEX "JobFolderRoot_active_idx" RENAME TO "JobFolderRoot_workspaceId_active_idx";

-- RenameIndex
ALTER INDEX "KnowledgeDocument_documentType_idx" RENAME TO "KnowledgeDocument_workspaceId_documentType_idx";

-- RenameIndex
ALTER INDEX "KnowledgeDocument_status_idx" RENAME TO "KnowledgeDocument_workspaceId_status_idx";

-- RenameIndex
ALTER INDEX "Membership_workspaceRole_idx" RENAME TO "Membership_workspaceId_workspaceRole_idx";

-- RenameIndex
ALTER INDEX "SenderEvidence_domain_idx" RENAME TO "SenderEvidence_workspaceId_senderDomain_idx";

-- RenameIndex
ALTER INDEX "SenderEvidence_status_idx" RENAME TO "SenderEvidence_workspaceId_status_idx";

-- RenameIndex
ALTER INDEX "WorkspaceMailbox_status_idx" RENAME TO "WorkspaceMailbox_workspaceId_status_idx";
