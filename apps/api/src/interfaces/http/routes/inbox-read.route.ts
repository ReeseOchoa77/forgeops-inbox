import {
  Prisma,
  type EmailType
} from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { buildAuthorizationFields } from "../../../application/services/inbox-authorization-status.js";
import { mailboxCategoryFromLegacyBusinessFilter } from "../../../application/services/mailbox-category.js";
import { getSessionFromRequest } from "../authentication.js";
import { mapStoredPriorityToN8n } from "@forgeops/shared";

const DEFAULT_CONFIDENCE_THRESHOLD = new Prisma.Decimal("0.75");

const businessCategoryValues = ["BUSINESS", "NON_BUSINESS"] as const;

const emailTypeValues = [
  "ACTIONABLE_REQUEST",
  "FYI_UPDATE",
  "SALES_MARKETING",
  "SUPPORT_CUSTOMER_ISSUE",
  "RECRUITING_HIRING",
  "INTERNAL_COORDINATION",
  "NEEDS_REVIEW"
] as const;

/** Application-facing email priority (DB MEDIUM ↔ API NORMAL). */
const priorityValues = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

/** Map Prisma Priority (MEDIUM) → API vocabulary (NORMAL). */
function toApiPriority(
  priority: string | null | undefined
): (typeof priorityValues)[number] | null {
  return mapStoredPriorityToN8n(priority);
}
const itemStatusValues = [
  "NEW",
  "NEEDS_REVIEW",
  "ROUTED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "ARCHIVED"
] as const;
const taskStatusValues = [
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "DONE",
  "CANCELLED"
] as const;
const reviewQueueValues = ["TRIAGE", "EXTRACTION", "ROUTING", "QA"] as const;
const reviewStatusValues = [
  "NOT_REQUIRED",
  "PENDING",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED"
] as const;
const reviewReasonValues = [
  "message_needs_review",
  "classification_requires_review",
  "classification_low_confidence",
  "task_requires_review",
  "task_low_confidence"
] as const;

const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const booleanQueryWithDefaultFalseSchema = z
  .enum(["true", "false"])
  .optional()
  .default("false")
  .transform((value) => value === "true");

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const workspaceConnectionParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1)
});

const messageDetailParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
  messageId: z.string().min(1)
});

const threadMessagesParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
  threadId: z.string().min(1)
});

const messageCategoryValues = ["important", "spam", "trash"] as const;

const businessTypeGroupValues = ["BIDS_ESTIMATING", "PROJECTS", "PURCHASING", "ACCOUNTING", "INTERNAL", "OTHER"] as const;

const businessTypeKeysByGroup: Record<string, string[]> = {
  BIDS_ESTIMATING: ["BID_OPPORTUNITY", "BID_UPDATE", "ESTIMATE_QUOTE"],
  PROJECTS: ["PROJECT_COORDINATION", "RFI_CLARIFICATION", "SUBMITTAL_SHOP_DRAWING", "CHANGE_ORDER_SCOPE", "FABRICATION_PRODUCTION", "DELIVERY_LOGISTICS", "FIELD_INSTALLATION"],
  PURCHASING: ["PURCHASE_ORDER_CONTRACT", "MATERIAL_PURCHASING"],
  ACCOUNTING: ["INVOICE_PAYMENT"],
  INTERNAL: ["COMPLIANCE_LEGAL", "INTERNAL_ADMIN"],
  OTHER: ["OTHER_BUSINESS"]
};

const messagesListQuerySchema = paginationQuerySchema.extend({
  businessCategory: z.enum(businessCategoryValues).optional(),
  classificationType: z.enum(emailTypeValues).optional(),
  category: z.enum(messageCategoryValues).optional(),
  businessTypeGroup: z.enum(businessTypeGroupValues).optional(),
  businessTypeKey: z.string().max(50).optional(),
  jobId: z.string().min(1).optional(),
  reviewOnly: booleanQueryWithDefaultFalseSchema,
  lowConfidenceOnly: booleanQueryWithDefaultFalseSchema,
  hasTaskCandidate: booleanQuerySchema.optional(),
  reclassifiedOnly: booleanQueryWithDefaultFalseSchema,
  sentOnly: booleanQueryWithDefaultFalseSchema,
  unreadOnly: booleanQueryWithDefaultFalseSchema,
  /** When true, also run COUNT(*) and return totalCount/totalPages (not on default Inbox path). */
  includeTotal: booleanQueryWithDefaultFalseSchema,
  search: z.string().min(1).optional(),
  /** Restrict free-text search to sender name/email when "sender". Default: all fields. */
  searchIn: z.enum(["all", "sender"]).optional().default("all")
});

const jobSummarySchema = z.object({
  id: z.string(),
  jobNumber: z.string().nullable(),
  name: z.string(),
  status: z.string()
});

const tasksListQuerySchema = paginationQuerySchema.extend({
  reviewOnly: booleanQueryWithDefaultFalseSchema,
  lowConfidenceOnly: booleanQueryWithDefaultFalseSchema,
  status: z.enum(taskStatusValues).optional()
});

const reviewListQuerySchema = paginationQuerySchema;

const storedAddressSchema = z.object({
  name: z.string().nullable(),
  email: z.string().email(),
  raw: z.string().optional()
});

const normalizedParticipantSchema = z.object({
  name: z.string().nullable(),
  email: z.string().email(),
  role: z.enum(["FROM", "TO", "CC", "BCC", "REPLY_TO"])
});

const attachmentMetadataSchema = z.object({
  attachmentId: z.string().nullable(),
  contentId: z.string().nullable(),
  filename: z.string().nullable(),
  inline: z.boolean(),
  mimeType: z.string().nullable(),
  partId: z.string().nullable(),
  size: z.number().nullable()
});

const connectionSummarySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().nullable(),
  providerAccountId: z.string().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH", "DISCONNECTED"]),
  connectedAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  lastProcessedAt: z.string().datetime().nullable().optional(),
  lastReceivedAt: z.string().datetime().nullable().optional(),
  lastSyncError: z.string().nullable().optional(),
  ingestionSource: z.enum(["NATIVE", "N8N", "SHADOW"]).optional(),
  nativeListeningEnabled: z.boolean().optional(),
  listenIncoming: z.boolean().optional(),
  listenSent: z.boolean().optional(),
  excludeJunk: z.boolean().optional(),
  excludeTrash: z.boolean().optional(),
  grantedScopes: z.array(z.string().min(1)),
  authorizationStatus: z.enum(["REQUIRED", "CONNECTED", "REAUTHORIZATION_REQUIRED"]),
  capabilities: z.object({
    emailIngestion: z.boolean(),
    directProviderAccess: z.boolean(),
    attachmentIngestion: z.boolean(),
    emailSending: z.boolean(),
  }),
  counts: z.object({
    messages: z.number().int().nonnegative(),
    threads: z.number().int().nonnegative()
  })
});

const classificationSummarySchema = z.object({
  id: z.string().min(1),
  businessCategory: z.enum(businessCategoryValues).nullable(),
  emailType: z.enum(emailTypeValues),
  priority: z.enum(priorityValues).nullable(),
  itemStatus: z.enum(itemStatusValues).nullable(),
  summary: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean(),
  reviewQueue: z.enum(reviewQueueValues).nullable(),
  reviewStatus: z.enum(reviewStatusValues),
  containsActionRequest: z.boolean(),
  businessTypeKey: z.string().nullable(),
  businessTypeConfidence: z.number().nullable(),
  classificationEvidence: z.unknown().nullable().optional(),
  deadline: z.string().datetime().nullable(),
  routingHints: z.unknown().nullable().optional(),
  extractedFields: z.unknown().nullable().optional()
});

const taskSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable(),
  description: z.string().nullable().optional(),
  assigneeGuess: z.string().nullable(),
  dueAt: z.string().datetime().nullable(),
  priority: z.enum(priorityValues),
  status: z.enum(taskStatusValues),
  confidence: z.number().min(0).max(1),
  requiresReview: z.boolean(),
  reviewQueue: z.enum(reviewQueueValues).nullable(),
  reviewStatus: z.enum(reviewStatusValues),
  isPinned: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

/** Sentinel for All Mailboxes aggregate list (not a real InboxConnection id). */
export const ALL_MAILBOXES_CONNECTION_ID = "__all__";

const messageSummarySchema = z.object({
  id: z.string().min(1),
  providerMessageId: z.string().min(1),
  providerThreadId: z.string().min(1),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  senderName: z.string().nullable(),
  senderEmail: z.string().email(),
  receivedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime(),
  priority: z.enum(priorityValues).nullable(),
  itemStatus: z.enum(itemStatusValues),
  isRead: z.boolean(),
  isImportant: z.boolean(),
  isSpam: z.boolean(),
  isTrashed: z.boolean(),
  isPinned: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  mailboxCategory: z.enum(["BUSINESS", "PERSONAL", "SPAM", "TRASH"]),
  previousCategory: z.enum(["BUSINESS", "PERSONAL", "SPAM", "TRASH"]).nullable().optional(),
  /** Owning monitored mailbox — required for reply/detail when listing All Mailboxes. */
  inboxConnectionId: z.string().min(1).optional(),
  classification: classificationSummarySchema.nullable(),
  taskCandidate: taskSummarySchema.nullable(),
  job: jobSummarySchema.nullable().optional(),
  jobAssignmentSource: z.string().nullable().optional(),
  jobAssignmentIsManual: z.boolean().optional(),
  jobMatchConfidence: z.number().nullable().optional()
});

