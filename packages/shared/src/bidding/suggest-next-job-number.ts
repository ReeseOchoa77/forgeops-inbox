/**
 * Suggest the next Job.jobNumber for a workspace.
 * Suggestion only — does not reserve or create a Job.
 *
 * ============================================================
 * CANONICAL V1 NUMBERING RULE
 * ============================================================
 *
 * NEXT = highest valid CURRENT (non-archived) Job.jobNumber + 1
 *
 * Source of truth: Job rows with archivedAt IS NULL.
 *
 * - Archived Jobs (archivedAt set) do NOT participate in MAX.
 * - Archived Job numbers are reusable by new current Jobs.
 * - Hard-deleted Jobs are gone → they do NOT participate.
 * - Status COMPLETE / ACTIVE / BIDDING etc. still count when not archived.
 * - BidCandidate.proposedJobNumber and EntityAlias are ignored.
 *
 * Uniqueness (commit-time): among CURRENT / non-archived Jobs only.
 * An archived Job with jobNumber=1004 does NOT block creating current 1004.
 * Restoring an archived Job must check for a current collision first.
 *
 * Supported sequential formats (highest wins within its kind):
 * - Plain digits: "2148" → "2149"
 * - Year-prefix sequence: "26-200" → "26-201" (zero-padded to match width)
 *
 * Prefer year-prefix when any yy-seq numbers exist (shop convention).
 * Non-numeric / special values (e.g. "J-1000", "ALT-A") are ignored for max.
 */

export type ParsedSequentialJobNumber =
  | { kind: "plain"; value: number; raw: string }
  | { kind: "yy-seq"; year: number; seq: number; seqWidth: number; raw: string };

export function parseSequentialJobNumber(
  raw: string | null | undefined
): ParsedSequentialJobNumber | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^\d{1,8}$/.test(trimmed)) {
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return null;
    return { kind: "plain", value, raw: trimmed };
  }

  const yy = trimmed.match(/^(\d{2})-(\d{1,6})$/);
  if (yy?.[1] && yy[2]) {
    const year = Number(yy[1]);
    const seq = Number(yy[2]);
    if (!Number.isFinite(year) || !Number.isFinite(seq) || seq < 0) return null;
    return { kind: "yy-seq", year, seq, seqWidth: yy[2].length, raw: trimmed };
  }

  return null;
}

function compareYySeq(
  a: Extract<ParsedSequentialJobNumber, { kind: "yy-seq" }>,
  b: Extract<ParsedSequentialJobNumber, { kind: "yy-seq" }>
): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.seq - b.seq;
}

/**
 * Pure suggestion from an in-memory list of CURRENT Job.jobNumber values.
 * Pass only numbers from non-archived Job rows.
 */
export function suggestNextJobNumberFromList(
  jobNumbers: ReadonlyArray<string | null | undefined>
): string | null {
  const parsed = jobNumbers
    .map((n) => parseSequentialJobNumber(n))
    .filter((n): n is ParsedSequentialJobNumber => n != null);

  if (parsed.length === 0) return null;

  const yySeq = parsed.filter(
    (p): p is Extract<ParsedSequentialJobNumber, { kind: "yy-seq" }> =>
      p.kind === "yy-seq"
  );
  const plain = parsed.filter(
    (p): p is Extract<ParsedSequentialJobNumber, { kind: "plain" }> =>
      p.kind === "plain"
  );

  // Prefer year-prefix format when present (shop convention e.g. 26-200).
  if (yySeq.length > 0) {
    const max = yySeq.reduce((best, cur) =>
      compareYySeq(cur, best) > 0 ? cur : best
    );
    const nextSeq = max.seq + 1;
    const width = Math.max(max.seqWidth, String(nextSeq).length);
    return `${String(max.year).padStart(2, "0")}-${String(nextSeq).padStart(width, "0")}`;
  }

  if (plain.length > 0) {
    const max = plain.reduce((best, cur) => (cur.value > best.value ? cur : best));
    return String(max.value + 1);
  }

  return null;
}

/**
 * Prisma `where` for Job rows that participate in next-number MAX calculation.
 * Current = archivedAt IS NULL. Hard-deleted rows are absent.
 */
export function workspaceJobNumbersForSuggestionWhere(workspaceId: string): {
  workspaceId: string;
  archivedAt: null;
  AND: Array<{ jobNumber: { not: null } } | { jobNumber: { not: string } }>;
} {
  return {
    workspaceId,
    archivedAt: null,
    AND: [{ jobNumber: { not: null } }, { jobNumber: { not: "" } }],
  };
}

/**
 * Canonical collision predicate for Job numbers among CURRENT Jobs only.
 * Archived Jobs do not collide. Pass excludeJobId when editing / restoring.
 */
export function workspaceCurrentJobNumberCollisionWhere(input: {
  workspaceId: string;
  jobNumber: string;
  /** Exclude this Job id (edit self / restore self). */
  excludeJobId?: string | null;
}): {
  workspaceId: string;
  jobNumber: string;
  archivedAt: null;
  id?: { not: string };
} {
  const where: {
    workspaceId: string;
    jobNumber: string;
    archivedAt: null;
    id?: { not: string };
  } = {
    workspaceId: input.workspaceId,
    jobNumber: input.jobNumber,
    archivedAt: null,
  };
  if (input.excludeJobId) {
    where.id = { not: input.excludeJobId };
  }
  return where;
}
