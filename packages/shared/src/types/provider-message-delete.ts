/**
 * Provider message deletion for Inbox "delete from connected mailbox".
 * Separate from InboxSyncProvider — sync is read-only; this is an explicit mutate.
 */

export type ProviderMessageDeleteOutcome =
  | "deleted"
  | "already_deleted"
  | "unsupported"
  | "failed";

export interface ProviderMessageDeleteInput {
  /** Canonical Graph/Gmail provider message id (EmailMessage.gmailMessageId / providerMessageId). */
  providerMessageId: string;
  /**
   * When set, Outlook Graph uses `/users/{email}/...` instead of `/me/...`
   * (delegated / shared mailbox).
   */
  graphMailboxEmail?: string | null;
  accessToken: string;
}

export interface ProviderMessageDeleteResult {
  outcome: ProviderMessageDeleteOutcome;
  status?: number;
  message?: string;
}
