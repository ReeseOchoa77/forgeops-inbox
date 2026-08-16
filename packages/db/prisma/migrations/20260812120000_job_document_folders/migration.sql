-- AlterEnum
ALTER TYPE "JobActivityAction" ADD VALUE 'FOLDER_CREATED';
ALTER TYPE "JobActivityAction" ADD VALUE 'FOLDER_RENAMED';
ALTER TYPE "JobActivityAction" ADD VALUE 'FOLDER_DELETED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_MOVED';
ALTER TYPE "JobActivityAction" ADD VALUE 'DOCUMENT_DELETED';

-- CreateTable
CREATE TABLE "JobDocumentFolder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDocumentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "folderId" TEXT,
    "filename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT,
    "checksum" TEXT,
    "uploadStatus" "AttachmentUploadStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobDocumentFolder_workspaceId_jobId_idx" ON "JobDocumentFolder"("workspaceId", "jobId");

-- CreateIndex
CREATE INDEX "JobDocumentFolder_jobId_parentFolderId_idx" ON "JobDocumentFolder"("jobId", "parentFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "JobDocumentFolder_jobId_parentFolderId_name_key" ON "JobDocumentFolder"("jobId", "parentFolderId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "JobFile_workspaceId_storageKey_key" ON "JobFile"("workspaceId", "storageKey");

-- CreateIndex
CREATE INDEX "JobFile_workspaceId_jobId_idx" ON "JobFile"("workspaceId", "jobId");

-- CreateIndex
CREATE INDEX "JobFile_jobId_folderId_idx" ON "JobFile"("jobId", "folderId");

-- CreateIndex
CREATE INDEX "JobFile_jobId_createdAt_idx" ON "JobFile"("jobId", "createdAt");

-- AddForeignKey
ALTER TABLE "JobDocumentFolder" ADD CONSTRAINT "JobDocumentFolder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDocumentFolder" ADD CONSTRAINT "JobDocumentFolder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDocumentFolder" ADD CONSTRAINT "JobDocumentFolder_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "JobDocumentFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFile" ADD CONSTRAINT "JobFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFile" ADD CONSTRAINT "JobFile_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFile" ADD CONSTRAINT "JobFile_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "JobDocumentFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
