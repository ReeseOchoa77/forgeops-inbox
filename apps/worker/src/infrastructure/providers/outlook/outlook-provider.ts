import type {
  InboxSyncProvider,
  ProviderMailboxSyncInput,
  ProviderMailboxSyncResult,
  ProviderMessageSnapshot,
  ProviderThreadSnapshot
} from "@forgeops/shared";

import {
  OutlookClient,
  type OutlookClientConfig,
  type OutlookConversationSnapshot,
  type OutlookMessageSnapshot
} from "./outlook-client.js";

const mapMessage = (
  msg: OutlookMessageSnapshot
): ProviderMessageSnapshot => ({
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
  hasAttachments: msg.hasAttachments,
  attachmentMetadata: msg.attachmentMetadata.map((att) => ({
    attachmentId: att.attachmentId,
    contentId: att.contentId,
    filename: att.filename,
    inline: att.inline,
    mimeType: att.mimeType,
    partId: null,
    size: att.size
  })),
  providerLabels: msg.folderLabels,
  sentAt: msg.sentAt,
  receivedAt: msg.receivedAt,
  sizeEstimate: null
});

const mapConversation = (
  conversation: OutlookConversationSnapshot
): ProviderThreadSnapshot => ({
  providerThreadId: conversation.conversationId,
  historyId: null,
  subject: conversation.subject,
  normalizedSubject: conversation.normalizedSubject,
  snippet: conversation.snippet,
  participants: conversation.participants,
  firstMessageAt: conversation.firstMessageAt,
  lastMessageAt: conversation.lastMessageAt,
  messageCount: conversation.messageCount,
  unreadCount: conversation.unreadCount,
  messages: conversation.messages.map(mapMessage)
});

export class OutlookSyncProvider implements InboxSyncProvider {
  readonly kind = "outlook" as const;
  private readonly client: OutlookClient;

  constructor(config: OutlookClientConfig) {
    this.client = new OutlookClient(config);
  }

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  async syncMailbox(
    input: ProviderMailboxSyncInput
  ): Promise<ProviderMailboxSyncResult> {
    const snapshot = await this.client.syncMailbox({
      refreshToken: input.refreshToken,
      accessToken: input.accessToken ?? null,
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
      syncCursor: input.syncCursor ?? null,
      ...(input.maxThreads !== undefined
        ? { maxMessages: input.maxThreads }
        : {})
    });

    return {
      threads: snapshot.conversations.map(mapConversation),
      newestSyncCursor: snapshot.newestDeltaLink,
      accessToken: snapshot.accessToken,
      accessTokenExpiresAt: snapshot.accessTokenExpiresAt,
      refreshedRefreshToken: snapshot.refreshedRefreshToken
    };
  }
}
