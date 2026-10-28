import { sortedNormalizedEmails } from "./inbox-smart-search";

/**
 * Builds query params for GET .../messages.
 * SENT is a direction predicate (sentOnly) that ANDs with every other active
 * Inbox filter — it must not override classification, subtype, job, etc.
 * Unread uses server-side unreadOnly (not client-only filtering).
 * Unclassified is messages with no Classification row (pending/failed classify).
 */

export type InboxListTab =
  | "ALL_BUSINESS"
  | "BIDS_ESTIMATING"
  | "PROJECTS"
  | "PURCHASING"
  | "ACCOUNTING"
  | "INTERNAL"
  | "OTHER"
  | "UNCLASSIFIED"
  | "PERSONAL"
  | "TRASH";

/** Canonical Business type groups (same as Inbox tabs / API businessTypeGroup). */
export const INBOX_BUSINESS_TYPE_GROUPS = [
  "BIDS_ESTIMATING",
  "PROJECTS",
  "PURCHASING",
  "ACCOUNTING",
  "INTERNAL",
  "OTHER",
] as const;

export type InboxBusinessTypeGroup = (typeof INBOX_BUSINESS_TYPE_GROUPS)[number];

export const INBOX_BUSINESS_TYPE_GROUP_LABELS: Record<InboxBusinessTypeGroup, string> = {
  BIDS_ESTIMATING: "Bids & Estimating",
  PROJECTS: "Projects",
  PURCHASING: "Purchasing",
  ACCOUNTING: "Accounting",
  INTERNAL: "Internal",
  OTHER: "Other",
};

export type InboxReadFilter = "" | "unread" | "read" | "sent";

export type InboxDateRangeFilter = "" | "TODAY" | "WEEK" | "MONTH";

export type InboxMessageListFilters = {
  businessCategory?: "BUSINESS" | "NON_BUSINESS";
  businessTypeGroup?: string;
  /**
   * Exact filter key (e.g. BID_OPPORTUNITY = Active Bid provenance filter).
   * Server-side before pagination.
   */
  businessTypeKey?: string;
  /** Hide selected Business type groups (server-side Exclude filter). */
  excludeBusinessTypeGroups?: InboxBusinessTypeGroup[];
  jobId?: string;
  category?: "trash";
  sentOnly?: true;
  unreadOnly?: true;
  unclassifiedOnly?: true;
  /** When true, only pinned emails (composes with tab/direction filters). */
  pinnedOnly?: true;
  dateRange?: "TODAY" | "WEEK" | "MONTH";
  timezone?: string;
  /**
   * Unified Inbox search term. Server matches participant OR content.
   * Optional searchIn=id remains API-only for exact message id lookup.
   */
  search?: string;
  /** @deprecated Prefer omit — unified search is default. Only "id" remains meaningful. */
  searchIn?: "all" | "sender" | "id";
  /** Explicit sender tokens (OR). Incoming Inbox. */
  fromEmails?: string[];
  /** Explicit recipient tokens (OR). Sent Inbox. */
  toEmails?: string[];
};

export function buildInboxMessageListFilters(input: {
  inboxTab: InboxListTab;
  readFilter: InboxReadFilter;
  dateRange?: InboxDateRangeFilter;
  timezone?: string;
  jobFilter?: string;
  activeSearch?: string;
  /** Applied only on Business tabs (not Personal / Unclassified / Trash). */
  excludeBusinessTypeGroups?: InboxBusinessTypeGroup[];
  /** Filter key — ANDs with tab/group when set (e.g. Active Bid provenance). */
  businessTypeKey?: string;
  pinnedOnly?: boolean;
  /** Confirmed email-address tokens — never ordinary search text. */
  participantEmails?: string[];
}): InboxMessageListFilters {
  const f: InboxMessageListFilters = {};

  // Direction predicate — composes with tab/classification filters below.
  if (input.readFilter === "sent") {
    f.sentOnly = true;
  }

  if (input.inboxTab === "PERSONAL") {
    f.businessCategory = "NON_BUSINESS";
  } else if (input.inboxTab === "TRASH") {
    f.category = "trash";
  } else if (input.inboxTab === "UNCLASSIFIED") {
    f.unclassifiedOnly = true;
  } else {
    f.businessCategory = "BUSINESS";
    // Exact subtype takes precedence over group tab filter (AND with Business).
    if (input.businessTypeKey) {
      f.businessTypeKey = input.businessTypeKey;
    } else if (input.inboxTab !== "ALL_BUSINESS") {
      f.businessTypeGroup = input.inboxTab;
    }
    if (input.jobFilter) f.jobId = input.jobFilter;
    if (input.excludeBusinessTypeGroups && input.excludeBusinessTypeGroups.length > 0) {
      f.excludeBusinessTypeGroups = [...input.excludeBusinessTypeGroups];
    }
  }

  // Server-side unread (API has unreadOnly; no readOnly yet — Read stays client-side).
  if (input.readFilter === "unread") {
    f.unreadOnly = true;
  }

  if (input.dateRange) {
    f.dateRange = input.dateRange;
    if (input.timezone) f.timezone = input.timezone;
  }

  // Unified search — no searchIn mode; server ORs participant + content fields.
  if (input.activeSearch) {
    f.search = input.activeSearch;
  }

  if (input.pinnedOnly) {
    f.pinnedOnly = true;
  }

  const participantEmails = sortedNormalizedEmails(input.participantEmails);
  if (participantEmails.length > 0) {
    if (input.readFilter === "sent") f.toEmails = participantEmails;
    else f.fromEmails = participantEmails;
  }

  return f;
}
