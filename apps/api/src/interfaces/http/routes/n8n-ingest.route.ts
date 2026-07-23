import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash } from "node:crypto";

import { verifyN8nApiKey } from "../n8n-auth.js";

const CLASSIFICATION_REVIEW_THRESHOLD = 0.80;
const TASK_REVIEW_THRESHOLD = 0.80;
const MAX_TASKS = 5;
const MAX_SUBJECT_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 300;
const MAX_BODY_LENGTH = 100_000;
const MAX_RECIPIENTS = 200;

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const n8nEmailResultSchema = z.object({
  source: z.object({
    provider: z.literal("outlook"),
    mailboxEmail: z.string().email(),
    providerMessageId: z.string().min(1).max(500),
    providerConversationId: z.string().max(500).nullable().optional(),
    internetMessageId: z.string().max(500).nullable().optional()
  }),
  email: z.object({
    subject: z.string().max(MAX_SUBJECT_LENGTH),
    normalizedSubject: z.string().max(MAX_SUBJECT_LENGTH),
    senderName: z.string().max(200).nullable().optional(),
    senderEmail: z.string().email(),
    senderDomain: z.string().max(200),
    to: z.array(z.string().email()).max(MAX_RECIPIENTS),
    cc: z.array(z.string().email()).max(MAX_RECIPIENTS).default([]),
    receivedAt: z.string().datetime(),
    bodyText: z.string().max(MAX_BODY_LENGTH),
    bodyHtml: z.string().max(MAX_BODY_LENGTH).nullable().optional(),
    cleanBody: z.string().max(MAX_BODY_LENGTH),
    hasAttachments: z.boolean(),
    attachmentNames: z.array(z.string().max(200)).max(50).default([])
  }),
  analysis: z.object({
    businessCategory: z.enum(["BUSINESS", "NON_BUSINESS"]).optional(),
    mailboxCategory: z.enum(["BUSINESS", "PERSONAL"]).optional(),
    mailboxConfidence: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    businessType: z.string().max(50).optional(),
    businessTypeConfidence: z.number().min(0).max(1).optional(),
    summary: z.string().max(MAX_SUMMARY_LENGTH),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    containsActionRequest: z.boolean(),
    selectedCustomerId: z.string().nullable().optional(),
    selectedVendorId: z.string().nullable().optional(),
    selectedJobId: z.string().nullable().optional(),
    entityMatchConfidence: z.number().min(0).max(1).optional(),
    matchEvidence: z.array(z.string().max(200)).max(20).optional(),
    tasks: z.array(z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(2000).default(""),
      dueDate: z.string().nullable().optional().transform(val => {
        if (!val) return null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00.000Z`;
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString();
      }),
      recommendedOwner: z.string().max(200).nullable().optional(),
      confidence: z.number().min(0).max(1)
    })).max(MAX_TASKS).default([]),
    requiresReview: z.boolean(),
    reviewReasons: z.array(z.string().max(200)).max(20).default([])
  }).refine(
    analysis => !!(analysis.mailboxCategory || analysis.businessCategory),
    { message: "Either mailboxCategory (BUSINESS|PERSONAL) or businessCategory (BUSINESS|NON_BUSINESS) is required", path: ["mailboxCategory"] }
  ).transform(analysis => {
    const resolvedCategory = analysis.mailboxCategory
      ?? (analysis.businessCategory === "NON_BUSINESS" ? "PERSONAL" : "BUSINESS");

    const resolvedConfidence = analysis.mailboxConfidence ?? analysis.confidence ?? 0;

    return {
      ...analysis,
      mailboxCategory: resolvedCategory as "BUSINESS" | "PERSONAL",
      mailboxConfidence: resolvedConfidence,
      businessCategory: resolvedCategory === "BUSINESS" ? "BUSINESS" as const : "NON_BUSINESS" as const,
      confidence: resolvedConfidence
    };
  })
});

type N8nEmailResult = z.infer<typeof n8nEmailResultSchema>;

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const toConfidence = (value: number): Prisma.Decimal =>
  new Prisma.Decimal(value.toFixed(4));

function buildDeduplicationKey(workspaceId: string, mailboxEmail: string, provider: string, providerMessageId: string): string {
  return createHash("sha256")
    .update(`${workspaceId}:${mailboxEmail.toLowerCase()}:${provider}:${providerMessageId}`)
    .digest("hex")
    .slice(0, 32);
}

function mapPriorityToEnum(priority: string): "LOW" | "MEDIUM" | "HIGH" | "URGENT" {
  switch (priority) {
    case "URGENT": return "URGENT";
    case "HIGH": return "HIGH";
    case "NORMAL": return "MEDIUM";
    case "LOW": return "LOW";
    default: return "MEDIUM";
  }
}

function generateTaskKey(messageId: string, title: string, index: number): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  return createHash("sha256")
    .update(`${messageId}:${normalized}:${index}`)
    .digest("hex")
    .slice(0, 16);
}

function mapEmailType(body: N8nEmailResult): "ACTIONABLE_REQUEST" | "FYI_UPDATE" | "SALES_MARKETING" | "SUPPORT_CUSTOMER_ISSUE" | "INTERNAL_COORDINATION" | "NEEDS_REVIEW" {
  if (body.analysis.containsActionRequest) return "ACTIONABLE_REQUEST";
  if (body.analysis.requiresReview) return "NEEDS_REVIEW";
  return "FYI_UPDATE";
}

function shouldRequireReview(body: N8nEmailResult): boolean {
  if (body.analysis.requiresReview) return true;
  if (body.analysis.confidence < CLASSIFICATION_REVIEW_THRESHOLD) return true;
  const mc = body.analysis.mailboxConfidence;
  if (mc !== undefined && mc < 0.90) return true;
  const btc = body.analysis.businessTypeConfidence;
  if (btc !== undefined && btc < CLASSIFICATION_REVIEW_THRESHOLD && body.analysis.mailboxCategory === "BUSINESS") return true;
  const emc = body.analysis.entityMatchConfidence;
  if (emc !== undefined && emc < CLASSIFICATION_REVIEW_THRESHOLD && (body.analysis.selectedCustomerId || body.analysis.selectedVendorId || body.analysis.selectedJobId)) return true;
  return false;
}

function buildClassificationData(body: N8nEmailResult, priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT", emailType: string, requiresReview: boolean) {
  return {
    businessCategory: body.analysis.businessCategory,
    emailType: emailType as "ACTIONABLE_REQUEST" | "FYI_UPDATE" | "SALES_MARKETING" | "SUPPORT_CUSTOMER_ISSUE" | "INTERNAL_COORDINATION" | "NEEDS_REVIEW" | "RECRUITING_HIRING",
    priority,
    itemStatus: requiresReview ? "NEEDS_REVIEW" as const : "NEW" as const,
    summary: body.analysis.summary,
    confidence: toConfidence(body.analysis.confidence),
    containsActionRequest: body.analysis.containsActionRequest,
    requiresReview,
    reviewQueue: requiresReview ? "TRIAGE" as const : null,
    reviewStatus: requiresReview ? "PENDING" as const : "NOT_REQUIRED" as const,
    routingHints: toPrismaJson({ source: "n8n", reviewReasons: body.analysis.reviewReasons }),
    modelName: "n8n-openai",
    modelVersion: "v1",
    mailboxCategory: body.analysis.mailboxCategory ?? "BUSINESS",
    mailboxConfidence: body.analysis.mailboxConfidence ? toConfidence(body.analysis.mailboxConfidence) : null,
    businessTypeKey: body.analysis.businessType ?? null,
    businessTypeConfidence: body.analysis.businessTypeConfidence ? toConfidence(body.analysis.businessTypeConfidence) : null,
    entityMatchConfidence: body.analysis.entityMatchConfidence ? toConfidence(body.analysis.entityMatchConfidence) : null,
    matchEvidence: body.analysis.matchEvidence ? toPrismaJson(body.analysis.matchEvidence) : Prisma.JsonNull,
    rawAiPayload: toPrismaJson(body.analysis),
    customerId: body.analysis.selectedCustomerId ?? null,
    vendorId: body.analysis.selectedVendorId ?? null,
    jobId: body.analysis.selectedJobId ?? null,
    processedAt: new Date()
  };
}

async function resolveMailboxOwnership(
  prisma: PrismaClient,
  provider: string,
  mailboxEmail: string
): Promise<{ connectionId: string; workspaceId: string }> {
  const normalized = mailboxEmail.toLowerCase();
  const dbProvider = provider === "outlook" ? "OUTLOOK" : "GMAIL";

  const mailboxes = await prisma.workspaceMailbox.findMany({
    where: {
      normalizedEmail: normalized,
      provider: dbProvider,
      status: { in: ["ACTIVE", "PAUSED"] }
    },
    select: { id: true, workspaceId: true, status: true, ingestionMode: true, inboxConnectionId: true }
  });

  if (mailboxes.length === 0) {
    const legacyConnection = await prisma.inboxConnection.findFirst({
      where: {
        provider: dbProvider,
        email: normalized,
        ingestionSource: "N8N",
        status: { in: ["ACTIVE", "PAUSED"] }
      },
      select: { id: true, workspaceId: true, status: true }
    });

    if (!legacyConnection) {
      throw new MailboxNotFoundError(
        `No registered mailbox found for ${normalized} (${provider}). ` +
        `Register this mailbox via the platform admin API first.`
      );
    }

    if (legacyConnection.status === "PAUSED") {
      throw new MailboxPausedError(`Mailbox ${normalized} is paused.`);
    }

    return { connectionId: legacyConnection.id, workspaceId: legacyConnection.workspaceId };
  }

  if (mailboxes.length > 1) {
    throw new AmbiguousMailboxError(
      `Multiple workspaces claim mailbox ${normalized}. ` +
      `Resolve the conflict via the platform admin API.`
    );
  }

  const mailbox = mailboxes[0]!;

  if (mailbox.status === "PAUSED") {
    throw new MailboxPausedError(`Mailbox ${normalized} is paused. Resume it via the platform admin API.`);
  }

  let connectionId = mailbox.inboxConnectionId;
  if (!connectionId) {
    const connection = await prisma.inboxConnection.findFirst({
      where: { workspaceId: mailbox.workspaceId, provider: dbProvider, email: normalized },
      select: { id: true }
    });

    if (connection) {
      connectionId = connection.id;
    } else {
      const created = await prisma.inboxConnection.create({
        data: {
          workspaceId: mailbox.workspaceId,
          provider: dbProvider,
          email: normalized,
          displayName: normalized,
          status: "ACTIVE",
          ingestionSource: "N8N",
          connectedAt: new Date()
        }
      });
      connectionId = created.id;
    }

    await prisma.workspaceMailbox.update({
      where: { id: mailbox.id },
      data: { inboxConnectionId: connectionId }
    });
  }

  return { connectionId, workspaceId: mailbox.workspaceId };
}

class MailboxNotFoundError extends Error { constructor(msg: string) { super(msg); this.name = "MailboxNotFoundError"; } }
class AmbiguousMailboxError extends Error { constructor(msg: string) { super(msg); this.name = "AmbiguousMailboxError"; } }
class MailboxPausedError extends Error { constructor(msg: string) { super(msg); this.name = "MailboxPausedError"; } }

async function upsertEmailData(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  connectionId: string,
  body: N8nEmailResult
): Promise<{
  status: "created" | "updated" | "unchanged";
  threadId: string;
  messageId: string;
  classificationId: string;
  taskIds: string[];
  requiresReview: boolean;
}> {
  const providerThreadId = body.source.providerConversationId ?? body.source.providerMessageId;
  const receivedAt = new Date(body.email.receivedAt);
  const priority = mapPriorityToEnum(body.analysis.priority);
  const emailType = mapEmailType(body);
  const classificationRequiresReview = shouldRequireReview(body);

  const toAddresses = body.email.to.map(e => ({ name: null, email: e, raw: e }));
  const ccAddresses = body.email.cc.map(e => ({ name: null, email: e, raw: e }));
  const attachmentMetadata = body.email.attachmentNames.map((name, i) => ({
    attachmentId: null,
    contentId: null,
    filename: name,
    inline: false,
    mimeType: null,
    partId: null,
    size: null
  }));

  const existingMessage = await tx.emailMessage.findFirst({
    where: {
      inboxConnectionId: connectionId,
      gmailMessageId: body.source.providerMessageId
    },
    select: {
      id: true,
      threadId: true,
      classifications: { select: { id: true, confidence: true }, take: 1, orderBy: { createdAt: "desc" } },
      tasks: { select: { id: true }, take: MAX_TASKS }
    }
  });

  if (existingMessage) {
    const existingConfidence = existingMessage.classifications[0]
      ? Number(existingMessage.classifications[0].confidence.toString())
      : 0;

    if (existingConfidence >= body.analysis.confidence) {
      return {
        status: "unchanged",
        threadId: existingMessage.threadId,
        messageId: existingMessage.id,
        classificationId: existingMessage.classifications[0]?.id ?? "",
        taskIds: existingMessage.tasks.map(t => t.id),
        requiresReview: classificationRequiresReview
      };
    }

    const classification = await tx.classification.upsert({
      where: {
        workspaceId_messageId: {
          workspaceId,
          messageId: existingMessage.id
        }
      },
      update: buildClassificationData(body, priority, emailType, classificationRequiresReview),
      create: {
        workspaceId,
        threadId: existingMessage.threadId,
        messageId: existingMessage.id,
        ...buildClassificationData(body, priority, emailType, classificationRequiresReview)
      }
    });

    const taskIds = body.analysis.mailboxCategory === "PERSONAL" ? [] : await upsertTasks(tx, workspaceId, existingMessage.id, existingMessage.threadId, classification.id, body, priority);

    return {
      status: "updated",
      threadId: existingMessage.threadId,
      messageId: existingMessage.id,
      classificationId: classification.id,
      taskIds,
      requiresReview: classificationRequiresReview
    };
  }

  const thread = await tx.emailThread.upsert({
    where: {
      inboxConnectionId_gmailThreadId: {
        inboxConnectionId: connectionId,
        gmailThreadId: providerThreadId
      }
    },
    update: {
      subject: body.email.subject,
      normalizedSubject: body.email.normalizedSubject,
      snippet: body.email.bodyText.slice(0, 200),
      lastMessageAt: receivedAt,
      messageCount: { increment: 1 },
      priority,
      itemStatus: classificationRequiresReview ? "NEEDS_REVIEW" : "NEW",
      reviewQueue: classificationRequiresReview ? "TRIAGE" : null,
      reviewStatus: classificationRequiresReview ? "PENDING" : "NOT_REQUIRED",
      latestClassificationConfidence: toConfidence(body.analysis.confidence)
    },
    create: {
      workspaceId,
      inboxConnectionId: connectionId,
      gmailThreadId: providerThreadId,
      providerThreadId,
      subject: body.email.subject,
      normalizedSubject: body.email.normalizedSubject,
      snippet: body.email.bodyText.slice(0, 200),
      firstMessageAt: receivedAt,
      lastMessageAt: receivedAt,
      messageCount: 1,
      unreadCount: 1,
      priority,
      itemStatus: classificationRequiresReview ? "NEEDS_REVIEW" : "NEW",
      reviewQueue: classificationRequiresReview ? "TRIAGE" : null,
      reviewStatus: classificationRequiresReview ? "PENDING" : "NOT_REQUIRED",
      latestClassificationConfidence: toConfidence(body.analysis.confidence)
    }
  });

  const message = await tx.emailMessage.create({
    data: {
      workspaceId,
      inboxConnectionId: connectionId,
      threadId: thread.id,
      gmailMessageId: body.source.providerMessageId,
      gmailThreadId: providerThreadId,
      providerMessageId: body.source.providerMessageId,
      providerThreadId,
      subject: body.email.subject,
      senderName: body.email.senderName ?? null,
      senderEmail: body.email.senderEmail,
      toAddresses: toPrismaJson(toAddresses),
      ccAddresses: toPrismaJson(ccAddresses),
      snippet: body.email.bodyText.slice(0, 200),
      bodyText: body.email.bodyText,
      bodyHtml: body.email.bodyHtml ?? null,
      labelIds: ["n8n-ingested"],
      hasAttachments: body.email.hasAttachments,
      isRead: false,
      isImportant: body.analysis.priority === "HIGH" || body.analysis.priority === "URGENT",
      isSpam: false,
      isTrashed: false,
      mailboxCategory: body.analysis.mailboxCategory ?? "BUSINESS",
      attachmentMetadata: toPrismaJson(attachmentMetadata),
      sentAt: receivedAt,
      receivedAt,
      priority,
      itemStatus: classificationRequiresReview ? "NEEDS_REVIEW" : "NEW"
    }
  });

  await tx.normalizedEmail.create({
    data: {
      workspaceId,
      inboxConnectionId: connectionId,
      threadId: thread.id,
      messageId: message.id,
      sender: toPrismaJson({ name: body.email.senderName ?? null, email: body.email.senderEmail, role: "FROM" }),
      recipients: toPrismaJson([
        ...body.email.to.map(e => ({ name: null, email: e, role: "TO" })),
        ...body.email.cc.map(e => ({ name: null, email: e, role: "CC" }))
      ]),
      subject: body.email.subject,
      normalizedSubject: body.email.normalizedSubject,
      snippet: body.email.bodyText.slice(0, 200),
      receivedAt,
      cleanTextBody: body.email.cleanBody,
      labelHints: ["n8n-ingested"],
      categoryHints: [`business:${body.analysis.businessCategory.toLowerCase()}`, `source:n8n`],
      senderDomain: body.email.senderDomain
    }
  });

  const classification = await tx.classification.create({
    data: {
      workspaceId,
      threadId: thread.id,
      messageId: message.id,
      ...buildClassificationData(body, priority, emailType, classificationRequiresReview)
    }
  });

  const taskIds = body.analysis.mailboxCategory === "PERSONAL" ? [] : await upsertTasks(tx, workspaceId, message.id, thread.id, classification.id, body, priority);

  return {
    status: "created",
    threadId: thread.id,
    messageId: message.id,
    classificationId: classification.id,
    taskIds,
    requiresReview: classificationRequiresReview
  };
}

async function upsertTasks(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  messageId: string,
  threadId: string,
  classificationId: string,
  body: N8nEmailResult,
  messagePriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
): Promise<string[]> {
  const taskIds: string[] = [];
  const incomingKeys = new Set<string>();

  for (let i = 0; i < body.analysis.tasks.length; i++) {
    const task = body.analysis.tasks[i]!;
    const taskKey = generateTaskKey(messageId, task.title, i);
    incomingKeys.add(taskKey);
    const taskRequiresReview = task.confidence < TASK_REVIEW_THRESHOLD;
    const dueAt = task.dueDate ? new Date(task.dueDate) : null;

    const upserted = await tx.task.upsert({
      where: {
        workspaceId_sourceMessageId_sourceTaskKey: {
          workspaceId,
          sourceMessageId: messageId,
          sourceTaskKey: taskKey
        }
      },
      update: {
        sourceThreadId: threadId,
        classificationId,
        title: task.title,
        summary: task.description || null,
        description: task.description || null,
        assigneeGuess: task.recommendedOwner ?? null,
        dueAt,
        priority: messagePriority,
        confidence: toConfidence(task.confidence),
        requiresReview: taskRequiresReview,
        reviewQueue: taskRequiresReview ? "EXTRACTION" : null,
        reviewStatus: taskRequiresReview ? "PENDING" : "NOT_REQUIRED"
      },
      create: {
        workspaceId,
        sourceThreadId: threadId,
        sourceMessageId: messageId,
        sourceTaskKey: taskKey,
        classificationId,
        title: task.title,
        summary: task.description || null,
        description: task.description || null,
        assigneeGuess: task.recommendedOwner ?? null,
        dueAt,
        priority: messagePriority,
        status: "OPEN",
        confidence: toConfidence(task.confidence),
        requiresReview: taskRequiresReview,
        reviewQueue: taskRequiresReview ? "EXTRACTION" : null,
        reviewStatus: taskRequiresReview ? "PENDING" : "NOT_REQUIRED"
      }
    });

    taskIds.push(upserted.id);
  }

  const staleTasksRemoved = await tx.task.deleteMany({
    where: {
      workspaceId,
      sourceMessageId: messageId,
      sourceTaskKey: { notIn: [...incomingKeys] }
    }
  });

  if (staleTasksRemoved.count > 0) {
    console.info("stale-tasks-removed", { messageId, count: staleTasksRemoved.count });
  }

  return taskIds;
}

async function handleN8nIngest(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  explicitWorkspaceId?: string
): Promise<void> {
  const env = app.services.env;

  if (!verifyN8nApiKey(request, reply, env.N8N_INTEGRATION_API_KEY, env.N8N_INTEGRATION_ENABLED)) {
    await app.services.auditEventLogger.log({
      workspaceId: "unknown",
      entityType: "INTEGRATION",
      entityId: "n8n",
      action: "n8n.auth_rejected",
      metadata: { reason: "invalid_or_missing_key" },
      request
    });
    return;
  }

  let body: N8nEmailResult;
  try {
    body = n8nEmailResultSchema.parse(request.body);
  } catch (error) {
    await app.services.auditEventLogger.log({
      workspaceId: explicitWorkspaceId ?? "unknown",
      entityType: "INTEGRATION",
      entityId: "n8n",
      action: "n8n.validation_rejected",
      metadata: {
        error: error instanceof z.ZodError ? error.issues.slice(0, 5) : "parse_error"
      },
      request
    });
    reply.code(400).send({
      message: "Invalid request payload",
      issues: error instanceof z.ZodError ? error.issues : []
    });
    return;
  }

  let workspaceId: string;
  let connectionId: string;

  try {
    const resolved = await resolveMailboxOwnership(
      app.services.prisma,
      body.source.provider,
      body.source.mailboxEmail
    );
    workspaceId = resolved.workspaceId;
    connectionId = resolved.connectionId;
  } catch (error) {
    if (error instanceof MailboxNotFoundError) {
      reply.code(404).send({ message: error.message });
      return;
    }
    if (error instanceof AmbiguousMailboxError) {
      reply.code(409).send({ message: error.message });
      return;
    }
    if (error instanceof MailboxPausedError) {
      reply.code(409).send({ message: error.message });
      return;
    }
    throw error;
  }

  if (explicitWorkspaceId && explicitWorkspaceId !== workspaceId) {
    reply.code(403).send({
      message: `Mailbox ${body.source.mailboxEmail} belongs to a different workspace than the one specified in the URL.`
    });
    return;
  }

  const isPersonal = body.analysis.mailboxCategory === "PERSONAL";

  if (isPersonal) {
    if (body.analysis.tasks.length > 0) {
      reply.code(400).send({ message: "PERSONAL emails must not contain tasks" });
      return;
    }
    if (body.analysis.businessType) {
      reply.code(400).send({ message: "PERSONAL emails must not have a businessType" });
      return;
    }
    if (body.analysis.selectedCustomerId || body.analysis.selectedVendorId || body.analysis.selectedJobId) {
      reply.code(400).send({ message: "PERSONAL emails must not have entity selections" });
      return;
    }
  }

  const deduplicationKey = buildDeduplicationKey(
    workspaceId,
    body.source.mailboxEmail,
    body.source.provider,
    body.source.providerMessageId
  );

  try {
    await app.services.prisma.inboxConnection.update({
      where: { id: connectionId },
      data: { lastReceivedAt: new Date() }
    });

    await app.services.prisma.workspaceMailbox.updateMany({
      where: { inboxConnectionId: connectionId },
      data: { lastMessageSeenAt: new Date() }
    }).catch(() => {});

    if (body.analysis.selectedCustomerId) {
      const exists = await app.services.prisma.customer.findFirst({
        where: { workspaceId, id: body.analysis.selectedCustomerId },
        select: { id: true }
      });
      if (!exists) {
        reply.code(400).send({ message: `Customer ID ${body.analysis.selectedCustomerId} not found in workspace` });
        return;
      }
    }
    if (body.analysis.selectedVendorId) {
      const exists = await app.services.prisma.vendor.findFirst({
        where: { workspaceId, id: body.analysis.selectedVendorId },
        select: { id: true }
      });
      if (!exists) {
        reply.code(400).send({ message: `Vendor ID ${body.analysis.selectedVendorId} not found in workspace` });
        return;
      }
    }
    if (body.analysis.selectedJobId) {
      const exists = await app.services.prisma.job.findFirst({
        where: { workspaceId, id: body.analysis.selectedJobId },
        select: { id: true }
      });
      if (!exists) {
        reply.code(400).send({ message: `Job ID ${body.analysis.selectedJobId} not found in workspace` });
        return;
      }
    }

    const result = await app.services.prisma.$transaction(async (tx) => {
      return upsertEmailData(tx, workspaceId, connectionId, body);
    }, { timeout: 30_000 });

    await app.services.prisma.inboxConnection.update({
      where: { id: connectionId },
      data: {
        lastProcessedAt: new Date(),
        lastErrorMessage: null
      }
    });

    await app.services.prisma.workspaceMailbox.updateMany({
      where: { inboxConnectionId: connectionId },
      data: { lastSuccessfulProcessingAt: new Date(), lastErrorMessage: null }
    }).catch(() => {});

    const auditAction = result.status === "created"
      ? "n8n.email_created"
      : result.status === "updated"
        ? "n8n.email_updated"
        : "n8n.duplicate_ignored";

    await app.services.auditEventLogger.log({
      workspaceId,
      entityType: "EMAIL_MESSAGE",
      entityId: result.messageId,
      action: auditAction,
      metadata: {
        source: "n8n",
        mailbox: body.source.mailboxEmail,
        providerMessageId: body.source.providerMessageId,
        connectionId,
        resolvedWorkspaceId: workspaceId,
        status: result.status,
        taskCount: result.taskIds.length,
        requiresReview: result.requiresReview,
        deduplicationKey
      },
      request
    });

    reply.code(result.status === "created" ? 201 : 200).send({
      status: result.status,
      workspaceId,
      threadId: result.threadId,
      messageId: result.messageId,
      classificationId: result.classificationId,
      taskIds: result.taskIds,
      requiresReview: result.requiresReview,
      deduplicationKey
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed";

    await app.services.prisma.inboxConnection.update({
      where: { id: connectionId },
      data: { lastErrorMessage: message }
    }).catch(() => {});

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existingMessage = await app.services.prisma.emailMessage.findFirst({
        where: { workspaceId, gmailMessageId: body.source.providerMessageId },
        select: {
          id: true, threadId: true,
          classifications: { select: { id: true }, take: 1, orderBy: { createdAt: "desc" } },
          tasks: { select: { id: true } }
        }
      });

      if (existingMessage) {
        await app.services.auditEventLogger.log({
          workspaceId,
          entityType: "EMAIL_MESSAGE",
          entityId: existingMessage.id,
          action: "n8n.concurrent_duplicate_handled",
          metadata: { providerMessageId: body.source.providerMessageId, deduplicationKey },
          request
        });

        reply.code(200).send({
          status: "unchanged",
          workspaceId,
          threadId: existingMessage.threadId,
          messageId: existingMessage.id,
          classificationId: existingMessage.classifications[0]?.id ?? null,
          taskIds: existingMessage.tasks.map(t => t.id),
          requiresReview: false,
          deduplicationKey
        });
        return;
      }
    }

    app.log.error({ event: "n8n_ingest_failed", error: message });

    await app.services.auditEventLogger.log({
      workspaceId,
      entityType: "INTEGRATION",
      entityId: "n8n",
      action: "n8n.ingestion_failed",
      metadata: { providerMessageId: body.source.providerMessageId, error: message },
      request
    });

    reply.code(500).send({ message: `Ingestion failed: ${message}` });
  }
}

export const registerN8nIngestRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/integrations/n8n/email-results",
    async (request, reply) => handleN8nIngest(app, request, reply)
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/integrations/n8n/email-results",
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      const wsId = params.success ? params.data.workspaceId : undefined;
      return handleN8nIngest(app, request, reply, wsId);
    }
  );
};
