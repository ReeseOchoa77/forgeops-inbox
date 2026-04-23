import type {
  InboxSyncProvider,
  ProviderMailboxSyncInput,
  ProviderMailboxSyncResult,
  ProviderMessageSnapshot,
  ProviderThreadSnapshot
} from "@forgeops/shared";

import {
  GmailClient,
  type GmailClientConfig,
  type GmailMessageSnapshot,
  type GmailThreadSnapshot
} from "./gmail-client.js";

const mapMessage = (msg: GmailMessageSnapshot): ProviderMessageSnapshot => ({
  providerMessageId: msg.gmailMessageId,
  providerThreadId: msg.gmailThreadId,
  historyId: msg.historyId,
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
  attachmentMetadata: msg.attachmentMetadata,
  providerLabels: msg.labelIds,
  sentAt: msg.sentAt,
  receivedAt: msg.receivedAt,
  sizeEstimate: msg.sizeEstimate
});

const mapThread = (thread: GmailThreadSnapshot): ProviderThreadSnapshot => ({
  providerThreadId: thread.gmailThreadId,
  historyId: thread.historyId,
  subject: thread.subject,
  normalizedSubject: thread.normalizedSubject,
  snippet: thread.snippet,
  participants: thread.participants,
  firstMessageAt: thread.firstMessageAt,
  lastMessageAt: thread.lastMessageAt,
  messageCount: thread.messageCount,
  unreadCount: thread.unreadCount,
  messages: thread.messages.map(mapMessage)
});

export class GmailSyncProvider implements InboxSyncProvider {
  readonly kind = "gmail" as const;
  private readonly client: GmailClient;

  constructor(config: GmailClientConfig) {
    this.client = new GmailClient(config);
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
      ...(input.maxThreads !== undefined ? { maxThreads: input.maxThreads } : {})
    });

    return {
      threads: snapshot.threads.map(mapThread),
      newestSyncCursor: snapshot.newestHistoryId,
      accessToken: snapshot.accessToken,
      accessTokenExpiresAt: snapshot.accessTokenExpiresAt
    };
  }
}
