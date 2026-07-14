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

const paramsSchema = z.object({
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
    businessCategory: z.enum(["BUSINESS", "NON_BUSINESS"]),
    confidence: z.number().min(0).max(1),
    summary: z.string().max(MAX_SUMMARY_LENGTH),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    containsActionRequest: z.boolean(),
    tasks: z.array(z.object({
      title: z.string().min(1).max(300),
      description: z.string().max(2000).default(""),
      dueDate: z.string().datetime().nullable().optional(),
      recommendedOwner: z.string().max(200).nullable().optional(),
      confidence: z.number().min(0).max(1)
    })).max(MAX_TASKS).default([]),
    requiresReview: z.boolean(),
    reviewReasons: z.array(z.string().max(200)).max(20).default([])
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

function mapEmailType(body: N8nEmailResult): "ACTIONABLE_REQUEST" | "FYI_UPDATE" | "SALES_MARKETING" | "SUPPORT_CUSTOMER_ISSUE" | "INTERNAL_COORDINATION" | "NEEDS_REVIEW" {
  if (body.analysis.containsActionRequest) return "ACTIONABLE_REQUEST";
  if (body.analysis.requiresReview) return "NEEDS_REVIEW";
  return "FYI_UPDATE";
}

function shouldRequireReview(body: N8nEmailResult): boolean {
  return body.analysis.requiresReview || body.analysis.confidence < CLASSIFICATION_REVIEW_THRESHOLD;
}

async function resolveOrCreateConnection(
  prisma: PrismaClient,
  workspaceId: string,
  mailboxEmail: string
): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.inboxConnection.findFirst({
    where: {
      workspaceId,
      provider: "OUTLOOK",
      email: mailboxEmail.toLowerCase()
    },
    select: { id: true, ingestionSource: true, status: true }
  });

  if (existing) {
    if (existing.ingestionSource === "NATIVE" && existing.status === "ACTIVE") {
      throw new Error(
        `Mailbox ${mailboxEmail} is actively connected via native Outlook sync. ` +
        `Disable native sync before using n8n ingestion to prevent duplicate processing.`
      );
    }

    if (existing.ingestionSource !== "N8N") {
      await prisma.inboxConnection.update({
        where: { id: existing.id },
        data: { ingestionSource: "N8N", status: "ACTIVE" }
      });
    }

    return { id: existing.id, isNew: false };
  }

  const created = await prisma.inboxConnection.create({
    data: {
      workspaceId,
      provider: "OUTLOOK",
      email: mailboxEmail.toLowerCase(),
      displayName: mailboxEmail,
      status: "ACTIVE",
      ingestionSource: "N8N",
      connectedAt: new Date()
    }
  });

  return { id: created.id, isNew: true };
}

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
      update: {
        businessCategory: body.analysis.businessCategory,
        emailType,
        priority,
        itemStatus: classificationRequiresReview ? "NEEDS_REVIEW" : "NEW",
        summary: body.analysis.summary,
        confidence: toConfidence(body.analysis.confidence),
        containsActionRequest: body.analysis.containsActionRequest,
        requiresReview: classificationRequiresReview,
        reviewQueue: classificationRequiresReview ? "TRIAGE" : null,
        reviewStatus: classificationRequiresReview ? "PENDING" : "NOT_REQUIRED",
        routingHints: toPrismaJson({ source: "n8n", reviewReasons: body.analysis.reviewReasons }),
        modelName: "n8n-openai",
        modelVersion: "v1"
      },
      create: {
        workspaceId,
        threadId: existingMessage.threadId,
        messageId: existingMessage.id,
        businessCategory: body.analysis.businessCategory,
        emailType,
        priority,
        itemStatus: classificationRequiresReview ? "NEEDS_REVIEW" : "NEW",
        summary: body.analysis.summary,
        confidence: toConfidence(body.analysis.confidence),
        containsActionRequest: body.analysis.containsActionRequest,
        requiresReview: classificationRequiresReview,
        reviewQueue: classificationRequiresReview ? "TRIAGE" : null,
        reviewStatus: classificationRequiresReview ? "PENDING" : "NOT_REQUIRED",
        routingHints: toPrismaJson({ source: "n8n", reviewReasons: body.analysis.reviewReasons }),
        modelName: "n8n-openai",
        modelVersion: "v1"
      }
    });

    const taskIds = await upsertTasks(tx, workspaceId, existingMessage.id, existingMessage.threadId, classification.id, body, priority);

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
      businessCategory: body.analysis.businessCategory,
      emailType,
      priority,
      itemStatus: classificationRequiresReview ? "NEEDS_REVIEW" : "NEW",
      summary: body.analysis.summary,
      confidence: toConfidence(body.analysis.confidence),
      containsActionRequest: body.analysis.containsActionRequest,
      requiresReview: classificationRequiresReview,
      reviewQueue: classificationRequiresReview ? "TRIAGE" : null,
      reviewStatus: classificationRequiresReview ? "PENDING" : "NOT_REQUIRED",
      routingHints: toPrismaJson({ source: "n8n", reviewReasons: body.analysis.reviewReasons }),
      modelName: "n8n-openai",
      modelVersion: "v1"
    }
  });

  const taskIds = await upsertTasks(tx, workspaceId, message.id, thread.id, classification.id, body, priority);

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
  await tx.task.deleteMany({
    where: { workspaceId, sourceMessageId: messageId }
  });

  const taskIds: string[] = [];

  for (const task of body.analysis.tasks) {
    const taskRequiresReview = task.confidence < TASK_REVIEW_THRESHOLD;

    const created = await tx.task.create({
      data: {
        workspaceId,
        sourceThreadId: threadId,
        sourceMessageId: messageId,
        classificationId,
        title: task.title,
        summary: task.description || null,
        description: task.description || null,
        assigneeGuess: task.recommendedOwner ?? null,
        dueAt: task.dueDate ? new Date(task.dueDate) : null,
        priority: messagePriority,
        status: "OPEN",
        confidence: toConfidence(task.confidence),
        requiresReview: taskRequiresReview,
        reviewQueue: taskRequiresReview ? "EXTRACTION" : null,
        reviewStatus: taskRequiresReview ? "PENDING" : "NOT_REQUIRED"
      }
    });

    taskIds.push(created.id);
  }

  return taskIds;
}

