import type { InboxMessageListFilters } from "./inbox-message-list-filters.js";

/**
 * Canonical identity for an Inbox list query.
 * Used to decide replace-vs-append and to reject stale responses.
 */
export function inboxListQueryKey(filters: InboxMessageListFilters): string {
  const exclude = filters.excludeBusinessTypeGroups?.length
    ? [...filters.excludeBusinessTypeGroups].sort().join(",")
    : "";
  return [
    filters.businessCategory ?? "",
    filters.businessTypeGroup ?? "",
    filters.category ?? "",
    filters.sentOnly ? "sent" : "",
    filters.unreadOnly ? "unread" : "",
    filters.unclassifiedOnly ? "unclassified" : "",
    filters.jobId ?? "",
    filters.dateRange ?? "",
    filters.timezone ?? "",
    filters.search ?? "",
    filters.searchIn ?? "",
    exclude,
  ].join("|");
}

/** True when the next fetch is the same list identity (soft revalidate OK). */
export function isSameInboxListQuery(
  previousKey: string,
  nextFilters: InboxMessageListFilters
): boolean {
  return previousKey !== "" && previousKey === inboxListQueryKey(nextFilters);
}
