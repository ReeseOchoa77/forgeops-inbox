import { Prisma, type PrismaClient, type ReviewQueue, type ReviewStatus } from "@prisma/client";
import {
  extractDomain,
  mailboxCategoryFromLegacyBusinessFilter,
  buildClassificationWriteLog,
  shouldSkipNativeClassificationOverwrite,
  normalizeTaskDueAt,
  resolveTaskSourceDate,
  type InboxAnalysisResult,
} from "@forgeops/shared";

import { classifyNormalizedEmail } from "./classify-normalized-email.js";
import { extractTaskCandidate } from "./extract-task-candidate.js";
import { normalizeEmailMessage } from "./normalize-email-message.js";
import { persistJobMatchResult } from "./persist-job-match.js";
import { createJobMatcherService } from "./prisma-job-match-loader.js";

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
          email: true,
          ingestionSource: true,
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
          jobId: true,
          jobAssignmentIsManual: true,
          jobAssignmentSource: true,
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

  // N8N owns classification for n8n-ingested mailboxes — do not run native analysis.
  if (connection.ingestionSource === "N8N") {
    console.info("inbox-analysis-skipped", {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      reason: "n8n_classification_owner",
    });
    return {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      messagesAnalyzed: 0,
      messagesClassified: 0,
      taskCandidatesCreated: 0,
      lowConfidenceItemsFlaggedForReview: 0,
    };
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
  const existingClassifications = importedMessageIds.length
    ? await input.prisma.classification.findMany({
        where: {
          workspaceId: input.workspaceId,
          messageId: { in: importedMessageIds },
        },
        select: {
          messageId: true,
          modelName: true,
          reviewStatus: true,
          mailboxCategory: true,
        },
      })
    : [];
  const existingClassificationByMessageId = new Map(
    existingClassifications.map((c) => [c.messageId, c])
  );
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
  const jobMatcher = createJobMatcherService(input.prisma);

  const BATCH_SIZE = 25;
  for (let batchStart = 0; batchStart < importedMessages.length; batchStart += BATCH_SIZE) {
    const batch = importedMessages.slice(batchStart, batchStart + BATCH_SIZE);

    // Precompute job matches outside the DB transaction (same JobMatcherService as n8n).
    const batchJobMatches = new Map<
      string,
      Awaited<ReturnType<typeof jobMatcher.match>>
    >();
    for (const message of batch) {
      try {
        const normalizedForMatch = normalizeEmailMessage({
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
        const match = await jobMatcher.match({
          workspaceId: input.workspaceId,
          emailMessageId: message.id,
          subject: message.subject,
          normalizedSubject: normalizedForMatch.normalizedSubject,
          bodyText: message.bodyText,
          cleanBody: normalizedForMatch.cleanTextBody,
          senderEmail: message.senderEmail,
          senderDomain:
            normalizedForMatch.senderDomain ??
            extractDomain(message.senderEmail ?? "") ??
            null,
          threadId: message.threadId,
        });
        batchJobMatches.set(message.id, match);
      } catch (e) {
        console.warn("job-match-failed", {
          emailMessageId: message.id,
          error: e instanceof Error ? e.message : "unknown",
        });
      }
    }

  await input.prisma.$transaction(async (tx) => {
    for (const message of batch) {
      const existingClassification = existingClassificationByMessageId.get(message.id);
      if (shouldSkipNativeClassificationOverwrite(existingClassification)) {
        console.info({
          ...buildClassificationWriteLog({
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
            emailMessageId: message.id,
            source: "NATIVE_ANALYSIS",
            previousCategory: existingClassification?.mailboxCategory ?? null,
            newCategory: existingClassification?.mailboxCategory ?? null,
            modelName: existingClassification?.modelName ?? null,
          }),
          skipped: true,
          reason: "n8n_or_manual_owned",
        });
        continue;
      }

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

      const mailboxCategory = mailboxCategoryFromLegacyBusinessFilter(
        classification.businessCategory
      );
      const jobMatch =
        mailboxCategory === "PERSONAL"
          ? undefined
          : batchJobMatches.get(message.id);
      const jobMatchRequiresReview = Boolean(jobMatch?.requiresReview);
      const requiresReview =
        classification.requiresReview || jobMatchRequiresReview;
      const reviewStateForPersist = buildReviewState({
        requiresReview,
        reviewQueue
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
          mailboxCategory,
          emailType: classification.emailType,
          priority: classification.priority,
          itemStatus: requiresReview ? "NEEDS_REVIEW" : classification.itemStatus,
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
          requiresReview,
          reviewQueue: reviewStateForPersist.reviewQueue,
          reviewStatus: reviewStateForPersist.reviewStatus,
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
          mailboxCategory,
          emailType: classification.emailType,
          priority: classification.priority,
          itemStatus: requiresReview ? "NEEDS_REVIEW" : classification.itemStatus,
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
          requiresReview,
          reviewQueue: reviewStateForPersist.reviewQueue,
          reviewStatus: reviewStateForPersist.reviewStatus,
          modelName: "rules-normalizer",
          modelVersion: "v1"
        }
      });

      if (jobMatch) {
        await persistJobMatchResult(tx, {
          classificationId: persistedClassification.id,
          emailMessageId: message.id,
          match: jobMatch,
          existing: {
            jobId: message.jobId,
            jobAssignmentIsManual: message.jobAssignmentIsManual,
            jobAssignmentSource: message.jobAssignmentSource,
          },
        });
      }

      if (taskCandidate) {
        const taskExisted = existingTaskMessageIds.has(message.id);
        const sourceDate = resolveTaskSourceDate(message);
        const dueAt = normalizeTaskDueAt(taskCandidate.dueAt, {
          emailMessageId: message.id,
        });

        await tx.task.upsert({
          where: {
            workspaceId_sourceMessageId_sourceTaskKey: {
              workspaceId: input.workspaceId,
              sourceMessageId: message.id,
              sourceTaskKey: "heuristic-primary"
            }
          },
          update: {
            sourceThreadId: message.threadId,
            classificationId: persistedClassification.id,
            assigneeUserId: null,
            assigneeGuess: taskCandidate.assigneeGuess,
            sourceTaskKey: "heuristic-primary",
            title: taskCandidate.title,
            summary: taskCandidate.summary,
            description: taskCandidate.summary,
            dueAt,
            sourceDate,
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
            sourceTaskKey: "heuristic-primary",
            classificationId: persistedClassification.id,
            assigneeGuess: taskCandidate.assigneeGuess,
            title: taskCandidate.title,
            summary: taskCandidate.summary,
            description: taskCandidate.summary,
            dueAt,
            sourceDate,
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
          itemStatus: requiresReview ? "NEEDS_REVIEW" : classification.itemStatus,
          // Tabs filter EmailMessage.mailboxCategory — keep in sync with Classification.
          mailboxCategory,
        }
      });

      console.info(
        buildClassificationWriteLog({
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          emailMessageId: message.id,
          source: "NATIVE_ANALYSIS",
          previousCategory: existingClassification?.mailboxCategory ?? null,
          newCategory: mailboxCategory,
          modelName: "rules-normalizer",
        })
      );

      // Keep in-memory map current for subsequent batches
      existingClassificationByMessageId.set(message.id, {
        messageId: message.id,
        modelName: "rules-normalizer",
        reviewStatus: reviewStateForPersist.reviewStatus,
        mailboxCategory,
      });

      threadReviewState.set(message.threadId, {
        priority: taskCandidate?.priority ?? classification.priority,
        itemStatus:
          requiresReview || taskCandidate?.requiresReview
            ? "NEEDS_REVIEW"
            : classification.itemStatus,
        latestClassificationConfidence: toConfidence(classification.confidence),
        reviewQueue:
          requiresReview || taskCandidate?.requiresReview
            ? reviewQueue
            : null,
        reviewStatus:
          requiresReview || taskCandidate?.requiresReview
            ? "PENDING"
            : "NOT_REQUIRED"
      });

      if (requiresReview || taskCandidate?.requiresReview) {
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
