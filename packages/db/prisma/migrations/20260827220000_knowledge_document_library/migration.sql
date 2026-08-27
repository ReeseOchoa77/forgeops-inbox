-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'COMPANY_UPLOAD';
ALTER TABLE "KnowledgeDocument" ADD COLUMN "linkedJobId" TEXT;
ALTER TABLE "KnowledgeDocument" ADD COLUMN "aiAnalysisStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED';
ALTER TABLE "KnowledgeDocument" ADD COLUMN "aiAnalysisJson" JSONB;

-- CreateIndex
CREATE INDEX "KnowledgeDocument_workspaceId_linkedJobId_idx" ON "KnowledgeDocument"("workspaceId", "linkedJobId");
CREATE INDEX "KnowledgeDocument_linkedJobId_idx" ON "KnowledgeDocument"("linkedJobId");

-- AddForeignKey
ALTER TABLE "KnowledgeDocument" ADD CONSTRAINT "KnowledgeDocument_linkedJobId_fkey" FOREIGN KEY ("linkedJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
