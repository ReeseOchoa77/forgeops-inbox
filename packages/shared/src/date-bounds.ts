/**
 * Timezone-aware calendar bounds for Inbox date filters and task cutoffs.
 *
 * Week starts on Sunday (matches TasksView "This Week").
 * Bounds are returned as UTC Date instants for Prisma comparisons.
 */

export type InboxDateRangePreset = "TODAY" | "WEEK" | "MONTH";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar YYYY-MM-DD for `date` in `timeZone`. */
export function zonedYmd(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * UTC instant of local midnight (00:00:00.000) for calendar day `ymd` in `timeZone`.
 */
export function zonedStartOfDay(ymd: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${ymd}`);
  }
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const d = Number(match[3]);

  // Iterate to correct for timezone offset (incl. DST) at that local midnight.
  let guess = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asIfUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    const target = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
    guess -= asIfUtc - target;
  }
  return new Date(guess);
}

/** Add calendar days to a YYYY-MM-DD string (UTC-calendar arithmetic on the YMD). */
export function addDaysYmd(ymd: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) throw new Error(`Invalid date: ${ymd}`);
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Sunday-start week containing `ymd` (Sunday = day 0). */
export function startOfWeekSundayYmd(ymd: string, timeZone: string): string {
  const start = zonedStartOfDay(ymd, timeZone);
  // Weekday in that zone at local noon-ish of that day
  const noonGuess = new Date(start.getTime() + 12 * 60 * 60 * 1000);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(noonGuess);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = map[weekday] ?? 0;
  return addDaysYmd(ymd, -dow);
}

export function startOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/**
 * Inclusive lower bound / exclusive upper bound for an Inbox date preset.
 * Upper bound is "now" (not end-of-day) so future-dated mail is excluded naturally.
 */
export function inboxDateRangeBounds(
  preset: InboxDateRangePreset,
  timeZone: string,
  now = new Date()
): { receivedAfter: Date; receivedBefore: Date } {
  const today = zonedYmd(now, timeZone);
  let startYmd: string;
  if (preset === "TODAY") {
    startYmd = today;
  } else if (preset === "WEEK") {
    startYmd = startOfWeekSundayYmd(today, timeZone);
  } else {
    startYmd = startOfMonthYmd(today);
  }
  return {
    receivedAfter: zonedStartOfDay(startYmd, timeZone),
    receivedBefore: now,
  };
}

/** Same calendar bounds as Inbox, named for Task.sourceDate filtering. */
export function taskSourceDateRangeBounds(
  preset: InboxDateRangePreset,
  timeZone: string,
  now = new Date()
): { sourceAfter: Date; sourceBefore: Date } {
  const b = inboxDateRangeBounds(preset, timeZone, now);
  return { sourceAfter: b.receivedAfter, sourceBefore: b.receivedBefore };
}

/**
 * Canonical Task.sourceDate from an EmailMessage.
 * Prefer receivedAt (Inbox timeline); fall back to sentAt.
 */
export function resolveTaskSourceDate(message: {
  receivedAt?: Date | string | null;
  sentAt?: Date | string | null;
}): Date {
  const raw = message.receivedAt ?? message.sentAt;
  if (raw == null) return new Date();
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Parse an optional date for Prisma. Never returns an Invalid Date object.
 * Accepts Date | string | number; empty / malformed → null.
 * YYYY-MM-DD strings become UTC midnight (matches n8n ingest).
 */
export function safeDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Task.dueAt persistence boundary: valid Date or null.
 * Logs a compact warning when a non-empty raw value cannot be parsed.
 * Does not invent dueAt from sourceDate / email receivedAt.
 */
export function normalizeTaskDueAt(
  raw: unknown,
  context?: { emailMessageId?: string }
): Date | null {
  if (raw == null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;

  const date = safeDateOrNull(raw);
  if (date) return date;

  const rawDueAt =
    typeof raw === "string"
      ? raw.trim().slice(0, 80)
      : raw instanceof Date
        ? "Invalid Date"
        : String(raw).slice(0, 80);

  console.warn(
    JSON.stringify({
      event: "task-invalid-due-date",
      ...(context?.emailMessageId
        ? { emailMessageId: context.emailMessageId }
        : {}),
      rawDueAt,
    })
  );
  return null;
}

/**
 * Cutoff for task bulk delete: delete where sourceDate < start of `beforeYmd` in `timeZone`.
 * Tasks on `beforeYmd` and later are kept.
 */
export function taskBulkDeleteCutoff(
  beforeYmd: string,
  timeZone: string
): Date {
  return zonedStartOfDay(beforeYmd, timeZone);
}
