/**
 * Suggest the next Job.jobNumber for a workspace.
 * Suggestion only — does not reserve or create a Job.
 *
 * ============================================================
 * CANONICAL V1 NUMBERING RULE
 * ============================================================
 *
 * NEXT = highest valid CURRENTLY EXISTING Job.jobNumber + 1
 *
 * Source of truth: the current Job table only.
 *
 * - Hard-deleted Jobs are gone → they do NOT reserve numbers.
 *   Example: existing 3000,3001,3002 → delete 3002 → suggest 3002.
 * - Deleting a non-max Job does NOT fill internal gaps.
 *   Example: 3000..3003, delete 3001 → still suggest 3004.
 * - Archived Jobs still EXIST → they count toward the maximum.
 * - Status does not matter (LEAD / BIDDING / ACTIVE / ARCHIVED / …).
 *
 * Do NOT use AuditEvent, JobActivityLog, EntityAlias history, email history,
 * AI, or any cached historical maximum as a numbering floor.
 *
 * Supported sequential formats (highest wins within its kind):
 * - Plain digits: "2148" → "2149"
 * - Year-prefix sequence: "26-200" → "26-201" (zero-padded to match width)
 *
 * Prefer year-prefix when any yy-seq numbers exist (shop convention).
 * Non-numeric / special values (e.g. "J-1000", "ALT-A") are ignored for max.
 *
 * Callers must pass job numbers from currently existing Job rows only
 * (all statuses / archived included; hard-deleted absent).
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
 * Pass only numbers from existing Job rows (post-delete list excludes deleted).
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
 * Prisma `where` for Job rows that participate in next-number suggestion.
 * No archivedAt / status filter — existence only. Hard-deleted rows are absent.
 */
export function workspaceJobNumbersForSuggestionWhere(workspaceId: string): {
  workspaceId: string;
  AND: Array<{ jobNumber: { not: null } } | { jobNumber: { not: string } }>;
} {
  return {
    workspaceId,
    AND: [{ jobNumber: { not: null } }, { jobNumber: { not: "" } }],
  };
}