const normalizedEmailDetailSchema = z.object({
  id: z.string().min(1),
  sender: normalizedParticipantSchema,
  recipients: z.array(normalizedParticipantSchema),
  subject: z.string().nullable(),
  normalizedSubject: z.string().nullable(),
  snippet: z.string().nullable(),
  receivedAt: z.string().datetime().nullable(),
  cleanTextBody: z.string().nullable(),
  labelHints: z.array(z.string().min(1)),
  categoryHints: z.array(z.string().min(1)),
  senderDomain: z.string().nullable()
});

const messageDetailSchema = z.object({
  message: z.object({
    id: z.string().min(1),
    providerMessageId: z.string().min(1),
    providerThreadId: z.string().min(1),
    subject: z.string().nullable(),
    senderName: z.string().nullable(),
    senderEmail: z.string().email(),
    toAddresses: z.array(storedAddressSchema),
    ccAddresses: z.array(storedAddressSchema),
    bccAddresses: z.array(storedAddressSchema),
    replyToAddresses: z.array(storedAddressSchema),
    snippet: z.string().nullable(),
    bodyText: z.string().nullable(),
    bodyHtml: z.string().nullable(),
    labelIds: z.array(z.string().min(1)),
    hasAttachments: z.boolean(),
    attachmentMetadata: z.array(attachmentMetadataSchema),
    sentAt: z.string().datetime(),
    receivedAt: z.string().datetime().nullable(),
    priority: z.enum(priorityValues).nullable(),
    itemStatus: z.enum(itemStatusValues),
    mailboxCategory: z.enum(["BUSINESS", "PERSONAL", "SPAM", "TRASH"]),
    previousCategory: z.enum(["BUSINESS", "PERSONAL", "SPAM", "TRASH"]).nullable().optional()
  }),
  thread: z.object({
    id: z.string().min(1),
    providerThreadId: z.string().min(1),
    subject: z.string().nullable(),
    normalizedSubject: z.string().nullable(),
    snippet: z.string().nullable(),
    lastMessageAt: z.string().datetime().nullable(),
    messageCount: z.number().int().nonnegative(),
    reviewQueue: z.enum(reviewQueueValues).nullable(),
    reviewStatus: z.enum(reviewStatusValues)
  }),
  normalizedEmail: normalizedEmailDetailSchema.nullable(),
  classification: classificationSummarySchema.nullable(),
  taskCandidate: taskSummarySchema.nullable(),
  job: jobSummarySchema.nullable().optional(),
  jobAssignmentSource: z.string().nullable().optional(),
  jobAssignmentIsManual: z.boolean().optional(),
  jobMatchConfidence: z.number().nullable().optional()
});

const reviewItemSchema = z.object({
  message: messageSummarySchema,
  reviewReasons: z.array(z.enum(reviewReasonValues)).min(1)
});

const taskListItemSchema = z.object({
  task: taskSummarySchema,
  sourceMessage: z
    .object({
      id: z.string().min(1),
      providerMessageId: z.string().min(1),
      subject: z.string().nullable(),
      snippet: z.string().nullable(),
      senderEmail: z.string().email(),
      receivedAt: z.string().datetime().nullable()
    })
    .nullable(),
  classification: classificationSummarySchema.nullable()
});

const connectionListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  connections: z.array(connectionSummarySchema)
});

const connectionDetailResponseSchema = z.object({
  workspaceId: z.string().min(1),
  connection: connectionSummarySchema
});

const messagesListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  filters: z.object({
    classificationType: z.enum(emailTypeValues).nullable(),
    reviewOnly: z.boolean(),
    lowConfidenceOnly: z.boolean(),
    hasTaskCandidate: z.boolean().nullable()
  }),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    /** Exact total; null when includeTotal was not requested (default Inbox path). */
    totalCount: z.number().int().nonnegative().nullable(),
    totalPages: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean()
  }),
  messages: z.array(messageSummarySchema)
});

const messageDetailResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  data: messageDetailSchema
});

const reviewListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  thresholds: z.object({
    classification: z.number().min(0).max(1),
    task: z.number().min(0).max(1)
  }),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  }),
  items: z.array(reviewItemSchema)
});

const tasksListResponseSchema = z.object({
  workspaceId: z.string().min(1),
  inboxConnectionId: z.string().min(1),
  filters: z.object({
    reviewOnly: z.boolean(),
    lowConfidenceOnly: z.boolean(),
    status: z.enum(taskStatusValues).nullable()
  }),
  pagination: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  }),
  tasks: z.array(taskListItemSchema)
});

const serializeDate = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const serializeDecimal = (
  value: Prisma.Decimal | null | undefined
): number | null => (value ? Number(value.toString()) : null);

const parseStoredAddresses = (value: unknown) =>
  z.array(storedAddressSchema).parse(value ?? []);

const parseNormalizedParticipants = (value: unknown) =>
  z.array(normalizedParticipantSchema).parse(value ?? []);

const parseNormalizedSender = (value: unknown) =>
  normalizedParticipantSchema.parse(value);

const parseAttachmentMetadata = (value: unknown) =>
  z.array(attachmentMetadataSchema).parse(value ?? []);

const serializeConnection = (connection: {
  id: string;
  provider: string;
  email: string;
  displayName: string | null;
  providerAccountId: string | null;
  status: "ACTIVE" | "PAUSED" | "ERROR" | "REQUIRES_REAUTH" | "DISCONNECTED";
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  lastProcessedAt?: Date | null;
  lastReceivedAt?: Date | null;
  lastSyncError?: string | null;
  ingestionSource?: string;
  nativeListeningEnabled?: boolean;
  listenIncoming?: boolean;
  listenSent?: boolean;
  excludeJunk?: boolean;
  excludeTrash?: boolean;
  grantedScopes: string[];
  encryptedRefreshToken?: string | null;
  _count: {
    messages: number;
    threads: number;
  };
}) => {
  const auth = buildAuthorizationFields({
    provider: connection.provider,
    status: connection.status,
    hasRefreshToken: Boolean(connection.encryptedRefreshToken),
    grantedScopes: connection.grantedScopes,
  });

  return connectionSummarySchema.parse({
    id: connection.id,
    provider: connection.provider.toLowerCase(),
    email: connection.email,
    displayName: connection.displayName,
    providerAccountId: connection.providerAccountId,
    status: connection.status,
    connectedAt: serializeDate(connection.connectedAt),
    lastSyncedAt: serializeDate(connection.lastSyncedAt),
    lastProcessedAt: serializeDate(connection.lastProcessedAt ?? null),
    lastReceivedAt: serializeDate(connection.lastReceivedAt ?? null),
    lastSyncError: connection.lastSyncError ?? null,
    ingestionSource: connection.ingestionSource ?? "N8N",
    nativeListeningEnabled: connection.nativeListeningEnabled ?? false,
    listenIncoming: connection.listenIncoming ?? true,
    listenSent: connection.listenSent ?? false,
    excludeJunk: connection.excludeJunk ?? true,
    excludeTrash: connection.excludeTrash ?? true,
    grantedScopes: connection.grantedScopes,
    authorizationStatus: auth.authorizationStatus,
    capabilities: auth.capabilities,
    counts: {
      messages: connection._count.messages,
      threads: connection._count.threads
    }
  });
};

const serializeClassification = (classification: {
  id: string;
  businessCategory: (typeof businessCategoryValues)[number] | null;
  emailType: EmailType;
  priority: string | null;
  itemStatus: (typeof itemStatusValues)[number] | null;
  summary: string | null;
  confidence: Prisma.Decimal;
  requiresReview: boolean;
  reviewQueue: (typeof reviewQueueValues)[number] | null;
  reviewStatus: (typeof reviewStatusValues)[number];
  containsActionRequest: boolean;
  businessTypeKey: string | null;
  businessTypeConfidence: import("@prisma/client").Prisma.Decimal | null;
  classificationEvidence?: unknown;
  deadline: Date | null;
  routingHints?: unknown;
  extractedFields?: unknown;
} | null) =>
  classification
    ? classificationSummarySchema.parse({
        id: classification.id,
        businessCategory: classification.businessCategory,
        emailType: classification.emailType,
        priority: toApiPriority(classification.priority),
        itemStatus: classification.itemStatus,
        summary: classification.summary,
        confidence: serializeDecimal(classification.confidence),
        requiresReview: classification.requiresReview,
        reviewQueue: classification.reviewQueue,
        reviewStatus: classification.reviewStatus,
        containsActionRequest: classification.containsActionRequest,
        businessTypeKey: classification.businessTypeKey ?? null,
        businessTypeConfidence: classification.businessTypeConfidence ? Number(classification.businessTypeConfidence.toString()) : null,
        ...("classificationEvidence" in classification ? { classificationEvidence: classification.classificationEvidence ?? null } : {}),
        deadline: serializeDate(classification.deadline),
        ...("routingHints" in classification ? { routingHints: classification.routingHints ?? null } : {}),
        ...("extractedFields" in classification ? { extractedFields: classification.extractedFields ?? null } : {})
      })
    : null;