export const registerN8nIngestRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/integrations/n8n/email-results",
    async (request, reply) => {
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

      let params: z.infer<typeof paramsSchema>;
      try {
        params = paramsSchema.parse(request.params);
      } catch {
        return reply.code(400).send({ message: "Invalid workspace ID" });
      }

      const workspace = await app.services.prisma.workspace.findUnique({
        where: { id: params.workspaceId },
        select: { id: true }
      });

      if (!workspace) {
        return reply.code(404).send({ message: "Workspace not found" });
      }

      let body: N8nEmailResult;
      try {
        body = n8nEmailResultSchema.parse(request.body);
      } catch (error) {
        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          entityType: "INTEGRATION",
          entityId: "n8n",
          action: "n8n.validation_rejected",
          metadata: {
            error: error instanceof z.ZodError ? error.issues.slice(0, 5) : "parse_error"
          },
          request
        });
        return reply.code(400).send({
          message: "Invalid request payload",
          issues: error instanceof z.ZodError ? error.issues : []
        });
      }

      const deduplicationKey = buildDeduplicationKey(
        params.workspaceId,
        body.source.mailboxEmail,
        body.source.provider,
        body.source.providerMessageId
      );

      try {
        const connection = await resolveOrCreateConnection(
          app.services.prisma,
          params.workspaceId,
          body.source.mailboxEmail
        );

        const result = await app.services.prisma.$transaction(async (tx) => {
          return upsertEmailData(tx, params.workspaceId, connection.id, body);
        }, { timeout: 30_000 });

        const auditAction = result.status === "created"
          ? "n8n.email_created"
          : result.status === "updated"
            ? "n8n.email_updated"
            : "n8n.duplicate_ignored";

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          entityType: "EMAIL_MESSAGE",
          entityId: result.messageId,
          action: auditAction,
          metadata: {
            source: "n8n",
            mailbox: body.source.mailboxEmail,
            providerMessageId: body.source.providerMessageId,
            connectionId: connection.id,
            connectionIsNew: connection.isNew,
            status: result.status,
            taskCount: result.taskIds.length,
            requiresReview: result.requiresReview,
            deduplicationKey
          },
          request
        });

        return reply.code(result.status === "created" ? 201 : 200).send({
          status: result.status,
          threadId: result.threadId,
          messageId: result.messageId,
          classificationId: result.classificationId,
          taskIds: result.taskIds,
          requiresReview: result.requiresReview,
          deduplicationKey
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Ingestion failed";

        if (message.includes("actively connected via native Outlook sync")) {
          return reply.code(409).send({ message });
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existingMessage = await app.services.prisma.emailMessage.findFirst({
            where: {
              workspaceId: params.workspaceId,
              gmailMessageId: body.source.providerMessageId
            },
            select: {
              id: true,
              threadId: true,
              classifications: { select: { id: true }, take: 1, orderBy: { createdAt: "desc" } },
              tasks: { select: { id: true } }
            }
          });

          if (existingMessage) {
            await app.services.auditEventLogger.log({
              workspaceId: params.workspaceId,
              entityType: "EMAIL_MESSAGE",
              entityId: existingMessage.id,
              action: "n8n.concurrent_duplicate_handled",
              metadata: {
                providerMessageId: body.source.providerMessageId,
                deduplicationKey
              },
              request
            });

            return reply.code(200).send({
              status: "unchanged",
              threadId: existingMessage.threadId,
              messageId: existingMessage.id,
              classificationId: existingMessage.classifications[0]?.id ?? null,
              taskIds: existingMessage.tasks.map(t => t.id),
              requiresReview: false,
              deduplicationKey
            });
          }
        }

        app.log.error({ event: "n8n_ingest_failed", error: message });

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          entityType: "INTEGRATION",
          entityId: "n8n",
          action: "n8n.ingestion_failed",
          metadata: {
            providerMessageId: body.source.providerMessageId,
            error: message
          },
          request
        });

        return reply.code(500).send({ message: `Ingestion failed: ${message}` });
      }
    }
  );
};
