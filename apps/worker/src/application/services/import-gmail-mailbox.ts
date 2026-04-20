import type { Prisma, PrismaClient } from "@prisma/client";
import type { InboxSyncResult } from "@forgeops/shared";

import type {
  GmailAddress,
  GmailAttachmentMetadata,
  GmailMailboxSyncSnapshot
} from "../../infrastructure/gmail/gmail-client.js";

const toPrismaJson = (value: unknown): Prisma.InputJsonValue => {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as Prisma.JsonValue;
  return normalized as Prisma.InputJsonValue;
};

const sortAddresses = (addresses: GmailAddress[]): GmailAddress[] =>
  [...addresses].sort((left, right) => left.email.localeCompare(right.email));

const sortAttachments = (
  attachments: GmailAttachmentMetadata[]
): GmailAttachmentMetadata[] =>
  [...attachments].sort((left, right) =>
    `${left.filename ?? ""}:${left.attachmentId ?? ""}`.localeCompare(
      `${right.filename ?? ""}:${right.attachmentId ?? ""}`
    )
  );

export const importGmailMailbox = async (input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  mailbox: GmailMailboxSyncSnapshot;
}): Promise<InboxSyncResult> =>
  input.prisma.$transaction(async (tx) => {
    const gmailThreadIds = input.mailbox.threads.map((thread) => thread.gmailThreadId);
    const gmailMessageIds = input.mailbox.threads.flatMap((thread) =>
      thread.messages.map((message) => message.gmailMessageId)
    );

    const existingThreads = gmailThreadIds.length
      ? await tx.emailThread.findMany({
          where: {
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
            gmailThreadId: {
              in: gmailThreadIds
            }
          },
          select: {
            id: true,
            gmailThreadId: true
          }
        })
      : [];

    const existingMessages = gmailMessageIds.length
      ? await tx.emailMessage.findMany({
          where: {
            workspaceId: input.workspaceId,
            inboxConnectionId: input.inboxConnectionId,
            gmailMessageId: {
              in: gmailMessageIds
            }
          },
          select: {
            id: true,
            gmailMessageId: true
          }
        })
      : [];

    const existingThreadIds = new Map(
      existingThreads.map((thread) => [thread.gmailThreadId, thread.id])
    );
    const existingMessageIds = new Map(
      existingMessages.map((message) => [message.gmailMessageId, message.id])
    );

    let threadsImported = 0;
    let messagesImported = 0;

    for (const thread of input.mailbox.threads) {
      const existingThreadId = existingThreadIds.get(thread.gmailThreadId);
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
            data: threadData
          })
        : await tx.emailThread.create({
            data: {
              workspaceId: input.workspaceId,
              inboxConnectionId: input.inboxConnectionId,
              gmailThreadId: thread.gmailThreadId,
              ...threadData
            }
          });

      if (!existingThreadId) {
        threadsImported += 1;
        existingThreadIds.set(thread.gmailThreadId, persistedThread.id);
      }

      for (const message of thread.messages) {
        const existingMessageId = existingMessageIds.get(message.gmailMessageId);
        const messageData = {
          gmailThreadId: message.gmailThreadId,
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
          bodyHtml: null,
          labelIds: [...message.labelIds].sort(),
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
            gmailMessageId: message.gmailMessageId,
            ...messageData
          }
        });

        existingMessageIds.set(message.gmailMessageId, createdMessage.id);
        messagesImported += 1;
      }
    }

    return {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      threadsImported,
      messagesImported,
      duplicatesSkipped: existingThreads.length + existingMessages.length,
      newestSyncCursor: input.mailbox.newestHistoryId
    };
  });
