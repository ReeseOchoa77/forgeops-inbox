-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "InboxProvider" AS ENUM ('GMAIL');

-- CreateEnum
CREATE TYPE "InboxConnectionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR', 'REQUIRES_REAUTH', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "EmailType" AS ENUM ('RFQ_BID_INVITE', 'VENDOR_QUOTE', 'SHIPPING_DELIVERY', 'RECRUITING_APPLICANT', 'INTERNAL_PROJECT_COMMUNICATION', 'ADMIN_FINANCE', 'MISC_NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('NEW', 'NEEDS_REVIEW', 'ROUTED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewQueue" AS ENUM ('TRIAGE', 'EXTRACTION', 'ROUTING', 'QA');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RoutingRuleActionType" AS ENUM ('ASSIGN', 'SET_PRIORITY', 'SET_STATUS', 'CREATE_TASK', 'SEND_TO_REVIEW_QUEUE');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSubject" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "InboxProvider" NOT NULL DEFAULT 'GMAIL',
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "providerAccountId" TEXT,
    "status" "InboxConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "syncCursor" TEXT,
    "lastSyncStartedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncErrorAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailThread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "unifiedThreadKey" TEXT,
    "gmailThreadId" TEXT NOT NULL,
    "subject" TEXT,
    "normalizedSubject" TEXT,
    "snippet" TEXT,
    "participants" JSONB,
    "firstMessageAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "priority" "Priority",
    "itemStatus" "ItemStatus" NOT NULL DEFAULT 'NEW',
    "assignedToUserId" TEXT,
    "reviewQueue" "ReviewQueue",
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "latestClassificationConfidence" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inboxConnectionId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "subject" TEXT,
    "senderName" TEXT,
    "senderEmail" TEXT NOT NULL,
    "toAddresses" JSONB,
    "ccAddresses" JSONB,
    "bccAddresses" JSONB,
    "replyToAddresses" JSONB,
    "snippet" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "priority" "Priority",
    "itemStatus" "ItemStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,
    "emailType" "EmailType" NOT NULL,
    "priority" "Priority",
    "itemStatus" "ItemStatus",
    "summary" TEXT,
    "companyName" TEXT,
    "projectName" TEXT,
    "deadline" TIMESTAMP(3),
    "containsActionRequest" BOOLEAN NOT NULL DEFAULT false,
    "routingHints" JSONB,
    "extractedFields" JSONB,
    "confidence" DECIMAL(5,4) NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewQueue" "ReviewQueue",
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "modelName" TEXT,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceThreadId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "classificationId" TEXT,
    "assigneeUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "confidence" DECIMAL(5,4) NOT NULL,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewQueue" "ReviewQueue",
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priorityOrder" INTEGER NOT NULL DEFAULT 100,
    "stopProcessing" BOOLEAN NOT NULL DEFAULT false,
    "actionType" "RoutingRuleActionType" NOT NULL,
    "matchCriteria" JSONB NOT NULL,
    "actionConfig" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultReviewQueue" "ReviewQueue" NOT NULL DEFAULT 'TRIAGE',
    "classificationConfidenceThreshold" DECIMAL(5,4) NOT NULL DEFAULT 0.7500,
    "taskConfidenceThreshold" DECIMAL(5,4) NOT NULL DEFAULT 0.7500,
    "autoCreateTasks" BOOLEAN NOT NULL DEFAULT true,
    "autoApplyRoutingRules" BOOLEAN NOT NULL DEFAULT true,
    "archiveResolvedAfterDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_role_idx" ON "Membership"("workspaceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "InboxConnection_providerAccountId_idx" ON "InboxConnection"("providerAccountId");

-- CreateIndex
CREATE INDEX "InboxConnection_workspaceId_email_idx" ON "InboxConnection"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "InboxConnection_workspaceId_providerAccountId_idx" ON "InboxConnection"("workspaceId", "providerAccountId");

-- CreateIndex
CREATE INDEX "InboxConnection_workspaceId_provider_idx" ON "InboxConnection"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "InboxConnection_workspaceId_status_idx" ON "InboxConnection"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InboxConnection_workspaceId_id_key" ON "InboxConnection"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InboxConnection_workspaceId_provider_email_key" ON "InboxConnection"("workspaceId", "provider", "email");

-- CreateIndex
CREATE INDEX "EmailThread_gmailThreadId_idx" ON "EmailThread"("gmailThreadId");

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_gmailThreadId_idx" ON "EmailThread"("workspaceId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_unifiedThreadKey_idx" ON "EmailThread"("workspaceId", "unifiedThreadKey");

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_lastMessageAt_idx" ON "EmailThread"("workspaceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_itemStatus_lastMessageAt_idx" ON "EmailThread"("workspaceId", "itemStatus", "lastMessageAt");

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_assignedToUserId_itemStatus_idx" ON "EmailThread"("workspaceId", "assignedToUserId", "itemStatus");

-- CreateIndex
CREATE INDEX "EmailThread_workspaceId_reviewQueue_reviewStatus_idx" ON "EmailThread"("workspaceId", "reviewQueue", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "EmailThread_workspaceId_id_key" ON "EmailThread"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EmailThread_inboxConnectionId_gmailThreadId_key" ON "EmailThread"("inboxConnectionId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "EmailMessage_gmailMessageId_idx" ON "EmailMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_gmailThreadId_idx" ON "EmailMessage"("gmailThreadId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_gmailMessageId_idx" ON "EmailMessage"("workspaceId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_gmailThreadId_idx" ON "EmailMessage"("workspaceId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_sentAt_idx" ON "EmailMessage"("workspaceId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_threadId_sentAt_idx" ON "EmailMessage"("workspaceId", "threadId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_workspaceId_itemStatus_sentAt_idx" ON "EmailMessage"("workspaceId", "itemStatus", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_senderEmail_idx" ON "EmailMessage"("senderEmail");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_workspaceId_id_key" ON "EmailMessage"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_inboxConnectionId_gmailMessageId_key" ON "EmailMessage"("inboxConnectionId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "Classification_workspaceId_emailType_idx" ON "Classification"("workspaceId", "emailType");

-- CreateIndex
CREATE INDEX "Classification_workspaceId_priority_idx" ON "Classification"("workspaceId", "priority");

-- CreateIndex
CREATE INDEX "Classification_workspaceId_itemStatus_idx" ON "Classification"("workspaceId", "itemStatus");

-- CreateIndex
CREATE INDEX "Classification_workspaceId_confidence_idx" ON "Classification"("workspaceId", "confidence");

-- CreateIndex
CREATE INDEX "Classification_workspaceId_reviewQueue_reviewStatus_idx" ON "Classification"("workspaceId", "reviewQueue", "reviewStatus");

-- CreateIndex
CREATE INDEX "Classification_workspaceId_requiresReview_confidence_idx" ON "Classification"("workspaceId", "requiresReview", "confidence");

-- CreateIndex
CREATE INDEX "Classification_threadId_createdAt_idx" ON "Classification"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Classification_messageId_idx" ON "Classification"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Classification_workspaceId_id_key" ON "Classification"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "Task_workspaceId_status_dueAt_idx" ON "Task"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_workspaceId_assigneeUserId_status_idx" ON "Task"("workspaceId", "assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_priority_status_idx" ON "Task"("workspaceId", "priority", "status");

-- CreateIndex
CREATE INDEX "Task_workspaceId_confidence_idx" ON "Task"("workspaceId", "confidence");

-- CreateIndex
CREATE INDEX "Task_workspaceId_reviewQueue_reviewStatus_idx" ON "Task"("workspaceId", "reviewQueue", "reviewStatus");

-- CreateIndex
CREATE INDEX "Task_sourceThreadId_idx" ON "Task"("sourceThreadId");

-- CreateIndex
CREATE INDEX "Task_sourceMessageId_idx" ON "Task"("sourceMessageId");

-- CreateIndex
CREATE INDEX "Task_classificationId_idx" ON "Task"("classificationId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workspaceId_id_key" ON "Task"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "RoutingRule_workspaceId_enabled_priorityOrder_idx" ON "RoutingRule"("workspaceId", "enabled", "priorityOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingRule_workspaceId_id_key" ON "RoutingRule"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingRule_workspaceId_name_key" ON "RoutingRule"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSetting_workspaceId_key" ON "WorkspaceSetting"("workspaceId");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_workspaceId_entityType_entityId_idx" ON "AuditEvent"("workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxConnection" ADD CONSTRAINT "InboxConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_workspaceId_inboxConnectionId_fkey" FOREIGN KEY ("workspaceId", "inboxConnectionId") REFERENCES "InboxConnection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_workspaceId_inboxConnectionId_fkey" FOREIGN KEY ("workspaceId", "inboxConnectionId") REFERENCES "InboxConnection"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_workspaceId_threadId_fkey" FOREIGN KEY ("workspaceId", "threadId") REFERENCES "EmailThread"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_workspaceId_threadId_fkey" FOREIGN KEY ("workspaceId", "threadId") REFERENCES "EmailThread"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_workspaceId_messageId_fkey" FOREIGN KEY ("workspaceId", "messageId") REFERENCES "EmailMessage"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_sourceThreadId_fkey" FOREIGN KEY ("workspaceId", "sourceThreadId") REFERENCES "EmailThread"("workspaceId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_sourceMessageId_fkey" FOREIGN KEY ("workspaceId", "sourceMessageId") REFERENCES "EmailMessage"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_classificationId_fkey" FOREIGN KEY ("workspaceId", "classificationId") REFERENCES "Classification"("workspaceId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceSetting" ADD CONSTRAINT "WorkspaceSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
