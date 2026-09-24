/**
 * Active bidding is a Job lifecycle state. It is not an email classification.
 * BID_OPPORTUNITY / BID_UPDATE / ESTIMATE_QUOTE describe an email.
 * Job.status BIDDING means the company is pursuing the project.
 */

export const ACTIVE_BID_STATUS = "BIDDING" as const;
export const STATUS_AFTER_REMOVE_FROM_BIDDING = "LEAD" as const;

export const USER_BID_ASSIGNMENT = {
  jobAssignmentSource: "USER_ASSIGNED" as const,
  jobAssignmentIsManual: true,
};

/** Classification never creates or removes an active bid. */
export function activeBidFromClassification(
  _businessTypeKey: string | null | undefined
): null {
  return null;
}

export function statusAfterRemoveFromBidding(
  current: string
): typeof STATUS_AFTER_REMOVE_FROM_BIDDING | null {
  if (current !== ACTIVE_BID_STATUS) return null;
  return STATUS_AFTER_REMOVE_FROM_BIDDING;
}

export type ThreadJobMessage = {
  jobId: string | null;
  jobName?: string | null;
};

export type ThreadJobConflict = {
  jobId: string;
  jobName: string | null;
  count: number;
};

/** Messages already on a different project. Confirm before moving them. */
export function threadJobConflicts(
  messages: ThreadJobMessage[],
  targetJobId: string
): ThreadJobConflict[] {
  const map = new Map<string, ThreadJobConflict>();
  for (const message of messages) {
    if (!message.jobId || message.jobId === targetJobId) continue;
    const existing = map.get(message.jobId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    map.set(message.jobId, {
      jobId: message.jobId,
      jobName: message.jobName ?? null,
      count: 1,
    });
  }
  return [...map.values()];
}

export function assignmentAllowed(
  conflicts: ThreadJobConflict[],
  confirmMove: boolean
): boolean {
  return conflicts.length === 0 || confirmMove;
}

export type BiddingDueFilter = "all" | "week" | "month" | "past";
export type BiddingSort = "due" | "activity" | "name";

export type BiddingListJob = {
  id: string;
  name: string;
  jobNumber: string | null;
  customerName: string | null;
  bidDueAt: Date | null;
};

export type BiddingActivityStats = {
  emailCount: number;
  threadCount: number;
  unreadCount: number;
  lastActivityAt: Date | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function bidMatchesDueFilter(
  bidDueAt: Date | null,
  filter: BiddingDueFilter,
  now: Date
): boolean {
  if (filter === "all") return true;
  if (!bidDueAt) return false;
  const due = dateKey(bidDueAt);
  const today = dateKey(utcDayStart(now));
  if (filter === "past") return due < today;
  const horizon = dateKey(
    new Date(utcDayStart(now).getTime() + (filter === "week" ? 7 : 30) * DAY_MS)
  );
  return due >= today && due < horizon;
}

export function presentBiddingList<T extends BiddingListJob>(
  jobs: T[],
  activity: Map<string, BiddingActivityStats>,
  input: {
    search?: string;
    due?: BiddingDueFilter;
    sort?: BiddingSort;
    now?: Date;
  }
): T[] {
  const now = input.now ?? new Date();
  const due = input.due ?? "all";
  const sort = input.sort ?? "due";
  const search = input.search?.trim().toLowerCase() ?? "";
  const filtered = jobs.filter((job) => {
    if (!bidMatchesDueFilter(job.bidDueAt, due, now)) return false;
    if (!search) return true;
    const haystack = [job.name, job.jobNumber ?? "", job.customerName ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
  const activityAt = (job: T) => activity.get(job.id)?.lastActivityAt?.getTime() ?? null;
  filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "activity") {
      const av = activityAt(a);
      const bv = activityAt(b);
      if (av == null && bv == null) return a.name.localeCompare(b.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    }
    const av = a.bidDueAt?.getTime() ?? null;
    const bv = b.bidDueAt?.getTime() ?? null;
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });
  return filtered;
}

export function biddingSummary(
  jobs: Array<{ bidDueAt: Date | null }>,
  activity: Map<string, BiddingActivityStats>,
  now: Date
): { active: number; dueThisWeek: number; pastDue: number; unread: number } {
  let dueThisWeek = 0;
  let pastDue = 0;
  let unread = 0;
  for (const job of jobs) {
    if (bidMatchesDueFilter(job.bidDueAt, "week", now)) dueThisWeek += 1;
    if (bidMatchesDueFilter(job.bidDueAt, "past", now)) pastDue += 1;
  }
  for (const stats of activity.values()) unread += stats.unreadCount;
  return { active: jobs.length, dueThisWeek, pastDue, unread };
}

/** Fields loaded for the bidding pipeline. No email bodies. */
export const BIDDING_LIST_JOB_SELECT = [
  "id",
  "name",
  "jobNumber",
  "status",
  "bidDueAt",
  "customerId",
] as const;
