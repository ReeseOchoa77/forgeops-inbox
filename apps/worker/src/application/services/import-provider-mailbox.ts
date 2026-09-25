import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  InboxSyncResult,
  ProviderAddress,
  ProviderAttachmentMetadata,
  ProviderMailboxSyncResult
} from "@forgeops/shared";
import { isBlockedByInboxClearedAt, shouldInspectAttachments } from "@forgeops/shared";

export type EmailImportOrigin = "INBOX" | "HISTORICAL_IMPORT" | "PROJECT_FOLDER";

/** Flags written on create or refresh. Live inbox sync writes neither flag. */
export function emailOriginWrite(
  origin: EmailImportOrigin | undefined
): { fromHistoricalImport?: true; fromProjectFolder?: true } {
  if (origin === "HISTORICAL_IMPORT") return { fromHistoricalImport: true };
  if (origin === "PROJECT_FOLDER") return { fromProjectFolder: true };
  return {};
}

export type AttachmentIngestCandidate = {
  emailMessageId: string;
  providerMessageId: string;
  hasAttachments: boolean;
  bodyHtml: string | null;
};

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const sortAddresses = (addresses: ProviderAddress[]): ProviderAddress[] =>
  [...addresses].sort((left, right) => left.email.localeCompare(right.email));

const sortAttachments = (
  attachments: ProviderAttachmentMetadata[]
): ProviderAttachmentMetadata[] =>
  [...attachments].sort((left, right) =>
    `${left.filename ?? ""}:${left.attachmentId ?? ""}`.localeCompare(
      `${right.filename ?? ""}:${right.attachmentId ?? ""}`
    )
  );

const BATCH_SIZE = 25;

