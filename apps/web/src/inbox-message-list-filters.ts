/**
 * Builds query params for GET .../messages.
 * Sent is a global direction filter: sentOnly=true and no businessCategory.
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

export type InboxReadFilter = "" | "unread" | "read" | "sent";

export type InboxMessageListFilters = {
  businessCategory?: "BUSINESS" | "NON_BUSINESS";
  businessTypeGroup?: string;
  jobId?: string;
  category?: "trash";
  sentOnly?: true;
  unreadOnly?: true;
  unclassifiedOnly?: true;
  search?: string;
  searchIn?: "all" | "sender";
};

export function buildInboxMessageListFilters(input: {
  inboxTab: InboxListTab;
  readFilter: InboxReadFilter;
  jobFilter?: string;
  activeSearch?: string;
  searchIn?: "all" | "sender";
}): InboxMessageListFilters {
  const f: InboxMessageListFilters = {};

  // Global Sent: direction only — never combine with Business/Personal category.
  if (input.readFilter === "sent") {
    f.sentOnly = true;
    if (input.activeSearch) {
      f.search = input.activeSearch;
      if (input.searchIn === "sender") f.searchIn = "sender";
    }
    return f;
  }

  if (input.inboxTab === "PERSONAL") {
    f.businessCategory = "NON_BUSINESS";
  } else if (input.inboxTab === "TRASH") {
    f.category = "trash";
  } else if (input.inboxTab === "UNCLASSIFIED") {
    f.unclassifiedOnly = true;
  } else {
    f.businessCategory = "BUSINESS";
    if (input.inboxTab !== "ALL_BUSINESS") {
      f.businessTypeGroup = input.inboxTab;
    }
    if (input.jobFilter) f.jobId = input.jobFilter;
  }

  // Server-side unread (API has unreadOnly; no readOnly yet — Read stays client-side).
  if (input.readFilter === "unread") {
    f.unreadOnly = true;
  }

  if (input.activeSearch) {
    f.search = input.activeSearch;
    if (input.searchIn === "sender") f.searchIn = "sender";
  }

  return f;
}
