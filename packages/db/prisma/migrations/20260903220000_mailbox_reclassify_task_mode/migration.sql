-- CreateEnum
CREATE TYPE "MailboxReclassifyTaskMode" AS ENUM ('REMOVE_ONLY', 'REGENERATE');

-- AlterTable
ALTER TABLE "MailboxReclassifyRun" ADD COLUMN "taskMode" "MailboxReclassifyTaskMode" NOT NULL DEFAULT 'REMOVE_ONLY';
ALTER TABLE "MailboxReclassifyRun" ADD COLUMN "tasksRemoved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MailboxReclassifyRun" ADD COLUMN "tasksGenerated" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MailboxReclassifyRun" ADD COLUMN "taskPersistFailures" INTEGER NOT NULL DEFAULT 0;
