export type InboxProviderKind = "gmail" | "outlook";

export const providerKindFromEnum = (
  dbProvider: string
): InboxProviderKind => {
  switch (dbProvider) {
    case "GMAIL":
      return "gmail";
    case "OUTLOOK":
      return "outlook";
    default:
      throw new Error(`Unknown inbox provider enum value: ${dbProvider}`);
  }
};

export const providerKindToEnum = (
  kind: InboxProviderKind
): string => {
  switch (kind) {
    case "gmail":
      return "GMAIL";
    case "outlook":
      return "OUTLOOK";
  }
};

export interface ProviderAddress {
  name: string | null;
  email: string;
  raw: string;
}

export interface ProviderAttachmentMetadata {
  attachmentId: string | null;
  contentId: string | null;
  filename: string | null;
  inline: boolean;
  mimeType: string | null;
  partId: string | null;
  size: number | null;
}

/** Canonical mail direction relative to the monitored mailbox. */
export type ProviderEmailDirection = "RECEIVED" | "SENT";

/** Outlook (and future) well-known mail folders for scoped sync. */
export type ProviderMailFolder = "inbox" | "sentitems";

export interface ProviderMessageSnapshot {
  providerMessageId: string;
  providerThreadId: string;
  historyId: string | null;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  toAddresses: ProviderAddress[];
  ccAddresses: ProviderAddress[];
  bccAddresses: ProviderAddress[];
  replyToAddresses: ProviderAddress[];
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  hasAttachments: boolean;
  attachmentMetadata: ProviderAttachmentMetadata[];
  providerLabels: string[];
  sentAt: Date;
  /** RFC 822 Message-ID when the provider exposes it (Outlook Graph). */
  internetMessageId?: string | null;
  receivedAt: Date | null;
  sizeEstimate: number | null;
  /**
   * Authoritative when set by provider folder (e.g. Sent Items → SENT).
   * Omit for providers/paths that do not know.
   */
  direction?: ProviderEmailDirection | null;
}

export interface ProviderThreadSnapshot {
  providerThreadId: string;
  historyId: string | null;
  subject: string | null;
  normalizedSubject: string | null;
  snippet: string | null;
  participants: ProviderAddress[];
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  messageCount: number;
  unreadCount: number;
  messages: ProviderMessageSnapshot[];
}

export interface ProviderMailboxSyncResult {
  threads: ProviderThreadSnapshot[];
  newestSyncCursor: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshedRefreshToken?: string | null;
  /**
   * Opaque provider continuation for historical import paging
   * (Graph @odata.nextLink or Gmail pageToken). Not a live delta cursor.
   */
  nextPageCursor?: string | null;
}

export interface ProviderAuthorizationUrlInput {
  state: string;
}

export interface ProviderMailboxSyncInput {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  syncCursor?: string | null;
  maxThreads?: number;
  /** When set, providers prefer messages received on/after this instant. */
  receivedAfter?: Date;
  /**
   * Resume token from a prior historical page (Graph nextLink / Gmail pageToken).
   * Distinct from live syncCursor / delta links.
   */
  pageCursor?: string | null;
  /**
   * When set (Outlook delegated / shared mailbox), Graph calls use
   * `/users/{email}/...` instead of `/me/...`.
   */
  graphMailboxEmail?: string | null;
  /**
   * Outlook well-known folder for delta/list. Default inbox.
   * Gmail ignores this (INBOX sync only).
   */
  mailFolder?: ProviderMailFolder;
}

export interface ProviderTokenResult {
  accessToken: string | null;
  refreshToken: string | null;
  grantedScopes: string[];
  accessTokenExpiresAt: Date | null;
  idToken: string | null;
  tokenType: string | null;
}

export interface ProviderUserProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface InboxOAuthProvider {
  readonly kind: InboxProviderKind;
  isConfigured(): boolean;
  getRequiredScopes(): readonly string[];
  normalizeGrantedScopes(scopes: readonly string[]): string[];
  getAuthorizationUrl(input: ProviderAuthorizationUrlInput): string;
  exchangeCode(code: string): Promise<ProviderTokenResult>;
  fetchUserProfile(accessToken: string): Promise<ProviderUserProfile>;
  disconnect(): Promise<void>;
}

export interface InboxSyncProvider {
  readonly kind: InboxProviderKind;
  isConfigured(): boolean;
  syncMailbox(input: ProviderMailboxSyncInput): Promise<ProviderMailboxSyncResult>;
}
