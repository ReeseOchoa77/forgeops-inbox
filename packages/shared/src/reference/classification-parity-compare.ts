/**
 * Pure comparison helpers for full native vs n8n classification parity.
 */

export type NumericParityComparison = {
  n8n: number;
  native: number;
  absoluteDifference: number;
};

export type ExactParityComparison<T> = {
  n8n: T;
  native: T;
  matches: boolean;
};

export type UnavailableParityComparison = {
  n8n: null;
  native: unknown;
  matches: null;
  unavailable: true;
};

export type ParityFieldComparison<T> =
  | ExactParityComparison<T>
  | UnavailableParityComparison;

export type ParityDiagnosticStatus =
  | "MATCH"
  | "SIGNAL_VARIANCE"
  | "SUBTYPE_MISMATCH"
  | "ENTITY_MISMATCH"
  | "TASK_MISMATCH"
  | "PRIORITY_MISMATCH"
  | "DECISION_MISMATCH"
  | "INSUFFICIENT_HISTORICAL_DATA";

export const SIGNAL_VARIANCE_THRESHOLD = 0.05;

export function compareNumeric(
  n8n: number | null,
  native: number
): NumericParityComparison | UnavailableParityComparison {
  if (n8n == null) {
    return { n8n: null, native, matches: null, unavailable: true };
  }
  return {
    n8n,
    native,
    absoluteDifference: Math.abs(n8n - native),
  };
}

export function compareExact<T>(
  n8n: T | null,
  native: T
): ParityFieldComparison<T> {
  if (n8n == null) {
    return { n8n: null, native, matches: null, unavailable: true };
  }
  return {
    n8n,
    native,
    matches: Object.is(n8n, native) || n8n === native,
  };
}

/**
 * Compare values where historical null is a real persisted value (e.g. Classification.customerId).
 */
export function compareNullableExact<T>(
  n8n: T | null,
  native: T | null,
  historicallyAvailable: boolean
): ParityFieldComparison<T | null> {
  if (!historicallyAvailable) {
    return { n8n: null, native, matches: null, unavailable: true };
  }
  return {
    n8n,
    native,
    matches: n8n === native,
  };
}

export function compareStringArrayExact(
  n8n: string[] | null,
  native: string[],
  historicallyAvailable: boolean
): ParityFieldComparison<string[]> {
  if (!historicallyAvailable || n8n == null) {
    return { n8n: null, native, matches: null, unavailable: true };
  }
  const left = [...n8n].map((s) => s.trim()).sort().join("\n");
  const right = [...native].map((s) => s.trim()).sort().join("\n");
  return { n8n, native, matches: left === right };
}

/** Summary is informational — never treated as a hard match requirement. */
export function compareSummarySideBySide(
  n8n: string | null,
  native: string
): {
  n8n: string | null;
  native: string;
  exactMatches: boolean | null;
  unavailable?: true;
} {
  if (n8n == null) {
    return { n8n: null, native, exactMatches: null, unavailable: true };
  }
  return { n8n, native, exactMatches: n8n === native };
}

export function normalizeTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface TaskParityRow {
  n8nTitle: string | null;
  nativeTitle: string | null;
  titleMatches: boolean | null;
  n8nDescription: string | null;
  nativeDescription: string | null;
  dueDate: ParityFieldComparison<string | null>;
  recommendedOwner: ParityFieldComparison<string | null>;
  confidence: NumericParityComparison | UnavailableParityComparison;
}

