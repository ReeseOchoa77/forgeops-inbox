-- Enums
CREATE TYPE "EntityType" AS ENUM ('CUSTOMER', 'VENDOR', 'JOB');
CREATE TYPE "AliasSource" AS ENUM ('MANUAL', 'IMPORT', 'REVIEW');
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');
CREATE TYPE "DocumentType" AS ENUM ('CUSTOMER_LIST', 'VENDOR_LIST', 'JOB_LIST', 'CLASSIFICATION_GUIDE', 'OTHER');
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- EntityAlias
CREATE TABLE "EntityAlias" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "entityType" "EntityType" NOT NULL,
  "customerId" TEXT,
  "vendorId" TEXT,
  "jobId" TEXT,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "source" "AliasSource" NOT NULL DEFAULT 'IMPORT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_customer_fkey" FOREIGN KEY ("workspaceId","customerId") REFERENCES "Customer"("workspaceId","id") ON DELETE SET NULL;
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_vendor_fkey" FOREIGN KEY ("workspaceId","vendorId") REFERENCES "Vendor"("workspaceId","id") ON DELETE SET NULL;
ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_job_fkey" FOREIGN KEY ("workspaceId","jobId") REFERENCES "Job"("workspaceId","id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "EntityAlias_workspace_type_alias_idx" ON "EntityAlias"("workspaceId", "entityType", "normalizedAlias");
CREATE INDEX "EntityAlias_normalizedAlias_idx" ON "EntityAlias"("workspaceId", "normalizedAlias");
CREATE INDEX "EntityAlias_customerId_idx" ON "EntityAlias"("customerId");
CREATE INDEX "EntityAlias_vendorId_idx" ON "EntityAlias"("vendorId");
CREATE INDEX "EntityAlias_jobId_idx" ON "EntityAlias"("jobId");

-- EntityContact
CREATE TABLE "EntityContact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "customerId" TEXT,
  "vendorId" TEXT,
  "name" TEXT,
  "email" TEXT,
  "normalizedEmail" TEXT,
  "domain" TEXT,
  "phone" TEXT,
  "role" TEXT,
  "source" "AliasSource" NOT NULL DEFAULT 'IMPORT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntityContact_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "EntityContact" ADD CONSTRAINT "EntityContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "EntityContact" ADD CONSTRAINT "EntityContact_customer_fkey" FOREIGN KEY ("workspaceId","customerId") REFERENCES "Customer"("workspaceId","id") ON DELETE SET NULL;
ALTER TABLE "EntityContact" ADD CONSTRAINT "EntityContact_vendor_fkey" FOREIGN KEY ("workspaceId","vendorId") REFERENCES "Vendor"("workspaceId","id") ON DELETE SET NULL;
CREATE INDEX "EntityContact_normalizedEmail_idx" ON "EntityContact"("workspaceId", "normalizedEmail");
CREATE INDEX "EntityContact_domain_idx" ON "EntityContact"("workspaceId", "domain");
CREATE INDEX "EntityContact_customerId_idx" ON "EntityContact"("customerId");
CREATE INDEX "EntityContact_vendorId_idx" ON "EntityContact"("vendorId");

-- KnowledgeDocument
CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "documentType" "DocumentType" NOT NULL DEFAULT 'OTHER',
  "storageReference" TEXT,
  "extractedText" TEXT,
  "fileSize" INTEGER,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL;
CREATE INDEX "KnowledgeDocument_documentType_idx" ON "KnowledgeDocument"("workspaceId", "documentType");
CREATE INDEX "KnowledgeDocument_status_idx" ON "KnowledgeDocument"("workspaceId", "status");

-- ImportRun
CREATE TABLE "ImportRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "knowledgeDocumentId" TEXT,
  "importType" "EntityType" NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
  "rowsRead" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "errorsJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE;
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_knowledgeDocumentId_fkey" FOREIGN KEY ("knowledgeDocumentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL;
CREATE INDEX "ImportRun_importType_idx" ON "ImportRun"("workspaceId", "importType");
CREATE INDEX "ImportRun_status_idx" ON "ImportRun"("workspaceId", "status");
