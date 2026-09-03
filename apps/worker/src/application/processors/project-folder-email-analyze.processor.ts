import type { Prisma, PrismaClient } from "@prisma/client";
import {
  TokenCipher,
  ensureMailboxClassifyJob,
  emptyProjectFolderEmailAnalyzeProgress,
  resolveVerifiedFolderJobAssignment,
  VERIFIED_PROJECT_FOLDER_SOURCE,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type ProjectFolderEmailAnalyzeJobPayload,
  type ProjectFolderEmailAnalyzeJobResult,
  type ProjectFolderEmailAnalyzeProgress,
  type ProviderMailboxSyncResult,
  type ProviderMessageSnapshot,
  type ProviderThreadSnapshot,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

import { enqueueAttachmentIngestFromSync } from "../services/enqueue-attachment-ingest-from-sync.js";
import { importProviderMailbox } from "../services/import-provider-mailbox.js";
import {
  OutlookClient,
  type OutlookClientConfig,
  type OutlookMessageSnapshot,
} from "../../infrastructure/providers/outlook/outlook-client.js";

const PAGE_SIZE = 50;

function mapOutlookMessage(msg: OutlookMessageSnapshot): ProviderMessageSnapshot {
  return {
    providerMessageId: msg.outlookMessageId,
    providerThreadId: msg.conversationId,
    historyId: null,
    subject: msg.subject,
    senderName: msg.senderName,
    senderEmail: msg.senderEmail,
    toAddresses: msg.toAddresses,
    ccAddresses: msg.ccAddresses,
    bccAddresses: msg.bccAddresses,
    replyToAddresses: msg.replyToAddresses,
    snippet: msg.snippet,
    bodyText: msg.bodyText,
    bodyHtml: msg.bodyHtml,
    hasAttachments: msg.hasAttachments,
    attachmentMetadata: msg.attachmentMetadata.map((att) => ({
      attachmentId: att.attachmentId,
      contentId: att.contentId,
      filename: att.filename,
      inline: att.inline,
      mimeType: att.mimeType,
      partId: null,
      size: att.size,
    })),
    providerLabels: msg.folderLabels,
    sentAt: msg.sentAt,
    internetMessageId: msg.internetMessageId,
    receivedAt: msg.receivedAt,
    sizeEstimate: null,
  };
}

function threadsFromMessages(
  messages: OutlookMessageSnapshot[]
): ProviderThreadSnapshot[] {
  const byThread = new Map<string, ProviderMessageSnapshot[]>();
  for (const msg of messages) {
    const mapped = mapOutlookMessage(msg);
    const list = byThread.get(mapped.providerThreadId) ?? [];
    list.push(mapped);
    byThread.set(mapped.providerThreadId, list);
  }

  const threads: ProviderThreadSnapshot[] = [];
  for (const [providerThreadId, msgs] of byThread) {
    const sorted = [...msgs].sort(
      (a, b) =>
        (a.receivedAt?.getTime() ?? a.sentAt?.getTime() ?? 0) -
        (b.receivedAt?.getTime() ?? b.sentAt?.getTime() ?? 0)
    );
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const participants = [
      ...(first.senderEmail
        ? [
            {
              name: first.senderName,
              email: first.senderEmail,
              raw: first.senderEmail,
            },
          ]
        : []),
      ...first.toAddresses,
    ];
    threads.push({
      providerThreadId,
      historyId: null,
      subject: first.subject,
      normalizedSubject: first.subject,
      snippet: last.snippet,
      participants,
      firstMessageAt: first.receivedAt ?? first.sentAt ?? new Date(),
      lastMessageAt: last.receivedAt ?? last.sentAt ?? new Date(),
      messageCount: sorted.length,
      unreadCount: 0,
      messages: sorted,
    });
  }
  return threads;
}

async function writeProgress(
  prisma: PrismaClient,
  runId: string,
  progress: ProjectFolderEmailAnalyzeProgress,
  extra?: { status?: "RUNNING" | "COMPLETED" | "FAILED"; errorMessage?: string | null }
): Promise<void> {
  await prisma.projectFolderEmailAnalyzeRun.update({
    where: { id: runId },
    data: {
      progress: progress as unknown as Prisma.InputJsonValue,
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.errorMessage !== undefined
        ? { errorMessage: extra.errorMessage }
        : {}),
      ...(extra?.status === "COMPLETED" || extra?.status === "FAILED"
        ? { completedAt: new Date() }
        : {}),
    },
  });
}

