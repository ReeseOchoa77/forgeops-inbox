/**
 * Pure before/after taxonomy evaluation metrics.
 * Does not call classifiers. Does not claim accuracy without ground truth.
 */

import { BUSINESS_SUBTYPE_KEYS } from "../business-subtypes.js";
import { SUBTYPE_TAXONOMY_EVAL_METHODOLOGY } from "./review-types.js";

export type TaxonomyEvalEmailRow = {
  emailMessageId: string;
  /** Current Classification.businessTypeKey */
  currentKey: string | null;
  /**
   * Independent GT when available (USER_EXPLICIT or human correction).
   * Null = no GT for this email.
   */
  groundTruthKey: string | null;
  /**
   * Simulated proposed assignment (e.g. discovery cluster → new subtype).
   * Null = unchanged from current.
   */
  proposedKey: string | null;
};

export type TaxonomySideMetrics = {
  emailsInDataset: number;
  labeledCount: number;
  unlabeledCount: number;
  /** labeledCount / emailsInDataset */
  coverage: number;
  otherBusinessCount: number;
  distribution: Record<string, number>;
  /** Only when GT present — fraction of GT emails where assignment === GT */
  groundTruthPrecision: number | null;
  groundTruthLabeled: number;
  ambiguousOrNullVsGt: number;
  confusion: Array<{ actual: string; predicted: string; count: number }>;
};

export type TaxonomyEvalMetrics = {
  current: TaxonomySideMetrics;
  proposed: TaxonomySideMetrics;
  delta: {
    coverage: number;
    otherBusinessCount: number;
    groundTruthPrecision: number | null;
    newlyMatchingGt: number;
    newlyMismatchingGt: number;
    assignmentChanges: number;
  };
  methodologyNotes: string;
  groundTruthQuality: "STRONG" | "MODERATE" | "WEAK" | "NONE";
};

export type TaxonomyEvalEmailChange = {
  emailMessageId: string;
  currentKey: string | null;
  proposedKey: string | null;
  groundTruthKey: string | null;
};

export function computeTaxonomyEvalMetrics(
  rows: TaxonomyEvalEmailRow[]
): {
  metrics: TaxonomyEvalMetrics;
  emailChanges: TaxonomyEvalEmailChange[];
} {
  const currentAssign = rows.map((r) => ({
    ...r,
    assigned: r.currentKey,
  }));
  const proposedAssign = rows.map((r) => ({
    ...r,
    assigned: r.proposedKey ?? r.currentKey,
  }));

  const current = sideMetrics(currentAssign);
  const proposed = sideMetrics(proposedAssign);

  let newlyMatchingGt = 0;
  let newlyMismatchingGt = 0;
  let assignmentChanges = 0;
  const emailChanges: TaxonomyEvalEmailChange[] = [];

  for (const r of rows) {
    const cur = r.currentKey;
    const prop = r.proposedKey ?? r.currentKey;
    if (cur !== prop) {
      assignmentChanges += 1;
      emailChanges.push({
        emailMessageId: r.emailMessageId,
        currentKey: cur,
        proposedKey: prop,
        groundTruthKey: r.groundTruthKey,
      });
    }
    if (r.groundTruthKey) {
      const wasMatch = cur === r.groundTruthKey;
      const nowMatch = prop === r.groundTruthKey;
      if (!wasMatch && nowMatch) newlyMatchingGt += 1;
      if (wasMatch && !nowMatch) newlyMismatchingGt += 1;
    }
  }

  const gtQuality =
    current.groundTruthLabeled === 0
      ? ("NONE" as const)
      : current.groundTruthLabeled >= 30
        ? ("MODERATE" as const)
        : ("WEAK" as const);

  return {
    metrics: {
      current,
      proposed,
      delta: {
        coverage: round4(proposed.coverage - current.coverage),
        otherBusinessCount: proposed.otherBusinessCount - current.otherBusinessCount,
        groundTruthPrecision:
          current.groundTruthPrecision == null || proposed.groundTruthPrecision == null
            ? null
            : round4(proposed.groundTruthPrecision - current.groundTruthPrecision),
        newlyMatchingGt,
        newlyMismatchingGt,
        assignmentChanges,
      },
      methodologyNotes: SUBTYPE_TAXONOMY_EVAL_METHODOLOGY,
      groundTruthQuality: gtQuality,
    },
    emailChanges,
  };
}

function sideMetrics(
  rows: Array<TaxonomyEvalEmailRow & { assigned: string | null }>
): TaxonomySideMetrics {
  const n = rows.length;
  const distribution: Record<string, number> = {};
  let labeled = 0;
  let other = 0;
  let gtLabeled = 0;
  let gtCorrect = 0;
  let ambiguousOrNullVsGt = 0;
  const confusionMap = new Map<string, number>();

  for (const r of rows) {
    if (r.assigned) {
      labeled += 1;
      distribution[r.assigned] = (distribution[r.assigned] ?? 0) + 1;
      if (r.assigned === "OTHER_BUSINESS") other += 1;
    }
    if (r.groundTruthKey) {
      gtLabeled += 1;
      const pred = r.assigned ?? "(unlabeled)";
      if (!r.assigned) ambiguousOrNullVsGt += 1;
      if (r.assigned === r.groundTruthKey) gtCorrect += 1;
      const key = `${r.groundTruthKey}→${pred}`;
      confusionMap.set(key, (confusionMap.get(key) ?? 0) + 1);
    }
  }

  const confusion = [...confusionMap.entries()]
    .map(([k, count]) => {
      const [actual, predicted] = k.split("→");
      return { actual: actual ?? "", predicted: predicted ?? "", count };
    })
    .sort((a, b) => b.count - a.count || a.actual.localeCompare(b.actual))
    .slice(0, 40);

  return {
    emailsInDataset: n,
    labeledCount: labeled,
    unlabeledCount: n - labeled,
    coverage: n === 0 ? 0 : round4(labeled / n),
    otherBusinessCount: other,
    distribution,
    groundTruthPrecision: gtLabeled === 0 ? null : round4(gtCorrect / gtLabeled),
    groundTruthLabeled: gtLabeled,
    ambiguousOrNullVsGt,
    confusion,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Known system + provided workspace keys — for duplicate checks. */
export function collectKnownSubtypeKeys(
  workspaceKeys: string[]
): Set<string> {
  return new Set<string>([
    ...(BUSINESS_SUBTYPE_KEYS as readonly string[]),
    ...workspaceKeys,
  ]);
}