export const importProviderMailbox = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  mailbox: ProviderMailboxSyncResult;
  /**
   * When true (historical import and project-folder analysis), ignore InboxConnection.inboxClearedAt.
   * Live sync must leave this false/undefined so Clear Inbox sticks.
   */
  bypassInboxClearedAt?: boolean;
  /** Defaults to live inbox sync. Does not clear a flag that was already set. */
  origin?: EmailImportOrigin;
}): Promise<InboxSyncResult & { attachmentIngestCandidates: AttachmentIngestCandidate[]; skippedClearedCount: number }> => {
  const connectionMeta = await input.prisma.inboxConnection.findFirst({
    where: { id: input.inboxConnectionId, workspaceId: input.workspaceId },
    select: { inboxClearedAt: true },
  });
  const clearedAt =
    input.bypassInboxClearedAt || !connectionMeta?.inboxClearedAt
      ? null
      : connectionMeta.inboxClearedAt;
  const originWrite = emailOriginWrite(input.origin);

  let skippedClearedCount = 0;

  const providerThreadIds = input.mailbox.threads.map(
    (thread) => thread.providerThreadId
  );
  const providerMessageIds = input.mailbox.threads.flatMap((thread) =>
    thread.messages.map((message) => message.providerMessageId)
  );

  const existingThreads = providerThreadIds.length
    ? await input.prisma.emailThread.findMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          gmailThreadId: { in: providerThreadIds }
        },
        select: { id: true, gmailThreadId: true }
      })
    : [];

  const existingMessages = providerMessageIds.length
    ? await input.prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: input.inboxConnectionId,
          gmailMessageId: { in: providerMessageIds }
        },
        select: { id: true, gmailMessageId: true }
      })
    : [];

  const existingThreadIdMap = new Map(
    existingThreads.map((t) => [t.gmailThreadId, t.id])
  );
  const existingMessageIdMap = new Map(
    existingMessages.map((m) => [m.gmailMessageId, m.id])
  );

  let threadsImported = 0;
  let messagesImported = 0;
  const createdMessageIds: string[] = [];
  const updatedMessageIds: string[] = [];
  const duplicateMessageIds: string[] = [];
  const attachmentIngestCandidates: AttachmentIngestCandidate[] = [];

  const threads = input.mailbox.threads;

  for (let batchStart = 0; batchStart < threads.length; batchStart += BATCH_SIZE) {
    const batch = threads.slice(batchStart, batchStart + BATCH_SIZE);

    await input.prisma.$transaction(async (tx) => {
      for (const thread of batch) {
        const existingThreadId = existingThreadIdMap.get(thread.providerThreadId);
        const threadData = {
          subject: thread.subject,
          normalizedSubject: thread.normalizedSubject,
          snippet: thread.snippet,
          participants: toPrismaJson(sortAddresses(thread.participants)),
          firstMessageAt: thread.firstMessageAt,
          lastMessageAt: thread.lastMessageAt,
          messageCount: thread.messageCount,
          unreadCount: thread.unreadCount
        };

        const persistedThread = existingThreadId
          ? await tx.emailThread.update({
              where: { id: existingThreadId },
              data: { ...threadData, providerThreadId: thread.providerThreadId }
            })
          : await tx.emailThread.create({
              data: {
                workspaceId: input.workspaceId,
                inboxConnectionId: input.inboxConnectionId,
                gmailThreadId: thread.providerThreadId,
                providerThreadId: thread.providerThreadId,
                ...threadData
              }
            });

        if (!existingThreadId) {
          threadsImported += 1;
          existingThreadIdMap.set(thread.providerThreadId, persistedThread.id);
        }

        for (const message of thread.messages) {
          // Guard: never create/overwrite rows from placeholder sender payloads
          // (e.g. Outlook delta partials that slipped past the client filter).
          if (message.senderEmail === "unknown@invalid.local") {
            continue;
          }

          const existingMessageId = existingMessageIdMap.get(message.providerMessageId);
          const providerSaysUnread = message.providerLabels.some(
            (l) => l === "UNREAD" || l === "unread"
          );
          const messageData = {
            gmailThreadId: message.providerThreadId,
            providerMessageId: message.providerMessageId,
            providerThreadId: message.providerThreadId,
            internetMessageId: message.internetMessageId ?? null,
            historyId: message.historyId,
            subject: message.subject,
            senderName: message.senderName,
            senderEmail: message.senderEmail,
            toAddresses: toPrismaJson(sortAddresses(message.toAddresses)),
            ccAddresses: toPrismaJson(sortAddresses(message.ccAddresses)),
            bccAddresses: toPrismaJson(sortAddresses(message.bccAddresses)),
            replyToAddresses: toPrismaJson(sortAddresses(message.replyToAddresses)),
            snippet: message.snippet,
            bodyText: message.bodyText,
            bodyHtml: message.bodyHtml,
            labelIds: [...message.providerLabels].sort(),
            hasAttachments: message.hasAttachments,
            isImportant: message.providerLabels.some(l => l === "IMPORTANT" || l === "important"),
            isSpam: message.providerLabels.some(l =>
              l === "SPAM" || l === "CATEGORY_PROMOTIONS" ||
              l === "gmail-category:promotions" || l === "outlook-category:junk" ||
              l === "spam" || l === "junk"
            ),
            attachmentMetadata: toPrismaJson(sortAttachments(message.attachmentMetadata)),
            sentAt: message.sentAt,
            receivedAt: message.receivedAt
          };

          if (existingMessageId) {
            // Do not overwrite ForgeOps isRead→true from provider sync.
            // Only push unread from provider; user open owns marking read.
            await tx.emailMessage.update({
              where: { id: existingMessageId },
              data: {
                ...messageData,
                ...originWrite,
                ...(providerSaysUnread ? { isRead: false } : {}),
              }
            });
            updatedMessageIds.push(existingMessageId);
            duplicateMessageIds.push(existingMessageId);
            if (
              shouldInspectAttachments({
                hasAttachments: message.hasAttachments,
                bodyHtml: message.bodyHtml,
              })
            ) {
              attachmentIngestCandidates.push({
                emailMessageId: existingMessageId,
                providerMessageId: message.providerMessageId,
                hasAttachments: message.hasAttachments,
                bodyHtml: message.bodyHtml,
              });
            }
            continue;
          }

          // Live sync re-reads the current watermark at persist time.
          // receivedAt, else sentAt. Missing provider time fails closed.
          // bypassInboxClearedAt is only set by explicit historical callers.
          if (
            isBlockedByInboxClearedAt({
              inboxClearedAt: clearedAt,
              receivedAt: message.receivedAt,
              sentAt: message.sentAt,
            })
          ) {
            skippedClearedCount += 1;
            continue;
          }

          const createdMessage = await tx.emailMessage.create({
            data: {
              workspaceId: input.workspaceId,
              inboxConnectionId: input.inboxConnectionId,
              threadId: persistedThread.id,
              gmailMessageId: message.providerMessageId,
              ...messageData,
              ...originWrite,
              isRead: !providerSaysUnread,
            }
          });

          existingMessageIdMap.set(message.providerMessageId, createdMessage.id);
          messagesImported += 1;
          createdMessageIds.push(createdMessage.id);
          if (
            shouldInspectAttachments({
              hasAttachments: message.hasAttachments,
              bodyHtml: message.bodyHtml,
            })
          ) {
            attachmentIngestCandidates.push({
              emailMessageId: createdMessage.id,
              providerMessageId: message.providerMessageId,
              hasAttachments: message.hasAttachments,
              bodyHtml: message.bodyHtml,
            });
          }
        }
      }
    }, {
      maxWait: 30000,
      timeout: 60000
    });
  }

  return {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    threadsImported,
    messagesImported,
    duplicatesSkipped: duplicateMessageIds.length,
    createdMessageIds,
    updatedMessageIds,
    duplicateMessageIds,
    newestSyncCursor: input.mailbox.newestSyncCursor,
    attachmentIngestCandidates,
    skippedClearedCount,
  };
};