const serializeTask = (task: {
  id: string;
  title: string;
  summary: string | null;
  description?: string | null;
  assigneeGuess: string | null;
  dueAt: Date | null;
  priority: string;
  status: (typeof taskStatusValues)[number];
  confidence: Prisma.Decimal;
  requiresReview: boolean;
  reviewQueue: (typeof reviewQueueValues)[number] | null;
  reviewStatus: (typeof reviewStatusValues)[number];
  isPinned?: boolean;
  createdAt: Date;
  updatedAt: Date;
} | null) =>
  task
    ? taskSummarySchema.parse({
        id: task.id,
        title: task.title,
        summary: task.summary,
        ...("description" in task ? { description: task.description } : {}),
        assigneeGuess: task.assigneeGuess,
        dueAt: serializeDate(task.dueAt),
        priority: toApiPriority(task.priority) ?? "NORMAL",
        status: task.status,
        confidence: serializeDecimal(task.confidence),
        requiresReview: task.requiresReview,
        reviewQueue: task.reviewQueue,
        reviewStatus: task.reviewStatus,
        isPinned: task.isPinned ?? false,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString()
      })
    : null;

const serializeJobSummary = (
  job: {
    id: string;
    jobNumber: string | null;
    name: string;
    status: string;
  } | null | undefined
) =>
  job
    ? {
        id: job.id,
        jobNumber: job.jobNumber,
        name: job.name,
        status: job.status
      }
    : null;

const serializeMessageSummary = (message: {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  snippet: string | null;
  senderName: string | null;
  senderEmail: string;
  receivedAt: Date | null;
  sentAt: Date;
  priority: string | null;
  itemStatus: (typeof itemStatusValues)[number];
  isRead: boolean;
  isImportant: boolean;
  isSpam: boolean;
  isTrashed: boolean;
  isPinned?: boolean;
  hasAttachments?: boolean;
  mailboxCategory: "BUSINESS" | "PERSONAL" | "SPAM" | "TRASH";
  previousCategory?: "BUSINESS" | "PERSONAL" | "SPAM" | "TRASH" | null;
  classifications: Array<Parameters<typeof serializeClassification>[0]>;
  tasks: Array<Parameters<typeof serializeTask>[0]>;
  job?: {
    id: string;
    jobNumber: string | null;
    name: string;
    status: string;
  } | null;
  jobAssignmentSource?: string | null;
  jobAssignmentIsManual?: boolean;
  jobMatchConfidence?: number | null;
}) =>
  messageSummarySchema.parse({
    id: message.id,
    providerMessageId: message.gmailMessageId,
    providerThreadId: message.gmailThreadId,
    subject: message.subject,
    snippet: message.snippet,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    receivedAt: serializeDate(message.receivedAt),
    sentAt: message.sentAt.toISOString(),
    priority: toApiPriority(message.priority),
    itemStatus: message.itemStatus,
    isRead: message.isRead,
    isImportant: message.isImportant,
    isSpam: message.isSpam,
    isTrashed: message.isTrashed,
    isPinned: message.isPinned ?? false,
    hasAttachments: message.hasAttachments ?? false,
    mailboxCategory: message.mailboxCategory,
    previousCategory: message.previousCategory ?? null,
    classification: serializeClassification(message.classifications[0] ?? null),
    taskCandidate: serializeTask(message.tasks[0] ?? null),
    job: serializeJobSummary(message.job),
    jobAssignmentSource: message.jobAssignmentSource ?? null,
    jobAssignmentIsManual: message.jobAssignmentIsManual ?? false,
    jobMatchConfidence: message.jobMatchConfidence ?? null
  });

/**
 * Inbox list row serializer — narrow classification, no taskCandidate.
 * Satisfies messageSummarySchema with stubs for unused classification fields.
 */
const serializeInboxListMessage = (message: {
  id: string;
  inboxConnectionId?: string;
  gmailMessageId: string;
  gmailThreadId: string;
  subject: string | null;
  snippet: string | null;
  senderName: string | null;
  senderEmail: string;
  receivedAt: Date | null;
  sentAt: Date;
  priority: string | null;
  itemStatus: (typeof itemStatusValues)[number];
  isRead: boolean;
  isImportant: boolean;
  isSpam: boolean;
  isTrashed: boolean;
  isPinned?: boolean;
  hasAttachments?: boolean;
  mailboxCategory: "BUSINESS" | "PERSONAL" | "SPAM" | "TRASH";
  classifications: Array<{
    id: string;
    emailType: EmailType;
    priority: string | null;
    businessTypeKey: string | null;
  }>;
  job?: {
    id: string;
    jobNumber: string | null;
    name: string;
    status: string;
  } | null;
}) => {
  const c = message.classifications[0] ?? null;
  return messageSummarySchema.parse({
    id: message.id,
    providerMessageId: message.gmailMessageId,
    providerThreadId: message.gmailThreadId,
    subject: message.subject,
    snippet: message.snippet,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    receivedAt: serializeDate(message.receivedAt),
    sentAt: message.sentAt.toISOString(),
    priority: toApiPriority(message.priority),
    itemStatus: message.itemStatus,
    isRead: message.isRead,
    isImportant: message.isImportant,
    isSpam: message.isSpam,
    isTrashed: message.isTrashed,
    isPinned: message.isPinned ?? false,
    hasAttachments: message.hasAttachments ?? false,
    mailboxCategory: message.mailboxCategory,
    previousCategory: null,
    ...(message.inboxConnectionId
      ? { inboxConnectionId: message.inboxConnectionId }
      : {}),
    classification: c
      ? {
          id: c.id,
          businessCategory: null,
          emailType: c.emailType,
          priority: toApiPriority(c.priority),
          itemStatus: null,
          summary: null,
          confidence: 0,
          requiresReview: false,
          reviewQueue: null,
          reviewStatus: "NOT_REQUIRED",
          containsActionRequest: false,
          businessTypeKey: c.businessTypeKey,
          businessTypeConfidence: null,
          deadline: null
        }
      : null,
    taskCandidate: null,
    job: serializeJobSummary(message.job),
    jobAssignmentSource: null,
    jobAssignmentIsManual: false,
    jobMatchConfidence: null
  });
};

/** take = pageSize + 1 → hasMore without COUNT(*). */
export function paginateTakePlusOne<T>(
  rows: T[],
  pageSize: number
): { items: T[]; hasMore: boolean } {
  const hasMore = rows.length > pageSize;
  return {
    items: hasMore ? rows.slice(0, pageSize) : rows,
    hasMore
  };
}

const getWorkspaceThresholds = async (
  app: FastifyInstance,
  workspaceId: string
): Promise<{
  classificationThreshold: Prisma.Decimal;
  taskThreshold: Prisma.Decimal;
}> => {
  const setting = await app.services.prisma.workspaceSetting.findUnique({
    where: {
      workspaceId
    },
    select: {
      classificationConfidenceThreshold: true,
      taskConfidenceThreshold: true
    }
  });

  return {
    classificationThreshold:
      setting?.classificationConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    taskThreshold:
      setting?.taskConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
  };
};