export function compareTaskLists(
  n8nTasks: Array<{
    title: string;
    description: string | null;
    dueDate: string | null;
    recommendedOwner: string | null;
    confidence: number | null;
  }> | null,
  nativeTasks: Array<{
    title: string;
    description: string;
    dueDate: string | null;
    recommendedOwner: string | null;
    confidence: number;
  }>
): {
  taskCount: ParityFieldComparison<number>;
  rows: TaskParityRow[];
  titleSetMatches: boolean | null;
} {
  if (n8nTasks == null) {
    return {
      taskCount: {
        n8n: null,
        native: nativeTasks.length,
        matches: null,
        unavailable: true,
      },
      rows: nativeTasks.map((t) => ({
        n8nTitle: null,
        nativeTitle: t.title,
        titleMatches: null,
        n8nDescription: null,
        nativeDescription: t.description,
        dueDate: {
          n8n: null,
          native: t.dueDate,
          matches: null,
          unavailable: true,
        },
        recommendedOwner: {
          n8n: null,
          native: t.recommendedOwner,
          matches: null,
          unavailable: true,
        },
        confidence: {
          n8n: null,
          native: t.confidence,
          matches: null,
          unavailable: true,
        },
      })),
      titleSetMatches: null,
    };
  }

  const taskCount = compareExact(n8nTasks.length, nativeTasks.length);
  const n8nNorm = n8nTasks.map((t) => normalizeTaskTitle(t.title));
  const nativeNorm = nativeTasks.map((t) => normalizeTaskTitle(t.title));
  const titleSetMatches =
    n8nNorm.length === nativeNorm.length &&
    [...n8nNorm].sort().join("|") === [...nativeNorm].sort().join("|");

  const max = Math.max(n8nTasks.length, nativeTasks.length);
  const usedNative = new Set<number>();
  const rows: TaskParityRow[] = [];

  for (let i = 0; i < max; i++) {
    const n8n = n8nTasks[i] ?? null;
    // Prefer same-index match; else best normalized title match
    let nativeIdx = i < nativeTasks.length ? i : -1;
    if (n8n && nativeIdx >= 0) {
      const want = normalizeTaskTitle(n8n.title);
      const exactIdx = nativeTasks.findIndex(
        (t, idx) => !usedNative.has(idx) && normalizeTaskTitle(t.title) === want
      );
      if (exactIdx >= 0) nativeIdx = exactIdx;
    }
    if (nativeIdx >= 0) usedNative.add(nativeIdx);
    const native = nativeIdx >= 0 ? nativeTasks[nativeIdx]! : null;

    rows.push({
      n8nTitle: n8n?.title ?? null,
      nativeTitle: native?.title ?? null,
      titleMatches:
        n8n && native
          ? normalizeTaskTitle(n8n.title) === normalizeTaskTitle(native.title)
          : null,
      n8nDescription: n8n?.description ?? null,
      nativeDescription: native?.description ?? null,
      // Null dueDate / owner are real persisted values when the n8n task exists.
      dueDate: n8n
        ? compareNullableExact(n8n.dueDate, native?.dueDate ?? null, true)
        : {
            n8n: null,
            native: native?.dueDate ?? null,
            matches: null,
            unavailable: true,
          },
      recommendedOwner: n8n
        ? compareNullableExact(
            n8n.recommendedOwner,
            native?.recommendedOwner ?? null,
            true
          )
        : {
            n8n: null,
            native: native?.recommendedOwner ?? null,
            matches: null,
            unavailable: true,
          },
      confidence: compareNumeric(
        n8n?.confidence ?? null,
        native?.confidence ?? 0
      ),
    });
  }

  return { taskCount, rows, titleSetMatches };
}

export function isUnavailable(
  value: ParityFieldComparison<unknown> | NumericParityComparison | UnavailableParityComparison
): boolean {
  return "unavailable" in value && value.unavailable === true;
}

export function isExactMismatch(
  value: ParityFieldComparison<unknown>
): boolean {
  return !isUnavailable(value) && "matches" in value && value.matches === false;
}

export function isNumericVariance(
  value: NumericParityComparison | UnavailableParityComparison,
  threshold = SIGNAL_VARIANCE_THRESHOLD
): boolean {
  return (
    !isUnavailable(value) &&
    "absoluteDifference" in value &&
    value.absoluteDifference > threshold
  );
}

export function buildParityDiagnostics(input: {
  hasMeaningfulComparisonBasis: boolean;
  mailboxCategoryMatches: boolean | null;
  decisionRuleMatches: boolean | null;
  signalVariance: boolean;
  subtypeMismatch: boolean;
  entityMismatch: boolean;
  taskMismatch: boolean;
  priorityMismatch: boolean;
}): ParityDiagnosticStatus[] {
  if (!input.hasMeaningfulComparisonBasis) {
    return ["INSUFFICIENT_HISTORICAL_DATA"];
  }

  const reasons: ParityDiagnosticStatus[] = [];
  if (input.mailboxCategoryMatches === false) reasons.push("DECISION_MISMATCH");
  if (input.subtypeMismatch) reasons.push("SUBTYPE_MISMATCH");
  if (input.entityMismatch) reasons.push("ENTITY_MISMATCH");
  if (input.taskMismatch) reasons.push("TASK_MISMATCH");
  if (input.priorityMismatch) reasons.push("PRIORITY_MISMATCH");
  if (input.signalVariance || input.decisionRuleMatches === false) {
    reasons.push("SIGNAL_VARIANCE");
  }

  if (reasons.length === 0) return ["MATCH"];
  return reasons;
}
