-- AlterTable
ALTER TABLE "MailboxHistoricalImport" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProjectFolderEmailAnalyzeRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "EmailMessage_workspaceId_inboxConnectionId_classificationStatus" RENAME TO "EmailMessage_workspaceId_inboxConnectionId_classificationSt_idx";

-- RenameIndex
ALTER INDEX "InlineImageRelevanceClassification_workspaceId_contentChecksum_" RENAME TO "InlineImageRelevanceClassification_workspaceId_contentCheck_idx";

-- RenameIndex
ALTER INDEX "InlineImageRelevanceClassification_workspaceId_emailAttachmentI" RENAME TO "InlineImageRelevanceClassification_workspaceId_emailAttachm_key";

-- RenameIndex
ALTER INDEX "InlineImageRelevanceClassification_workspaceId_method_corrected" RENAME TO "InlineImageRelevanceClassification_workspaceId_method_corre_idx";

-- RenameIndex
ALTER INDEX "MailboxHistoricalImport_workspaceId_inboxConnectionId_createdAt" RENAME TO "MailboxHistoricalImport_workspaceId_inboxConnectionId_creat_idx";

-- RenameIndex
ALTER INDEX "ProjectFolderEmailAnalyzeRun_workspaceId_inboxConnectionId_stat" RENAME TO "ProjectFolderEmailAnalyzeRun_workspaceId_inboxConnectionId__idx";
