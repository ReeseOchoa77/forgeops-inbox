/*
  Warnings:

  - The values [RFQ_BID_INVITE,VENDOR_QUOTE,SHIPPING_DELIVERY,RECRUITING_APPLICANT,INTERNAL_PROJECT_COMMUNICATION,ADMIN_FINANCE,MISC_NEEDS_REVIEW] on the enum `EmailType` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[workspaceId,messageId]` on the table `Classification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[workspaceId,sourceMessageId]` on the table `Task` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EmailType_new" AS ENUM ('ACTIONABLE_REQUEST', 'FYI_UPDATE', 'SALES_MARKETING', 'SUPPORT_CUSTOMER_ISSUE', 'RECRUITING_HIRING', 'INTERNAL_COORDINATION', 'NEEDS_REVIEW');
ALTER TABLE "Classification" ALTER COLUMN "emailType" TYPE "EmailType_new" USING ("emailType"::text::"EmailType_new");
ALTER TYPE "EmailType" RENAME TO "EmailType_old";
ALTER TYPE "EmailType_new" RENAME TO "EmailType";
DROP TYPE "EmailType_old";
COMMIT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "assigneeGuess" TEXT,
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "NormalizedEmail" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sender" JSONB NOT NULL,
    "recipients" JSONB NOT NULL,
    "subject" TEXT,
    "normalizedSubject" TEXT,
    "snippet" TEXT,
    "receivedAt" TIMESTAMP(3),
    "cleanTextBody" TEXT,
    "labelHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "senderDomain" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormalizedEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NormalizedEmail_workspaceId_inboxConnectionId_receivedAt_idx" ON "NormalizedEmail"("workspaceId", "inboxConnectionId", "receivedAt");

-- CreateIndex
CREATE INDEX "NormalizedEmail_workspaceId_senderDomain_idx" ON "NormalizedEmail"("workspaceId", "senderDomain");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedEmail_workspaceId_id_key" ON "NormalizedEmail"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedEmail_workspaceId_messageId_key" ON "NormalizedEmail"("workspaceId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Classification_workspaceId_messageId_key" ON "Classification"("workspaceId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workspaceId_sourceMessageId_key" ON "Task"("workspaceId", "sourceMessageId");

-- AddForeignKey
ALTER TABLE "NormalizedEmail" ADD CONSTRAINT "NormalizedEmail_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedEmail" ADD CONSTRAINT "NormalizedEmail_workspaceId_inboxConnectionId_fkey" FOREIGN KEY ("workspaceId", "inboxConnectionId") REFERENCES "InboxConnection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedEmail" ADD CONSTRAINT "NormalizedEmail_workspaceId_threadId_fkey" FOREIGN KEY ("workspaceId", "threadId") REFERENCES "EmailThread"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedEmail" ADD CONSTRAINT "NormalizedEmail_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "EmailMessage"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
