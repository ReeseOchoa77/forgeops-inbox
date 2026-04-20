import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  InboxSyncResult,
  ProviderAddress,
  ProviderAttachmentMetadata,
  ProviderMailboxSyncResult
} from "@forgeops/shared";

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

export const importProviderMailbox = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  mailbox: ProviderMailboxSyncResult;
}): Promise<InboxSyncResult> =>
  input.prisma.$transaction(async (tx) => {
    const providerThreadIds = input.mailbox.threads.map(
      (thread) => thread.providerThreadId
    );
    const providerMessageIds = input.mailbox.threads.flatMap((thread) =>
      thread.messages.map((message) => message.providerMessageId)
    );

    const existingThreads = providerThreadIds.length
      ? await tx.emailThread.findMany({
          where: {
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
            gmailThreadId: {
              in: providerThreadIds
            }
          },
          select: {
            id: true,
            gmailThreadId: true
          }
        })
      : [];

    const existingMessages = providerMessageIds.length
      ? await tx.emailMessage.findMany({
          where: {
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
            gmailMessageId: {
              in: providerMessageIds
            }
          },
          select: {
            id: true,
            gmailMessageId: true
          }
        })
      : [];

    const existingThreadIdMap = new Map(
      existingThreads.map((thread) => [thread.gmailThreadId, thread.id])
    );
    const existingMessageIdMap = new Map(
      existingMessages.map((message) => [message.gmailMessageId, message.id])
    );

    let threadsImported = 0;
    let messagesImported = 0;

    for (const thread of input.mailbox.threads) {
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
            where: {
              id: existingThreadId
            },
            data: {
              ...threadData,
              providerThreadId: thread.providerThreadId
            }
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
        const existingMessageId = existingMessageIdMap.get(
          message.providerMessageId
        );
        const messageData = {
          gmailThreadId: message.providerThreadId,
          providerMessageId: message.providerMessageId,
          providerThreadId: message.providerThreadId,
          historyId: message.historyId,
          subject: message.subject,
          senderName: message.senderName,
          senderEmail: message.senderEmail,
          toAddresses: toPrismaJson(sortAddresses(message.toAddresses)),
          ccAddresses: toPrismaJson(sortAddresses(message.ccAddresses)),
          bccAddresses: toPrismaJson(sortAddresses(message.bccAddresses)),
          replyToAddresses: toPrismaJson(
            sortAddresses(message.replyToAddresses)
          ),
          snippet: message.snippet,
          bodyText: message.bodyText,
          bodyHtml: null,
          labelIds: [...message.providerLabels].sort(),
          hasAttachments: message.hasAttachments,
          attachmentMetadata: toPrismaJson(
            sortAttachments(message.attachmentMetadata)
          ),
          sentAt: message.sentAt,
          receivedAt: message.receivedAt
        };

        if (existingMessageId) {
          await tx.emailMessage.update({
            where: {
              id: existingMessageId
            },
            data: messageData
          });
          continue;
        }

        const createdMessage = await tx.emailMessage.create({
          data: {
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
            threadId: persistedThread.id,
            gmailMessageId: message.providerMessageId,
            ...messageData
          }
        });

        existingMessageIdMap.set(
          message.providerMessageId,
          createdMessage.id
        );
        messagesImported += 1;
      }
    }

    return {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      threadsImported,
      messagesImported,
      duplicatesSkipped: existingThreads.length + existingMessages.length,
      newestSyncCursor: input.mailbox.newestSyncCursor
    };
  });
