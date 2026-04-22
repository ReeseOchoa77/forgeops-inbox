import { Prisma, type PrismaClient, type ReviewQueue, type ReviewStatus } from "@prisma/client";
import type { InboxAnalysisResult } from "@forgeops/shared";

import { classifyNormalizedEmail } from "./classify-normalized-email.js";
import { extractTaskCandidate } from "./extract-task-candidate.js";
import { normalizeEmailMessage } from "./normalize-email-message.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const toConfidence = (value: number): Prisma.Decimal =>
  new Prisma.Decimal(value.toFixed(4));

const toThresholdNumber = (
  value: Prisma.Decimal | number | null | undefined
): number =>
  value instanceof Prisma.Decimal
    ? value.toNumber()
    : typeof value === "number"
      ? value
      : DEFAULT_CONFIDENCE_THRESHOLD;

const buildReviewState = (input: {
  requiresReview: boolean;
  reviewQueue: ReviewQueue;
}): {
  reviewQueue: ReviewQueue | null;
  reviewStatus: ReviewStatus;
} => ({
  reviewQueue: input.requiresReview ? input.reviewQueue : null,
  reviewStatus: input.requiresReview ? "PENDING" : "NOT_REQUIRED"
});

export const analyzeInboxConnection = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
}): Promise<InboxAnalysisResult> => {
  const [connection, workspaceSetting, membershipUsers, importedMessages] =
    await Promise.all([
      input.prisma.inboxConnection.findUnique({
        where: {
          workspaceId_id: {
            workspaceId: input.workspaceId,
            id: input.inboxConnectionId
          }
        },
        select: {
          id: true,
          email: true
        }
      }),
      input.prisma.workspaceSetting.findUnique({
        where: {
          workspaceId: input.workspaceId
        },
        select: {
          defaultReviewQueue: true,
          classificationConfidenceThreshold: true,
          taskConfidenceThreshold: true
        }
      }),
      input.prisma.membership.findMany({
        where: {
          workspaceId: input.workspaceId
        },
        select: {
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      }),
      input.prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId
        },
        orderBy: [
          {
            receivedAt: "asc"
          },
          {
            sentAt: "asc"
          }
        ],
        select: {
          id: true,
          threadId: true,
          inboxConnectionId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          toAddresses: true,
          ccAddresses: true,
          bccAddresses: true,
          replyToAddresses: true,
          snippet: true,
          bodyText: true,
          labelIds: true,
          sentAt: true,
          receivedAt: true,
          thread: {
            select: {
              subject: true
            }
          }
        }
      })
    ]);

  if (!connection) {
    throw new Error("Inbox connection not found for analysis");
  }

  const reviewQueue = workspaceSetting?.defaultReviewQueue ?? "EXTRACTION";
  const classificationThreshold = toThresholdNumber(
    workspaceSetting?.classificationConfidenceThreshold
  );
  const taskThreshold = toThresholdNumber(workspaceSetting?.taskConfidenceThreshold);
  const members = membershipUsers.map((membership) => membership.user);
  const importedMessageIds = importedMessages.map((message) => message.id);
  const existingTasks = importedMessageIds.length
    ? await input.prisma.task.findMany({
        where: {
          workspaceId: input.workspaceId,
          sourceMessageId: {
            in: importedMessageIds
          }
        },
        select: {
          sourceMessageId: true
        }
      })
    : [];
  const existingTaskMessageIds = new Set(
    existingTasks
      .map((task) => task.sourceMessageId)
      .filter((messageId): messageId is string => Boolean(messageId))
  );
  const threadReviewState = new Map<
    string,
    {
      priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
      itemStatus: "NEW" | "NEEDS_REVIEW";
      latestClassificationConfidence: Prisma.Decimal;
      reviewQueue: ReviewQueue | null;
      reviewStatus: ReviewStatus;
    }
  >();

  let taskCandidatesCreated = 0;
  let lowConfidenceItemsFlaggedForReview = 0;

  const BATCH_SIZE = 25;
  for (let batchStart = 0; batchStart < importedMessages.length; batchStart += BATCH_SIZE) {
    const batch = importedMessages.slice(batchStart, batchStart + BATCH_SIZE);

  await input.prisma.$transaction(async (tx) => {
    for (const message of batch) {
      const normalizedEmail = normalizeEmailMessage({
        subject: message.subject,
        threadSubject: message.thread.subject,
        snippet: message.snippet,
        bodyText: message.bodyText,
        receivedAt: message.receivedAt ?? message.sentAt,
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        toAddresses: message.toAddresses,
        ccAddresses: message.ccAddresses,
        bccAddresses: message.bccAddresses,
        replyToAddresses: message.replyToAddresses,
        labelIds: message.labelIds
      });
      const classification = classifyNormalizedEmail({
        email: normalizedEmail,
        inboxEmail: connection.email,
        classificationThreshold
      });
      const taskCandidate = extractTaskCandidate({
        email: normalizedEmail,
        classification,
        members,
        taskThreshold,
        now: message.receivedAt ?? message.sentAt
      });
      const classificationReviewState = buildReviewState({
        requiresReview: classification.requiresReview,
        reviewQueue
      });
      const taskReviewState = taskCandidate
        ? buildReviewState({
            requiresReview: taskCandidate.requiresReview,
            reviewQueue
          })
        : null;

      await tx.normalizedEmail.upsert({
        where: {
          workspaceId_messageId: {
            workspaceId: input.workspaceId,
            messageId: message.id
          }
        },
        update: {
          sender: toPrismaJson(normalizedEmail.sender),
          recipients: toPrismaJson(normalizedEmail.recipients),
          subject: normalizedEmail.subject,
          normalizedSubject: normalizedEmail.normalizedSubject,
          snippet: normalizedEmail.snippet,
          receivedAt: normalizedEmail.receivedAt,
          cleanTextBody: normalizedEmail.cleanTextBody,
          labelHints: normalizedEmail.labelHints,
          categoryHints: normalizedEmail.categoryHints,
          senderDomain: normalizedEmail.senderDomain
        },
        create: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          threadId: message.threadId,
          messageId: message.id,
          sender: toPrismaJson(normalizedEmail.sender),
          recipients: toPrismaJson(normalizedEmail.recipients),
          subject: normalizedEmail.subject,
          normalizedSubject: normalizedEmail.normalizedSubject,
          snippet: normalizedEmail.snippet,
          receivedAt: normalizedEmail.receivedAt,
          cleanTextBody: normalizedEmail.cleanTextBody,
          labelHints: normalizedEmail.labelHints,
          categoryHints: normalizedEmail.categoryHints,
          senderDomain: normalizedEmail.senderDomain
        }
      });

      const persistedClassification = await tx.classification.upsert({
        where: {
          workspaceId_messageId: {
            workspaceId: input.workspaceId,
            messageId: message.id
          }
        },
        update: {
          threadId: message.threadId,
          businessCategory: classification.businessCategory,
          emailType: classification.emailType,
          priority: classification.priority,
          itemStatus: classification.itemStatus,
          summary: classification.summary,
          deadline: taskCandidate?.dueAt ?? null,
          containsActionRequest: classification.containsActionRequest,
          routingHints: toPrismaJson({
            hints: classification.routingHints,
            labelHints: normalizedEmail.labelHints,
            categoryHints: classification.categoryHints
          }),
          extractedFields: toPrismaJson({
            sender: normalizedEmail.sender,
            recipients: normalizedEmail.recipients,
            cleanTextBody: normalizedEmail.cleanTextBody,
            taskCandidate
          }),
          confidence: toConfidence(classification.confidence),
          requiresReview: classification.requiresReview,
          reviewQueue: classificationReviewState.reviewQueue,
          reviewStatus: classificationReviewState.reviewStatus,
          reviewedByUserId: null,
          reviewedAt: null,
          modelName: "rules-normalizer",
          modelVersion: "v1"
        },
        create: {
          workspaceId: input.workspaceId,
          threadId: message.threadId,
          messageId: message.id,
          businessCategory: classification.businessCategory,
          emailType: classification.emailType,
          priority: classification.priority,
          itemStatus: classification.itemStatus,
          summary: classification.summary,
          deadline: taskCandidate?.dueAt ?? null,
          containsActionRequest: classification.containsActionRequest,
          routingHints: toPrismaJson({
            hints: classification.routingHints,
            labelHints: normalizedEmail.labelHints,
            categoryHints: classification.categoryHints
          }),
          extractedFields: toPrismaJson({
            sender: normalizedEmail.sender,
            recipients: normalizedEmail.recipients,
            cleanTextBody: normalizedEmail.cleanTextBody,
            taskCandidate
          }),
          confidence: toConfidence(classification.confidence),
          requiresReview: classification.requiresReview,
          reviewQueue: classificationReviewState.reviewQueue,
          reviewStatus: classificationReviewState.reviewStatus,
          modelName: "rules-normalizer",
          modelVersion: "v1"
        }
      });

      if (taskCandidate) {
        const taskExisted = existingTaskMessageIds.has(message.id);

        await tx.task.upsert({
          where: {
            workspaceId_sourceMessageId: {
              workspaceId: input.workspaceId,
              sourceMessageId: message.id
            }
          },
          update: {
            sourceThreadId: message.threadId,
            classificationId: persistedClassification.id,
            assigneeUserId: null,
            assigneeGuess: taskCandidate.assigneeGuess,
            title: taskCandidate.title,
            summary: taskCandidate.summary,
            description: taskCandidate.summary,
            dueAt: taskCandidate.dueAt,
            priority: taskCandidate.priority,
            status: "OPEN",
            confidence: toConfidence(taskCandidate.confidence),
            requiresReview: taskCandidate.requiresReview,
            reviewQueue: taskReviewState?.reviewQueue ?? null,
            reviewStatus: taskReviewState?.reviewStatus ?? "NOT_REQUIRED",
            reviewedByUserId: null,
            reviewedAt: null,
            completedAt: null
          },
          create: {
            workspaceId: input.workspaceId,
            sourceThreadId: message.threadId,
            sourceMessageId: message.id,
            classificationId: persistedClassification.id,
            assigneeGuess: taskCandidate.assigneeGuess,
            title: taskCandidate.title,
            summary: taskCandidate.summary,
            description: taskCandidate.summary,
            dueAt: taskCandidate.dueAt,
            priority: taskCandidate.priority,
            status: "OPEN",
            confidence: toConfidence(taskCandidate.confidence),
            requiresReview: taskCandidate.requiresReview,
            reviewQueue: taskReviewState?.reviewQueue ?? null,
            reviewStatus: taskReviewState?.reviewStatus ?? "NOT_REQUIRED"
          }
        });

        if (!taskExisted) {
          taskCandidatesCreated += 1;
          existingTaskMessageIds.add(message.id);
        }
      } else {
        await tx.task.deleteMany({
          where: {
            workspaceId: input.workspaceId,
            sourceMessageId: message.id
          }
        });
        existingTaskMessageIds.delete(message.id);
      }

      await tx.emailMessage.update({
        where: {
          id: message.id
        },
        data: {
          priority: classification.priority,
          itemStatus: classification.itemStatus
        }
      });

      threadReviewState.set(message.threadId, {
        priority: taskCandidate?.priority ?? classification.priority,
        itemStatus:
          classification.requiresReview || taskCandidate?.requiresReview
            ? "NEEDS_REVIEW"
            : classification.itemStatus,
        latestClassificationConfidence: toConfidence(classification.confidence),
        reviewQueue:
          classification.requiresReview || taskCandidate?.requiresReview
            ? reviewQueue
            : null,
        reviewStatus:
          classification.requiresReview || taskCandidate?.requiresReview
            ? "PENDING"
            : "NOT_REQUIRED"
      });

      if (classification.requiresReview || taskCandidate?.requiresReview) {
        lowConfidenceItemsFlaggedForReview += 1;
      }
    }
  }, { timeout: 120_000 });

    console.info("analysis-batch-complete", {
      batchStart,
      batchSize: batch.length,
      totalMessages: importedMessages.length
    });
  }

  await input.prisma.$transaction(async (tx) => {
    for (const [threadId, reviewState] of threadReviewState) {
      await tx.emailThread.update({
        where: {
          id: threadId
        },
        data: {
          priority: reviewState.priority,
          itemStatus: reviewState.itemStatus,
          latestClassificationConfidence: reviewState.latestClassificationConfidence,
          reviewQueue: reviewState.reviewQueue,
          reviewStatus: reviewState.reviewStatus
        }
      });
    }
  }, { timeout: 60_000 });

  return {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    messagesAnalyzed: importedMessages.length,
    messagesClassified: importedMessages.length,
    taskCandidatesCreated,
    lowConfidenceItemsFlaggedForReview
  };
};