const buildReviewMessageConditions = (input: {
  classificationThreshold: Prisma.Decimal;
  taskThreshold: Prisma.Decimal;
}): Prisma.EmailMessageWhereInput => ({
  OR: [
    {
      itemStatus: "NEEDS_REVIEW"
    },
    {
      classifications: {
        some: {
          OR: [
            { requiresReview: true },
            { itemStatus: "NEEDS_REVIEW" },
            { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
            { confidence: { lt: input.classificationThreshold } }
          ]
        }
      }
    },
    {
      tasks: {
        some: {
          OR: [
            { requiresReview: true },
            { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
            { confidence: { lt: input.taskThreshold } }
          ]
        }
      }
    }
  ]
});

/** Exported for unit tests — Sent + mailboxCategory filters compose independently. */
export const buildMessagesWhere = (input: {
  workspaceId: string;
  /** Single mailbox, or `{ in: [...] }` for All Mailboxes aggregate. */
  inboxConnectionId: string | { in: string[] };
  businessCategory?: (typeof businessCategoryValues)[number];
  classificationType?: EmailType;
  category?: (typeof messageCategoryValues)[number];
  businessTypeGroup?: (typeof businessTypeGroupValues)[number];
  businessTypeKey?: string;
  jobId?: string;
  reviewOnly: boolean;
  lowConfidenceOnly: boolean;
  hasTaskCandidate?: boolean;
  reclassifiedOnly?: boolean;
  sentOnly?: boolean;
  unreadOnly?: boolean;
  mailboxEmails?: string[];
  search?: string;
  searchIn?: "all" | "sender";
  classificationThreshold: Prisma.Decimal;
  taskThreshold: Prisma.Decimal;
}): Prisma.EmailMessageWhereInput => {
  const andConditions: Prisma.EmailMessageWhereInput[] = [
    {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId
    }
  ];

  if (input.category === "important") {
    andConditions.push({ isImportant: true });
  } else if (input.category === "spam") {
    andConditions.push({ isSpam: true });
  } else if (input.category === "trash") {
    andConditions.push({ isTrashed: true });
  } else {
    andConditions.push({ isTrashed: false });
  }

  // Sent = sender matches any monitored/connected inbox.
  // Sent tab: only those. All / Unread / Read: exclude them.
  {
    const monitoredEmails = (input.mailboxEmails ?? [])
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (input.sentOnly) {
      if (monitoredEmails.length > 0) {
        andConditions.push({
          OR: monitoredEmails.map((email) => ({
            senderEmail: { equals: email, mode: "insensitive" as const }
          }))
        });
      } else {
        andConditions.push({ id: "__no_monitored_inboxes__" });
      }
    } else if (monitoredEmails.length > 0) {
      andConditions.push({
        NOT: {
          OR: monitoredEmails.map((email) => ({
            senderEmail: { equals: email, mode: "insensitive" as const }
          }))
        }
      });
    }
  }

  andConditions.push({ isArchived: false });

  if (input.unreadOnly) {
    andConditions.push({ isRead: false });
  }

  if (input.jobId) {
    if (input.jobId === "unassigned") {
      andConditions.push({ jobId: null });
    } else {
      andConditions.push({ jobId: input.jobId });
    }
  }

  if (input.search) {
    const term = input.search.trim();
    if (input.searchIn === "sender") {
      andConditions.push({
        OR: [
          { senderEmail: { contains: term, mode: "insensitive" } },
          { senderName: { contains: term, mode: "insensitive" } },
        ],
      });
    } else {
      andConditions.push({
        OR: [
          { subject: { contains: term, mode: "insensitive" } },
          { senderEmail: { contains: term, mode: "insensitive" } },
          { senderName: { contains: term, mode: "insensitive" } },
          { snippet: { contains: term, mode: "insensitive" } },
          { bodyText: { contains: term, mode: "insensitive" } },
        ],
      });
    }
  }

  if (input.reclassifiedOnly) {
    andConditions.push({ previousCategory: { not: null } });
  }

  // Inbox tabs use EmailMessage.mailboxCategory as source of truth.
  // (Legacy query param is BUSINESS | NON_BUSINESS; map to mailbox categories.)
  if (input.businessCategory) {
    andConditions.push({
      mailboxCategory: mailboxCategoryFromLegacyBusinessFilter(input.businessCategory),
    });
  }

  if (input.classificationType) {
    andConditions.push({
      classifications: {
        some: {
          emailType: input.classificationType
        }
      }
    });
  }

  if (input.businessTypeKey) {
    andConditions.push({
      classifications: {
        some: {
          businessTypeKey: input.businessTypeKey
        }
      }
    });
  } else if (input.businessTypeGroup) {
    const keys = businessTypeKeysByGroup[input.businessTypeGroup];
    if (keys && keys.length > 0) {
      andConditions.push({
        classifications: {
          some: {
            businessTypeKey: { in: keys }
          }
        }
      });
    }
  }

  if (typeof input.hasTaskCandidate === "boolean") {
    andConditions.push(
      input.hasTaskCandidate
        ? {
            tasks: {
              some: {}
            }
          }
        : {
            tasks: {
              none: {}
            }
          }
    );
  }

  if (input.reviewOnly) {
    andConditions.push(
      buildReviewMessageConditions({
        classificationThreshold: input.classificationThreshold,
        taskThreshold: input.taskThreshold
      })
    );
  }

  if (input.lowConfidenceOnly) {
    andConditions.push({
      OR: [
        {
          classifications: {
            some: {
              confidence: {
                lt: input.classificationThreshold
              }
            }
          }
        },
        {
          tasks: {
            some: {
              confidence: {
                lt: input.taskThreshold
              }
            }
          }
        }
      ]
    });
  }

  return {
    AND: andConditions
  };
};

const buildTasksWhere = (input: {
  workspaceId: string;
  inboxConnectionId: string;
  reviewOnly: boolean;
  lowConfidenceOnly: boolean;
  status?: (typeof taskStatusValues)[number];
  taskThreshold: Prisma.Decimal;
}): Prisma.TaskWhereInput => {
  const andConditions: Prisma.TaskWhereInput[] = [
    {
      workspaceId: input.workspaceId,
      sourceThread: {
        inboxConnectionId: input.inboxConnectionId
      }
    }
  ];

  if (input.status) {
    andConditions.push({
      status: input.status
    });
  }

  if (input.reviewOnly) {
    andConditions.push({
      OR: [
        { requiresReview: true },
        { reviewStatus: { in: ["PENDING", "IN_REVIEW"] } },
        { confidence: { lt: input.taskThreshold } }
      ]
    });
  }

  if (input.lowConfidenceOnly) {
    andConditions.push({
      confidence: {
        lt: input.taskThreshold
      }
    });
  }

  return {
    AND: andConditions
  };
};

const buildReviewReasons = (input: {
  messageItemStatus: (typeof itemStatusValues)[number];
  classification: ReturnType<typeof serializeClassification>;
  task: ReturnType<typeof serializeTask>;
  classificationThreshold: number;
  taskThreshold: number;
}): Array<(typeof reviewReasonValues)[number]> => {
  const reasons = new Set<(typeof reviewReasonValues)[number]>();

  if (
    input.messageItemStatus === "NEEDS_REVIEW" ||
    input.classification?.itemStatus === "NEEDS_REVIEW"
  ) {
    reasons.add("message_needs_review");
  }

  if (
    input.classification?.requiresReview ||
    input.classification?.reviewStatus === "PENDING" ||
    input.classification?.reviewStatus === "IN_REVIEW"
  ) {
    reasons.add("classification_requires_review");
  }

  if (
    input.classification &&
    input.classification.confidence < input.classificationThreshold
  ) {
    reasons.add("classification_low_confidence");
  }

  if (
    input.task &&
    (input.task.requiresReview ||
      input.task.reviewStatus === "PENDING" ||
      input.task.reviewStatus === "IN_REVIEW")
  ) {
    reasons.add("task_requires_review");
  }

  if (input.task && input.task.confidence < input.taskThreshold) {
    reasons.add("task_low_confidence");
  }

  return [...reasons];
};

const sendAuthenticationRequired = (reply: FastifyReply) =>
  reply.code(401).send({
    message: "Authentication required"
  });

const sendWorkspaceAccessDenied = (reply: FastifyReply) =>
  reply.code(403).send({
    message: "Workspace access denied"
  });

const ROLE_HIERARCHY: Record<string, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4
};

const hasMinRole = (current: string, required: string): boolean =>
  (ROLE_HIERARCHY[current] ?? 0) >= (ROLE_HIERARCHY[required] ?? 99);

const loadWorkspaceSession = async (input: {
  app: FastifyInstance;
  request: FastifyRequest;
  workspaceId: string;
}) => {
  const session = await getSessionFromRequest(input.request);

  if (!session) {
    return {
      session: null,
      membership: null
    };
  }

  const membership = await requireWorkspaceMembership(
    input.app.services.prisma,
    session.userId,
    input.workspaceId
  );

  return {
    session,
    membership
  };
};

const loadWorkspaceConnection = async (input: {
  app: FastifyInstance;
  workspaceId: string;
  inboxConnectionId: string;
}) =>
  input.app.services.prisma.inboxConnection.findFirst({
    where: {
      id: input.inboxConnectionId,
      workspaceId: input.workspaceId
    },
    select: {
      id: true,
      provider: true,
      email: true,
      displayName: true,
      providerAccountId: true,
      status: true,
      connectedAt: true,
      lastSyncedAt: true,
      lastProcessedAt: true,
      lastReceivedAt: true,
      lastSyncError: true,
      ingestionSource: true,
      nativeListeningEnabled: true,
      listenIncoming: true,
      listenSent: true,
      excludeJunk: true,
      excludeTrash: true,
      grantedScopes: true,
      encryptedRefreshToken: true,
      _count: {
        select: {
          messages: true,
          threads: true
        }
      }
    }
  });

export const registerInboxReadRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get("/api/v1/workspaces/:workspaceId/inbox-connections", async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const { session, membership } = await loadWorkspaceSession({
      app,
      request,
      workspaceId: params.workspaceId
    });

    if (!session) {
      return sendAuthenticationRequired(reply);
    }

    if (!membership) {
      return sendWorkspaceAccessDenied(reply);
    }

    const connections = await app.services.prisma.inboxConnection.findMany({
      where: {
        workspaceId: params.workspaceId
      },
      orderBy: [
        {
          connectedAt: "desc"
        },
        {
          createdAt: "desc"
        }
      ],
      select: {
        id: true,
        provider: true,
        email: true,
        displayName: true,
        providerAccountId: true,
        status: true,
        connectedAt: true,
        lastSyncedAt: true,
        lastProcessedAt: true,
        lastReceivedAt: true,
        lastSyncError: true,
        ingestionSource: true,
        nativeListeningEnabled: true,
        listenIncoming: true,
        listenSent: true,
        excludeJunk: true,
        excludeTrash: true,
        grantedScopes: true,
        encryptedRefreshToken: true,
        _count: {
          select: {
            messages: true,
            threads: true
          }
        }
      }
    });

    app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "WORKSPACE",
      entityId: params.workspaceId,
      action: "workspace.inbox_connections_viewed",
      metadata: {
        count: connections.length
      },
      request
    }).catch(() => {});

    return reply.send(
      connectionListResponseSchema.parse({
        workspaceId: params.workspaceId,
        connections: connections.map(serializeConnection)
      })
    );
  });

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: connection.id,
        action: "inbox_connection.viewed",
        request
      }).catch(() => {});

      return reply.send(
        connectionDetailResponseSchema.parse({
          workspaceId: params.workspaceId,
          connection: serializeConnection(connection)
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages",
    async (request, reply) => {
      const t0 = performance.now();
      const timings: Record<string, number> = {};

      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = messagesListQuerySchema.parse(request.query);

      const tSession0 = performance.now();
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });
      timings.sessionMs = Math.round(performance.now() - tSession0);

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      // List path: no _count.messages/threads (those belong on connection detail/list).
      const isAllMailboxes = params.id === ALL_MAILBOXES_CONNECTION_ID;
      const tConn0 = performance.now();
      const connections = isAllMailboxes
        ? await app.services.prisma.inboxConnection.findMany({
            where: {
              workspaceId: params.workspaceId,
              status: { in: ["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH"] }
            },
            select: {
              id: true,
              email: true,
              status: true
            }
          })
        : await app.services.prisma.inboxConnection
            .findFirst({
              where: {
                id: params.id,
                workspaceId: params.workspaceId
              },
              select: {
                id: true,
                email: true,
                status: true
              }
            })
            .then((c) => (c ? [c] : []));
      timings.connectionMs = Math.round(performance.now() - tConn0);

      if (connections.length === 0) {
        return reply.code(404).send({
          message: isAllMailboxes
            ? "No inbox connections found"
            : "Inbox connection not found"
        });
      }

      const connectionIds = connections.map((c) => c.id);

      // Personal visibility: VIEWER/MEMBER only see personal from their own mailbox.
      // All Mailboxes aggregates BUSINESS by default; PERSONAL across others is denied for non-admin
      // (return empty) unless every requested connection is the user's own mailbox.
      const isPersonalRequest = query.businessCategory === "NON_BUSINESS";
      const userRole = membership.role;
      let scopedConnectionIds = connectionIds;
      if (isPersonalRequest && !hasMinRole(userRole, "ADMIN")) {
        const user = await app.services.prisma.user.findUnique({
          where: { id: session.userId },
          select: { email: true }
        });
        const userEmail = user?.email?.toLowerCase() ?? "";
        const allowed = connections.filter(
          (c) => c.email.toLowerCase() === userEmail
        );
        if (allowed.length === 0) {
          return reply.send(
            messagesListResponseSchema.parse({
              workspaceId: params.workspaceId,
              inboxConnectionId: params.id,
              filters: {
                classificationType: query.classificationType ?? null,
                reviewOnly: query.reviewOnly,
                lowConfidenceOnly: query.lowConfidenceOnly,
                hasTaskCandidate: query.hasTaskCandidate ?? null
              },
              pagination: {
                page: 1,
                pageSize: query.pageSize,
                totalCount: 0,
                totalPages: 0,
                hasMore: false
              },
              messages: []
            })
          );
        }
        scopedConnectionIds = allowed.map((c) => c.id);
      }

      // All Mailboxes without an explicit category: force BUSINESS so personal is not leaked.
      const effectiveBusinessCategory =
        query.businessCategory ??
        (isAllMailboxes ? ("BUSINESS" as const) : undefined);

      const needsThresholds = query.reviewOnly || query.lowConfidenceOnly;
      let thresholds = {
        classificationThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        taskThreshold: DEFAULT_CONFIDENCE_THRESHOLD
      };
      if (needsThresholds) {
        const tThresh0 = performance.now();
        thresholds = await getWorkspaceThresholds(app, params.workspaceId);
        timings.thresholdsMs = Math.round(performance.now() - tThresh0);
      } else {
        timings.thresholdsMs = 0;
      }

      const tMonitored0 = performance.now();
      const monitored = await app.services.prisma.inboxConnection.findMany({
        where: {
          workspaceId: params.workspaceId,
          status: { in: ["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH"] }
        },
        select: { email: true }
      });
      timings.monitoredMs = Math.round(performance.now() - tMonitored0);
      const monitoredInboxEmails = monitored.map((c) => c.email);

      const where = buildMessagesWhere({
        workspaceId: params.workspaceId,
        inboxConnectionId: isAllMailboxes
          ? { in: scopedConnectionIds }
          : scopedConnectionIds[0]!,
        ...(effectiveBusinessCategory
          ? { businessCategory: effectiveBusinessCategory }
          : {}),
        ...(query.classificationType
          ? { classificationType: query.classificationType }
          : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.businessTypeGroup ? { businessTypeGroup: query.businessTypeGroup } : {}),
        ...(query.businessTypeKey ? { businessTypeKey: query.businessTypeKey } : {}),
        ...(query.jobId ? { jobId: query.jobId } : {}),
        reviewOnly: query.reviewOnly,
        lowConfidenceOnly: query.lowConfidenceOnly,
        ...(typeof query.hasTaskCandidate === "boolean"
          ? { hasTaskCandidate: query.hasTaskCandidate }
          : {}),
        ...(query.search ? { search: query.search } : {}),
        searchIn: query.searchIn,
        reclassifiedOnly: query.reclassifiedOnly,
        sentOnly: query.sentOnly,
        unreadOnly: query.unreadOnly,
        mailboxEmails: monitoredInboxEmails,
        classificationThreshold: thresholds.classificationThreshold,
        taskThreshold: thresholds.taskThreshold
      });
      const skip = (query.page - 1) * query.pageSize;

      const tFind0 = performance.now();
      const rawRows = await app.services.prisma.emailMessage.findMany({
        where,
        orderBy: [
          { isPinned: "desc" },
          { pinnedAt: { sort: "desc", nulls: "last" } },
          { receivedAt: "desc" },
          { sentAt: "desc" },
          { createdAt: "desc" }
        ],
        skip,
        take: query.pageSize + 1,
        select: {
          id: true,
          inboxConnectionId: true,
          gmailMessageId: true,
          gmailThreadId: true,
          subject: true,
          snippet: true,
          senderName: true,
          senderEmail: true,
          receivedAt: true,
          sentAt: true,
          priority: true,
          itemStatus: true,
          isRead: true,
          isImportant: true,
          isSpam: true,
          isTrashed: true,
          isPinned: true,
          hasAttachments: true,
          mailboxCategory: true,
          job: {
            select: {
              id: true,
              jobNumber: true,
              name: true,
              status: true
            }
          },
          classifications: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1,
            select: {
              id: true,
              emailType: true,
              priority: true,
              businessTypeKey: true
            }
          }
        }
      });
      timings.findManyMs = Math.round(performance.now() - tFind0);

      const { items: pageRows, hasMore } = paginateTakePlusOne(
        rawRows,
        query.pageSize
      );

      let totalCount: number | null = null;
      let totalPages: number | null = null;
      if (query.includeTotal) {
        const tCount0 = performance.now();
        totalCount = await app.services.prisma.emailMessage.count({ where });
        timings.countMs = Math.round(performance.now() - tCount0);
        totalPages =
          totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize);
      } else {
        timings.countMs = 0;
      }

      const tSer0 = performance.now();
      const messages = pageRows.map(serializeInboxListMessage);
      const payload = messagesListResponseSchema.parse({
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        filters: {
          classificationType: query.classificationType ?? null,
          reviewOnly: query.reviewOnly,
          lowConfidenceOnly: query.lowConfidenceOnly,
          hasTaskCandidate: query.hasTaskCandidate ?? null
        },
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount,
          totalPages,
          hasMore
        },
        messages
      });
      timings.serializationMs = Math.round(performance.now() - tSer0);

      const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
      const totalMs = Math.round(performance.now() - t0);

      request.log.info({
        event: "inbox-list-performance",
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        totalMs,
        prismaMs:
          (timings.sessionMs ?? 0) +
          (timings.connectionMs ?? 0) +
          (timings.thresholdsMs ?? 0) +
          (timings.monitoredMs ?? 0) +
          (timings.findManyMs ?? 0) +
          (timings.countMs ?? 0),
        serializationMs: timings.serializationMs,
        resultCount: messages.length,
        pageSize: query.pageSize,
        page: query.page,
        payloadBytes,
        hasMore,
        includeTotal: query.includeTotal,
        stages: timings
      });

      app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.messages_viewed",
        metadata: {
          filters: {
            classificationType: query.classificationType ?? null,
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            hasTaskCandidate: query.hasTaskCandidate ?? null
          },
          page: query.page,
          pageSize: query.pageSize
        },
        request
      }).catch(() => {});

      return reply.send(payload);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId",
    async (request, reply) => {
      const params = messageDetailParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [
            {
              id: params.messageId
            },
            {
              gmailMessageId: params.messageId
            }
          ]
        },
        select: {
          id: true,
          gmailMessageId: true,
          gmailThreadId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          toAddresses: true,
          ccAddresses: true,
          bccAddresses: true,
          replyToAddresses: true,
          snippet: true,
          bodyText: true,
          bodyHtml: true,
          labelIds: true,
          hasAttachments: true,
          attachmentMetadata: true,
          sentAt: true,
          receivedAt: true,
          priority: true,
          itemStatus: true,
          mailboxCategory: true,
          previousCategory: true,
          jobAssignmentSource: true,
          jobAssignmentIsManual: true,
          jobMatchConfidence: true,
          job: {
            select: {
              id: true,
              jobNumber: true,
              name: true,
              status: true
            }
          },
          thread: {
            select: {
              id: true,
              gmailThreadId: true,
              subject: true,
              normalizedSubject: true,
              snippet: true,
              lastMessageAt: true,
              messageCount: true,
              reviewQueue: true,
              reviewStatus: true
            }
          },
          normalizedEmail: {
            select: {
              id: true,
              sender: true,
              recipients: true,
              subject: true,
              normalizedSubject: true,
              snippet: true,
              receivedAt: true,
              cleanTextBody: true,
              labelHints: true,
              categoryHints: true,
              senderDomain: true
            }
          },
          classifications: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1,
            select: {
              id: true,
              businessCategory: true,
              emailType: true,
              priority: true,
              itemStatus: true,
              summary: true,
              confidence: true,
              requiresReview: true,
              reviewQueue: true,
              reviewStatus: true,
              containsActionRequest: true,
              businessTypeKey: true,
              businessTypeConfidence: true,
              classificationEvidence: true,
              deadline: true,
              routingHints: true,
              extractedFields: true
            }
          },
          tasks: {
            orderBy: {
              createdAt: "desc"
            },
            take: 1,
            select: {
              id: true,
              title: true,
              summary: true,
              description: true,
              assigneeGuess: true,
              dueAt: true,
              priority: true,
              status: true,
              confidence: true,
              requiresReview: true,
              reviewQueue: true,
              reviewStatus: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      });

      if (!message) {
        return reply.code(404).send({
          message: "Message not found"
        });
      }

      app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "EMAIL_MESSAGE",
        entityId: message.id,
        action: "email_message.viewed",
        request
      }).catch(() => {});

      return reply.send(
        messageDetailResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          data: {
            message: {
              id: message.id,
              providerMessageId: message.gmailMessageId,
              providerThreadId: message.gmailThreadId,
              subject: message.subject,
              senderName: message.senderName,
              senderEmail: message.senderEmail,
              toAddresses: parseStoredAddresses(message.toAddresses),
              ccAddresses: parseStoredAddresses(message.ccAddresses),
              bccAddresses: parseStoredAddresses(message.bccAddresses),
              replyToAddresses: parseStoredAddresses(message.replyToAddresses),
              snippet: message.snippet,
              bodyText: message.bodyText,
              bodyHtml: message.bodyHtml ?? null,
              labelIds: message.labelIds,
              hasAttachments: message.hasAttachments,
              attachmentMetadata: parseAttachmentMetadata(message.attachmentMetadata),
              sentAt: message.sentAt.toISOString(),
              receivedAt: serializeDate(message.receivedAt),
              priority: toApiPriority(message.priority),
              itemStatus: message.itemStatus,
              mailboxCategory: message.mailboxCategory,
              previousCategory: message.previousCategory ?? null
            },
            thread: {
              id: message.thread.id,
              providerThreadId: message.thread.gmailThreadId,
              subject: message.thread.subject,
              normalizedSubject: message.thread.normalizedSubject,
              snippet: message.thread.snippet,
              lastMessageAt: serializeDate(message.thread.lastMessageAt),
              messageCount: message.thread.messageCount,
              reviewQueue: message.thread.reviewQueue,
              reviewStatus: message.thread.reviewStatus
            },
            normalizedEmail: message.normalizedEmail
              ? {
                  id: message.normalizedEmail.id,
                  sender: parseNormalizedSender(message.normalizedEmail.sender),
                  recipients: parseNormalizedParticipants(
                    message.normalizedEmail.recipients
                  ),
                  subject: message.normalizedEmail.subject,
                  normalizedSubject: message.normalizedEmail.normalizedSubject,
                  snippet: message.normalizedEmail.snippet,
                  receivedAt: serializeDate(message.normalizedEmail.receivedAt),
                  cleanTextBody: message.normalizedEmail.cleanTextBody,
                  labelHints: message.normalizedEmail.labelHints,
                  categoryHints: message.normalizedEmail.categoryHints,
                  senderDomain: message.normalizedEmail.senderDomain
                }
              : null,
            classification: serializeClassification(message.classifications[0] ?? null),
            taskCandidate: serializeTask(message.tasks[0] ?? null),
            job: serializeJobSummary(message.job),
            jobAssignmentSource: message.jobAssignmentSource ?? null,
            jobAssignmentIsManual: message.jobAssignmentIsManual,
            jobMatchConfidence: message.jobMatchConfidence ?? null
          }
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/threads/:threadId/messages",
    async (request, reply) => {
      const params = threadMessagesParamsSchema.parse(request.params);
      const expandQuery = z.object({ expandAll: z.enum(["true", "false"]).optional().transform(v => v === "true") }).parse(request.query);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const thread = await app.services.prisma.emailThread.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          id: params.threadId
        },
        select: {
          id: true,
          gmailThreadId: true,
          subject: true,
          normalizedSubject: true,
          messageCount: true
        }
      });

      if (!thread) {
        return reply.code(404).send({ message: "Thread not found" });
      }

      const messages = await app.services.prisma.emailMessage.findMany({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          threadId: params.threadId
        },
        orderBy: [{ sentAt: "asc" }, { receivedAt: "asc" }],
        select: {
          id: true,
          gmailMessageId: true,
          gmailThreadId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          toAddresses: true,
          ccAddresses: true,
          bccAddresses: true,
          replyToAddresses: true,
          snippet: true,
          bodyText: true,
          bodyHtml: true,
          labelIds: true,
          hasAttachments: true,
          attachmentMetadata: true,
          sentAt: true,
          receivedAt: true,
          priority: true,
          itemStatus: true,
          mailboxCategory: true,
          previousCategory: true,
          jobAssignmentSource: true,
          jobAssignmentIsManual: true,
          jobMatchConfidence: true,
          job: {
            select: {
              id: true,
              jobNumber: true,
              name: true,
              status: true
            }
          },
          classifications: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              businessCategory: true,
              emailType: true,
              priority: true,
              itemStatus: true,
              summary: true,
              confidence: true,
              requiresReview: true,
              reviewQueue: true,
              reviewStatus: true,
              containsActionRequest: true,
              businessTypeKey: true,
              businessTypeConfidence: true,
              deadline: true
            }
          },
          tasks: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              title: true,
              summary: true,
              assigneeGuess: true,
              dueAt: true,
              priority: true,
              status: true,
              confidence: true,
              requiresReview: true,
              reviewQueue: true,
              reviewStatus: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      });

      const BODY_TAIL_COUNT = 5;
      const bodyStartIndex = expandQuery.expandAll ? 0 : Math.max(0, messages.length - BODY_TAIL_COUNT);

      return reply.send({
        thread: {
          id: thread.id,
          providerThreadId: thread.gmailThreadId,
          subject: thread.subject,
          normalizedSubject: thread.normalizedSubject,
          messageCount: thread.messageCount
        },
        messages: messages.map((m, idx) => ({
          id: m.id,
          providerMessageId: m.gmailMessageId,
          providerThreadId: m.gmailThreadId,
          subject: m.subject,
          senderName: m.senderName,
          senderEmail: m.senderEmail,
          toAddresses: parseStoredAddresses(m.toAddresses),
          ccAddresses: parseStoredAddresses(m.ccAddresses),
          bccAddresses: parseStoredAddresses(m.bccAddresses),
          replyToAddresses: parseStoredAddresses(m.replyToAddresses),
          snippet: m.snippet,
          bodyText: idx >= bodyStartIndex ? m.bodyText : null,
          bodyHtml: idx >= bodyStartIndex ? (m.bodyHtml ?? null) : null,
          bodyTruncated: idx < bodyStartIndex,
          labelIds: m.labelIds,
          hasAttachments: m.hasAttachments,
          attachmentMetadata: parseAttachmentMetadata(m.attachmentMetadata),
          sentAt: m.sentAt.toISOString(),
          receivedAt: serializeDate(m.receivedAt),
          priority: toApiPriority(m.priority),
          itemStatus: m.itemStatus,
          mailboxCategory: m.mailboxCategory,
          previousCategory: m.previousCategory ?? null,
          jobAssignmentSource: m.jobAssignmentSource,
          jobAssignmentIsManual: m.jobAssignmentIsManual ?? false,
          jobMatchConfidence: m.jobMatchConfidence,
          job: m.job ? { id: m.job.id, jobNumber: m.job.jobNumber, name: m.job.name, status: m.job.status } : null,
          classification: serializeClassification(m.classifications[0] ?? null),
          taskCandidate: serializeTask(m.tasks[0] ?? null)
        }))
      });
    }
  );

  // Single-call thread loader: resolves thread from messageId, avoids fetching bodies for truncated messages
  const messageThreadParamsSchema = z.object({
    workspaceId: z.string().min(1),
    id: z.string().min(1),
    messageId: z.string().min(1)
  });

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId/thread",
    async (request, reply) => {
      const t0 = performance.now();
      const params = messageThreadParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);
      const tAuth = performance.now();

      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }]
        },
        select: { id: true, threadId: true }
      });

      if (!message?.threadId) {
        return reply.code(404).send({ message: "Message or thread not found" });
      }
      const tMsgLookup = performance.now();

      const thread = await app.services.prisma.emailThread.findFirst({
        where: { id: message.threadId, workspaceId: params.workspaceId },
        select: { id: true, gmailThreadId: true, subject: true, normalizedSubject: true, messageCount: true }
      });

      if (!thread) {
        return reply.code(404).send({ message: "Thread not found" });
      }
      const tThreadLookup = performance.now();

      const messageHeaders = await app.services.prisma.emailMessage.findMany({
        where: { workspaceId: params.workspaceId, inboxConnectionId: params.id, threadId: thread.id },
        orderBy: [{ sentAt: "asc" }, { receivedAt: "asc" }],
        select: {
          id: true,
          gmailMessageId: true,
          gmailThreadId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          toAddresses: true,
          ccAddresses: true,
          bccAddresses: true,
          replyToAddresses: true,
          snippet: true,
          labelIds: true,
          hasAttachments: true,
          attachmentMetadata: true,
          sentAt: true,
          receivedAt: true,
          priority: true,
          itemStatus: true,
          mailboxCategory: true,
          previousCategory: true,
          jobAssignmentSource: true,
          jobAssignmentIsManual: true,
          jobMatchConfidence: true,
          job: { select: { id: true, jobNumber: true, name: true, status: true } },
          classifications: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true, businessCategory: true, emailType: true, priority: true,
              itemStatus: true, summary: true, confidence: true, requiresReview: true,
              reviewQueue: true, reviewStatus: true, containsActionRequest: true,
              businessTypeKey: true, businessTypeConfidence: true, deadline: true
            }
          },
          tasks: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true, title: true, summary: true, assigneeGuess: true,
              dueAt: true, priority: true, status: true, confidence: true,
              requiresReview: true, reviewQueue: true, reviewStatus: true,
              createdAt: true, updatedAt: true
            }
          }
        }
      });
      const tHeaders = performance.now();

      const BODY_OPEN_IDS = new Set<string>([
        message.id,
        ...(messageHeaders.length > 0
          ? [messageHeaders[messageHeaders.length - 1]!.id]
          : []),
      ]);
      const bodyIds = [...BODY_OPEN_IDS];
      const bodies = bodyIds.length > 0
        ? await app.services.prisma.emailMessage.findMany({
            where: { id: { in: bodyIds } },
            select: { id: true, bodyText: true, bodyHtml: true }
          })
        : [];
      const bodyMap = new Map(bodies.map(b => [b.id, b]));
      const tBodies = performance.now();

      const responsePayload = {
        thread: {
          id: thread.id,
          providerThreadId: thread.gmailThreadId,
          subject: thread.subject,
          normalizedSubject: thread.normalizedSubject,
          messageCount: thread.messageCount
        },
        messages: messageHeaders.map(m => {
          const body = bodyMap.get(m.id);
          return {
            id: m.id,
            providerMessageId: m.gmailMessageId,
            providerThreadId: m.gmailThreadId,
            subject: m.subject,
            senderName: m.senderName,
            senderEmail: m.senderEmail,
            toAddresses: parseStoredAddresses(m.toAddresses),
            ccAddresses: parseStoredAddresses(m.ccAddresses),
            bccAddresses: parseStoredAddresses(m.bccAddresses),
            replyToAddresses: parseStoredAddresses(m.replyToAddresses),
            snippet: m.snippet,
            bodyText: body?.bodyText ?? null,
            bodyHtml: body?.bodyHtml ?? null,
            bodyTruncated: !body,
            labelIds: m.labelIds,
            hasAttachments: m.hasAttachments,
            attachmentMetadata: parseAttachmentMetadata(m.attachmentMetadata),
            sentAt: m.sentAt.toISOString(),
            receivedAt: serializeDate(m.receivedAt),
            priority: toApiPriority(m.priority),
            itemStatus: m.itemStatus,
            mailboxCategory: m.mailboxCategory,
            previousCategory: m.previousCategory ?? null,
            jobAssignmentSource: m.jobAssignmentSource,
            jobAssignmentIsManual: m.jobAssignmentIsManual ?? false,
            jobMatchConfidence: m.jobMatchConfidence,
            job: m.job ? { id: m.job.id, jobNumber: m.job.jobNumber, name: m.job.name, status: m.job.status } : null,
            classification: serializeClassification(m.classifications[0] ?? null),
            taskCandidate: serializeTask(m.tasks[0] ?? null)
          };
        })
      };
      const payloadJson = JSON.stringify(responsePayload);
      const payloadBytes = Buffer.byteLength(payloadJson, "utf8");
      const tSerialize = performance.now();

      const timing = {
        auth: +(tAuth - t0).toFixed(1),
        msgLookup: +(tMsgLookup - tAuth).toFixed(1),
        threadLookup: +(tThreadLookup - tMsgLookup).toFixed(1),
        headers: +(tHeaders - tThreadLookup).toFixed(1),
        bodies: +(tBodies - tHeaders).toFixed(1),
        serialize: +(tSerialize - tBodies).toFixed(1),
        total: +(tSerialize - t0).toFixed(1)
      };

      reply.header('Server-Timing', [
        `auth;dur=${timing.auth}`,
        `msgLookup;dur=${timing.msgLookup}`,
        `threadLookup;dur=${timing.threadLookup}`,
        `headers;dur=${timing.headers}`,
        `bodies;dur=${timing.bodies}`,
        `serialize;dur=${timing.serialize}`,
        `total;dur=${timing.total}`
      ].join(', '));

      request.log.info({
        event: 'thread_load_timing',
        messageId: params.messageId,
        threadId: thread.id,
        threadMessageCount: messageHeaders.length,
        bodyCount: bodyIds.length,
        attachmentMetaCount: messageHeaders.reduce(
          (n, m) => n + parseAttachmentMetadata(m.attachmentMetadata).length,
          0
        ),
        payloadBytes,
        timing,
        totalMs: timing.total,
        dbMs: +(
          timing.msgLookup +
          timing.threadLookup +
          timing.headers +
          timing.bodies
        ).toFixed(1),
        serializationMs: timing.serialize,
      });

      return reply.send(responsePayload);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/review",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = reviewListQuerySchema.parse(request.query);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({
          message: "Review queue requires Admin or Owner role"
        });
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const thresholds = await getWorkspaceThresholds(app, params.workspaceId);
      const where: Prisma.EmailMessageWhereInput = {
        AND: [
          {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.id
          },
          buildReviewMessageConditions({
            classificationThreshold: thresholds.classificationThreshold,
            taskThreshold: thresholds.taskThreshold
          })
        ]
      };
      const skip = (query.page - 1) * query.pageSize;

      const [totalCount, messages] = await Promise.all([
        app.services.prisma.emailMessage.count({
          where
        }),
        app.services.prisma.emailMessage.findMany({
          where,
          orderBy: [
            { receivedAt: "desc" },
            { sentAt: "desc" },
            { createdAt: "desc" }
          ],
          skip,
          take: query.pageSize,
          select: {
            id: true,
            gmailMessageId: true,
            gmailThreadId: true,
            subject: true,
            snippet: true,
            senderName: true,
            senderEmail: true,
            receivedAt: true,
            sentAt: true,
            priority: true,
            itemStatus: true,
            isRead: true,
            isImportant: true,
            isSpam: true,
            isTrashed: true,
            mailboxCategory: true,
            previousCategory: true,
            jobAssignmentSource: true,
            jobAssignmentIsManual: true,
            jobMatchConfidence: true,
            job: {
              select: {
                id: true,
                jobNumber: true,
                name: true,
                status: true
              }
            },
            classifications: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                businessCategory: true,
                emailType: true,
                priority: true,
                itemStatus: true,
                summary: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                containsActionRequest: true,
                businessTypeKey: true,
                businessTypeConfidence: true,
              classificationEvidence: true,
                deadline: true,
                routingHints: true,
                extractedFields: true
              }
            },
            tasks: {
              orderBy: {
                createdAt: "desc"
              },
              take: 1,
              select: {
                id: true,
                title: true,
                summary: true,
                description: true,
                assigneeGuess: true,
                dueAt: true,
                priority: true,
                status: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        })
      ]);

      const classificationThreshold = Number(
        thresholds.classificationThreshold.toString()
      );
      const taskThreshold = Number(thresholds.taskThreshold.toString());
      const items = messages.map((message) => {
        const summary = serializeMessageSummary(message);
        const reviewReasons = buildReviewReasons({
          messageItemStatus: message.itemStatus,
          classification: summary.classification,
          task: summary.taskCandidate,
          classificationThreshold,
          taskThreshold
        });

        return reviewItemSchema.parse({
          message: summary,
          reviewReasons
        });
      });

      app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.review_queue_viewed",
        metadata: {
          page: query.page,
          pageSize: query.pageSize,
          totalCount
        },
        request
      }).catch(() => {});

      return reply.send(
        reviewListResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          thresholds: {
            classification: classificationThreshold,
            task: taskThreshold
          },
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize)
          },
          items
        })
      );
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/tasks",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const query = tasksListQuerySchema.parse(request.query);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) {
        return sendAuthenticationRequired(reply);
      }

      if (!membership) {
        return sendWorkspaceAccessDenied(reply);
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const thresholds = await getWorkspaceThresholds(app, params.workspaceId);
      const where = buildTasksWhere({
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        reviewOnly: query.reviewOnly,
        lowConfidenceOnly: query.lowConfidenceOnly,
        ...(query.status ? { status: query.status } : {}),
        taskThreshold: thresholds.taskThreshold
      });
      const skip = (query.page - 1) * query.pageSize;

      const [totalCount, tasks] = await Promise.all([
        app.services.prisma.task.count({
          where
        }),
        app.services.prisma.task.findMany({
          where,
          orderBy: [
            { isPinned: "desc" },
            { pinnedAt: { sort: "desc", nulls: "last" } },
            { createdAt: "desc" },
            { updatedAt: "desc" }
          ],
          skip,
          take: query.pageSize,
          select: {
            id: true,
            title: true,
            summary: true,
            assigneeGuess: true,
            dueAt: true,
            priority: true,
            status: true,
            confidence: true,
            requiresReview: true,
            reviewQueue: true,
            reviewStatus: true,
            isPinned: true,
            createdAt: true,
            updatedAt: true,
            sourceMessage: {
              select: {
                id: true,
                gmailMessageId: true,
                subject: true,
                snippet: true,
                senderEmail: true,
                receivedAt: true
              }
            },
            classification: {
              select: {
                id: true,
                businessCategory: true,
                emailType: true,
                priority: true,
                itemStatus: true,
                summary: true,
                confidence: true,
                requiresReview: true,
                reviewQueue: true,
                reviewStatus: true,
                containsActionRequest: true,
                businessTypeKey: true,
                businessTypeConfidence: true,
                deadline: true,
              }
            }
          }
        })
      ]);

      app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: params.id,
        action: "inbox_connection.tasks_viewed",
        metadata: {
          filters: {
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            status: query.status ?? null
          },
          page: query.page,
          pageSize: query.pageSize
        },
        request
      }).catch(() => {});

      return reply.send(
        tasksListResponseSchema.parse({
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          filters: {
            reviewOnly: query.reviewOnly,
            lowConfidenceOnly: query.lowConfidenceOnly,
            status: query.status ?? null
          },
          pagination: {
            page: query.page,
            pageSize: query.pageSize,
            totalCount,
            totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize)
          },
          tasks: tasks.map((task) =>
            taskListItemSchema.parse({
              task: serializeTask(task),
              sourceMessage: task.sourceMessage
                ? {
                    id: task.sourceMessage.id,
                    providerMessageId: task.sourceMessage.gmailMessageId,
                    subject: task.sourceMessage.subject,
                    snippet: task.sourceMessage.snippet,
                    senderEmail: task.sourceMessage.senderEmail,
                    receivedAt: serializeDate(task.sourceMessage.receivedAt)
                  }
                : null,
              classification: serializeClassification(task.classification)
            })
          )
        })
      );
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId/read",
    async (request, reply) => {
      const params = messageDetailParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);

      const existing = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }]
        },
        select: { id: true, isRead: true }
      });
      if (!existing) {
        return reply.code(404).send({ message: "Message not found" });
      }

      if (!existing.isRead) {
        await app.services.prisma.emailMessage.update({
          where: { id: existing.id },
          data: { isRead: true }
        });
        app.log.info({
          event: "message-read-change",
          messageId: existing.id,
          source: "USER_OPEN",
          previous: false,
          next: true,
        });
      }

      return reply.send({ status: "ok" });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/trash-personal",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const body = z.object({
        search: z.string().min(1).optional(),
        messageIds: z.array(z.string().min(1)).max(500).optional()
      }).parse(request.body ?? {});

      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);
      if (!hasMinRole(membership.role, "MEMBER")) {
        return reply.code(403).send({ message: "Member permission required" });
      }

      const connection = await loadWorkspaceConnection({
        app,
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id
      });
      if (!connection) {
        return reply.code(404).send({ message: "Inbox connection not found" });
      }

      if (!hasMinRole(membership.role, "ADMIN")) {
        const user = await app.services.prisma.user.findUnique({
          where: { id: session.userId },
          select: { email: true }
        });
        const userEmail = user?.email?.toLowerCase() ?? "";
        if (connection.email.toLowerCase() !== userEmail) {
          return reply.code(403).send({ message: "Personal inbox access denied" });
        }
      }

      if (body.messageIds && body.messageIds.length > 0) {
        const result = await app.services.prisma.emailMessage.updateMany({
          where: {
            workspaceId: params.workspaceId,
            inboxConnectionId: params.id,
            id: { in: body.messageIds },
            isTrashed: false,
            isArchived: false,
            mailboxCategory: "PERSONAL"
          },
          data: { isTrashed: true }
        });
        return reply.send({ status: "ok", trashed: result.count });
      }

      const thresholds = await getWorkspaceThresholds(app, params.workspaceId);
      const where = buildMessagesWhere({
        workspaceId: params.workspaceId,
        inboxConnectionId: params.id,
        businessCategory: "NON_BUSINESS",
        reviewOnly: false,
        lowConfidenceOnly: false,
        ...(body.search ? { search: body.search } : {}),
        classificationThreshold: thresholds.classificationThreshold,
        taskThreshold: thresholds.taskThreshold
      });

      const result = await app.services.prisma.emailMessage.updateMany({
        where,
        data: { isTrashed: true }
      });

      return reply.send({ status: "ok", trashed: result.count });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId/trash",
    async (request, reply) => {
      const params = messageDetailParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);

      await app.services.prisma.emailMessage.updateMany({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }]
        },
        data: { isTrashed: true }
      });

      return reply.send({ status: "ok" });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId/untrash",
    async (request, reply) => {
      const params = messageDetailParamsSchema.parse(request.params);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);

      await app.services.prisma.emailMessage.updateMany({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }]
        },
        data: { isTrashed: false }
      });

      return reply.send({ status: "ok" });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId/pin",
    async (request, reply) => {
      const params = messageDetailParamsSchema.parse(request.params);
      const body = z.object({ pinned: z.boolean() }).parse(request.body);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);

      if (!hasMinRole(membership.role, "MEMBER")) {
        return reply.code(403).send({ message: "Viewer role cannot pin messages" });
      }

      const message = await app.services.prisma.emailMessage.findFirst({
        where: {
          workspaceId: params.workspaceId,
          inboxConnectionId: params.id,
          OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }]
        },
        select: { id: true }
      });

      if (!message) {
        return reply.code(404).send({ message: "Message not found" });
      }

      const updated = await app.services.prisma.emailMessage.update({
        where: { id: message.id },
        data: {
          isPinned: body.pinned,
          pinnedAt: body.pinned ? new Date() : null
        },
        select: { id: true, isPinned: true, pinnedAt: true }
      });

      return reply.send({ id: updated.id, isPinned: updated.isPinned, pinnedAt: serializeDate(updated.pinnedAt) });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/tasks/:taskId/pin",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        taskId: z.string().min(1)
      }).parse(request.params);
      const body = z.object({ pinned: z.boolean() }).parse(request.body);
      const { session, membership } = await loadWorkspaceSession({
        app,
        request,
        workspaceId: params.workspaceId
      });

      if (!session) return sendAuthenticationRequired(reply);
      if (!membership) return sendWorkspaceAccessDenied(reply);

      if (!hasMinRole(membership.role, "MEMBER")) {
        return reply.code(403).send({ message: "Viewer role cannot pin tasks" });
      }

      const task = await app.services.prisma.task.findFirst({
        where: { id: params.taskId, workspaceId: params.workspaceId },
        select: { id: true }
      });

      if (!task) {
        return reply.code(404).send({ message: "Task not found" });
      }

      const updated = await app.services.prisma.task.update({
        where: { id: task.id },
        data: {
          isPinned: body.pinned,
          pinnedAt: body.pinned ? new Date() : null
        },
        select: { id: true, isPinned: true, pinnedAt: true }
      });

      return reply.send({ id: updated.id, isPinned: updated.isPinned, pinnedAt: serializeDate(updated.pinnedAt) });
    }
  );
};