export async function processProjectFolderEmailAnalyze(
  payload: ProjectFolderEmailAnalyzeJobPayload,
  deps: {
    prisma: PrismaClient;
    tokenCipher: TokenCipher;
    outlookConfig: OutlookClientConfig;
    classifyQueue: Queue<MailboxClassifyJobPayload, MailboxClassifyJobResult>;
    attachmentIngestQueue: Queue<AttachmentIngestJobPayload, AttachmentIngestResult>;
  }
): Promise<ProjectFolderEmailAnalyzeJobResult> {
  const progress = emptyProjectFolderEmailAnalyzeProgress();

  const run = await deps.prisma.projectFolderEmailAnalyzeRun.findFirst({
    where: {
      id: payload.runId,
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
    },
  });
  if (!run) {
    throw new Error(`Analyze run not found: ${payload.runId}`);
  }

  const folderIds = Array.isArray(run.folderIds)
    ? (run.folderIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  progress.foldersTotal = folderIds.length;

  await deps.prisma.projectFolderEmailAnalyzeRun.update({
    where: { id: run.id },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      progress: progress as unknown as Prisma.InputJsonValue,
      errorMessage: null,
    },
  });

  const connection = await deps.prisma.inboxConnection.findFirst({
    where: {
      id: payload.inboxConnectionId,
      workspaceId: payload.workspaceId,
    },
    select: {
      id: true,
      provider: true,
      email: true,
      encryptedRefreshToken: true,
      status: true,
    },
  });

  if (!connection?.encryptedRefreshToken) {
    const msg = "Mailbox is not authorized for Graph access";
    await writeProgress(deps.prisma, run.id, progress, {
      status: "FAILED",
      errorMessage: msg,
    });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "FAILED",
      progress,
      errorMessage: msg,
    };
  }

  if (connection.provider !== "OUTLOOK") {
    const msg = "Verified folder email analysis currently supports Outlook only";
    await writeProgress(deps.prisma, run.id, progress, {
      status: "FAILED",
      errorMessage: msg,
    });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "FAILED",
      progress,
      errorMessage: msg,
    };
  }

  const client = new OutlookClient(deps.outlookConfig);
  let refreshToken = deps.tokenCipher.decrypt(connection.encryptedRefreshToken);

  try {
    for (const folderId of folderIds) {
      const folder = await deps.prisma.discoveredFolder.findFirst({
        where: {
          id: folderId,
          workspaceId: payload.workspaceId,
          status: "APPROVED",
          matchedJobId: { not: null },
          missingFromProvider: false,
          providerFolderId: { not: "" },
          OR: [
            { inboxConnectionId: connection.id },
            {
              inboxConnectionId: null,
              mailboxEmail: {
                equals: connection.email.toLowerCase(),
                mode: "insensitive",
              },
            },
          ],
        },
        include: {
          matchedJob: {
            select: { id: true, workspaceId: true, name: true, jobNumber: true },
          },
        },
      });

      if (!folder?.matchedJobId || !folder.matchedJob) {
        progress.failed += 1;
        progress.foldersDone += 1;
        await writeProgress(deps.prisma, run.id, progress);
        continue;
      }

      if (folder.matchedJob.workspaceId !== payload.workspaceId) {
        progress.failed += 1;
        progress.foldersDone += 1;
        await writeProgress(deps.prisma, run.id, progress);
        continue;
      }

      // Prefer connection-bound folders; allow legacy rows matched by mailbox email.
      if (
        folder.inboxConnectionId &&
        folder.inboxConnectionId !== payload.inboxConnectionId
      ) {
        progress.failed += 1;
        progress.foldersDone += 1;
        await writeProgress(deps.prisma, run.id, progress);
        continue;
      }

      progress.currentFolderName = folder.rawFolderName;
      await writeProgress(deps.prisma, run.id, progress);

      let pageCursor: string | null = null;
      do {
        let page;
        try {
          page = await client.listMailFolderMessages({
            refreshToken,
            folderId: folder.providerFolderId,
            pageSize: PAGE_SIZE,
            pageCursor,
          });
          if (page.refreshedRefreshToken) {
            refreshToken = page.refreshedRefreshToken;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("project-folder-email-page-failed", {
            folderId: folder.id,
            error: msg.slice(0, 200),
          });
          progress.failed += 1;
          break;
        }

        if (page.items.length === 0) {
          pageCursor = page.nextPageCursor;
          continue;
        }

        const mailbox: ProviderMailboxSyncResult = {
          threads: threadsFromMessages(page.items),
          newestSyncCursor: null,
          accessToken: null,
          accessTokenExpiresAt: null,
        };

        let importResult;
        try {
          importResult = await importProviderMailbox({
            prisma: deps.prisma,
            workspaceId: payload.workspaceId,
            inboxConnectionId: payload.inboxConnectionId,
            mailbox,
            bypassInboxClearedAt: true,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("project-folder-email-import-failed", {
            folderId: folder.id,
            error: msg.slice(0, 200),
          });
          progress.failed += page.items.length;
          pageCursor = page.nextPageCursor;
          await writeProgress(deps.prisma, run.id, progress);
          continue;
        }

        progress.created += importResult.createdMessageIds?.length ?? 0;
        progress.existing += importResult.updatedMessageIds?.length ?? 0;
        progress.processed +=
          (importResult.createdMessageIds?.length ?? 0) +
          (importResult.updatedMessageIds?.length ?? 0) +
          (importResult.duplicateMessageIds?.length ?? 0);

        const messageIds = [
          ...(importResult.createdMessageIds ?? []),
          ...(importResult.updatedMessageIds ?? []),
          ...(importResult.duplicateMessageIds ?? []),
        ];
        // Deduplicate ids
        const uniqueIds = [...new Set(messageIds)];

        for (const emailMessageId of uniqueIds) {
          try {
            const existing = await deps.prisma.emailMessage.findFirst({
              where: {
                id: emailMessageId,
                workspaceId: payload.workspaceId,
                inboxConnectionId: payload.inboxConnectionId,
              },
              select: {
                id: true,
                jobId: true,
                jobAssignmentIsManual: true,
                jobAssignmentSource: true,
                classifications: { select: { id: true }, take: 1 },
              },
            });
            if (!existing) {
              progress.unavailable += 1;
              continue;
            }

            const outcome = resolveVerifiedFolderJobAssignment({
              existingJobId: existing.jobId,
              existingIsManual: existing.jobAssignmentIsManual,
              existingSource: existing.jobAssignmentSource,
              folderJobId: folder.matchedJobId,
            });

            if (outcome === "conflict") {
              progress.conflicts += 1;
            } else if (outcome === "assigned") {
              await deps.prisma.emailMessage.update({
                where: { id: existing.id },
                data: {
                  jobId: folder.matchedJobId,
                  jobAssignmentSource: VERIFIED_PROJECT_FOLDER_SOURCE,
                  jobAssignmentIsManual: false,
                  jobAssignedAt: new Date(),
                  mailboxCategory: "BUSINESS",
                },
              });
              progress.assigned += 1;

              if (existing.classifications.length > 0) {
                await deps.prisma.classification.updateMany({
                  where: {
                    workspaceId: payload.workspaceId,
                    messageId: existing.id,
                  },
                  data: {
                    jobId: folder.matchedJobId,
                    mailboxCategory: "BUSINESS",
                    businessCategory: "BUSINESS",
                  },
                });
              }
            } else {
              // unchanged — ensure provenance tag if missing
              if (
                existing.jobId === folder.matchedJobId &&
                existing.jobAssignmentSource !== VERIFIED_PROJECT_FOLDER_SOURCE &&
                !existing.jobAssignmentIsManual
              ) {
                await deps.prisma.emailMessage.update({
                  where: { id: existing.id },
                  data: {
                    jobAssignmentSource: VERIFIED_PROJECT_FOLDER_SOURCE,
                    mailboxCategory: "BUSINESS",
                  },
                });
              }
              progress.assigned += 1;
            }

            const hasClassification = existing.classifications.length > 0;
            if (!hasClassification) {
              try {
                const enqueue = await ensureMailboxClassifyJob({
                  queue: deps.classifyQueue,
                  workspaceId: payload.workspaceId,
                  inboxConnectionId: payload.inboxConnectionId,
                  emailMessageId: existing.id,
                  ...(payload.initiatedBy
                    ? { initiatedBy: payload.initiatedBy }
                    : {}),
                });
                if (enqueue === "enqueued" || enqueue === "skipped_inflight") {
                  progress.classifyQueued += 1;
                  await deps.prisma.emailMessage
                    .update({
                      where: { id: existing.id },
                      data: {
                        classificationStatus: "PENDING",
                        classificationLastAttemptAt: new Date(),
                      },
                    })
                    .catch(() => {});
                } else {
                  progress.classifySkipped += 1;
                }
              } catch (e) {
                progress.failed += 1;
                console.warn("project-folder-classify-enqueue-failed", {
                  emailMessageId: existing.id,
                  error: e instanceof Error ? e.message : String(e),
                });
              }
            } else {
              progress.classifySkipped += 1;
            }
          } catch (e) {
            progress.failed += 1;
            console.warn("project-folder-message-process-failed", {
              emailMessageId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        if (importResult.attachmentIngestCandidates.length > 0) {
          const att = await enqueueAttachmentIngestFromSync({
            queue: deps.attachmentIngestQueue,
            workspaceId: payload.workspaceId,
            inboxConnectionId: payload.inboxConnectionId,
            candidates: importResult.attachmentIngestCandidates.map((c) => ({
              emailMessageId: c.emailMessageId,
              providerMessageId: c.providerMessageId,
            })),
          });
          progress.attachmentQueued += att.enqueuedCount;
          progress.failed += att.failedCount;
        }

        pageCursor = page.nextPageCursor;
        await writeProgress(deps.prisma, run.id, progress);
      } while (pageCursor);

      progress.foldersDone += 1;
      progress.currentFolderName = null;
      await writeProgress(deps.prisma, run.id, progress);
    }

    await writeProgress(deps.prisma, run.id, progress, { status: "COMPLETED" });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "COMPLETED",
      progress,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeProgress(deps.prisma, run.id, progress, {
      status: "FAILED",
      errorMessage: msg.slice(0, 2000),
    });
    return {
      workspaceId: payload.workspaceId,
      inboxConnectionId: payload.inboxConnectionId,
      runId: run.id,
      status: "FAILED",
      progress,
      errorMessage: msg,
    };
  }
}
