/**
 * Verified ground-truth corrections for Job Matcher evaluation.
 *
 * A correction says "the true Job for this email is X" (verified from a model
 * prediction). It changes the effective ground truth for EVERY model on that
 * email, never removes the email from the denominator, and never touches
 * production EmailMessage.jobId or Job Matcher policies.
 */

import type { HistoricalEvalOutcome } from "./job-match-historical-eval.js";
import {
  metricsFromOutcomeRows,
  type EvalOutcomeMetricsLite,
} from "./job-match-eval-exclusions.js";

export type GroundTruthCorrectionStatus = "ACTIVE" | "REVERSED";

/**
 * Re-score a single evaluation row against a (possibly corrected) true Job.
 * Mirrors classifyHistoricalEvalOutcome:
 *  - MATCH + same id  → CORRECT_MATCH
 *  - MATCH + other    → WRONG_MATCH
 *  - AMBIGUOUS / CONFLICT stay as named
 *  - anything else    → NO_MATCH
 */
export function reclassifyEvalRowAgainstTrueJob(input: {
  decision: string;
  predictedJobId: string | null;
  trueJobId: string;
}): HistoricalEvalOutcome {
  if (input.decision === "MATCH") {
    return input.predictedJobId !== null &&
      input.predictedJobId === input.trueJobId
      ? "CORRECT_MATCH"
      : "WRONG_MATCH";
  }
  if (input.decision === "AMBIGUOUS") return "AMBIGUOUS";
  if (input.decision === "CONFLICT") return "CONFLICT";
  return "NO_MATCH";
}

export type GroundTruthCorrectionApply = {
  emailMessageId: string;
  originalGroundTruthJobId: string;
  correctedGroundTruthJobId: string;
  correctedJobName?: string | null;
  correctedJobNumber?: string | null;
  verificationStatus: GroundTruthCorrectionStatus;
  verifiedAt?: string | null;
  verifiedByUserId?: string | null;
  sourceEvaluationRunId?: string | null;
  sourceModelPolicy?: string | null;
  note?: string | null;
};

export type GroundTruthCorrectableRow = {
  emailMessageId: string;
  trueJobId: string;
  trueJobName?: string;
  trueJobNumber?: string | null;
  predictedJobId: string | null;
  predictedJobName?: string | null;
  predictedJobNumber?: string | null;
  decision: string;
  outcome: string;
};

export type GroundTruthCorrectedRow<T> = T & {
  /** Ground truth as stored in the evaluation run (before any correction). */
  originalTrueJobId: string;
  groundTruthCorrected: boolean;
  /** Ground truth used for scoring (== trueJobId on the returned row). */
  effectiveTrueJobId: string;
};

/** Index ACTIVE corrections by email id (REVERSED ignored; latest ACTIVE wins). */
export function activeCorrectionsByEmail<
  C extends Pick<
    GroundTruthCorrectionApply,
    "emailMessageId" | "verificationStatus"
  >,
>(corrections: ReadonlyArray<C>): Map<string, C> {
  const map = new Map<string, C>();
  for (const c of corrections) {
    if (c.verificationStatus !== "ACTIVE") continue;
    map.set(c.emailMessageId, c);
  }
  return map;
}

/**
 * Apply ACTIVE corrections: rewrite trueJob* and outcome per row.
 * Row count is never reduced; each row keeps its own decision / prediction.
 */
export function applyGroundTruthCorrectionsToRows<
  T extends GroundTruthCorrectableRow,
>(
  rows: ReadonlyArray<T>,
  corrections: ReadonlyArray<GroundTruthCorrectionApply>
): Array<GroundTruthCorrectedRow<T>> {
  const active = activeCorrectionsByEmail(corrections);
  return rows.map((row) => {
    const correction = active.get(row.emailMessageId);
    if (!correction) {
      return {
        ...row,
        originalTrueJobId: row.trueJobId,
        groundTruthCorrected: false,
        effectiveTrueJobId: row.trueJobId,
      };
    }
    const correctedId = correction.correctedGroundTruthJobId;
    const predictedMatchesCorrected = row.predictedJobId === correctedId;
    const trueJobName =
      correction.correctedJobName ??
      (predictedMatchesCorrected ? row.predictedJobName : null) ??
      correctedId;
    const trueJobNumber =
      correction.correctedJobNumber ??
      (predictedMatchesCorrected ? row.predictedJobNumber : null) ??
      null;
    return {
      ...row,
      trueJobId: correctedId,
      trueJobName,
      trueJobNumber,
      outcome: reclassifyEvalRowAgainstTrueJob({
        decision: row.decision,
        predictedJobId: row.predictedJobId,
        trueJobId: correctedId,
      }),
      originalTrueJobId: row.trueJobId,
      groundTruthCorrected: true,
      effectiveTrueJobId: correctedId,
    };
  });
}

export function metricsWithGroundTruthCorrections<
  T extends GroundTruthCorrectableRow,
>(
  rows: ReadonlyArray<T>,
  corrections: ReadonlyArray<GroundTruthCorrectionApply>
): {
  originalMetrics: EvalOutcomeMetricsLite;
  correctedMetrics: EvalOutcomeMetricsLite;
  correctedRows: Array<GroundTruthCorrectedRow<T>>;
  correctionCount: number;
} {
  const correctedRows = applyGroundTruthCorrectionsToRows(rows, corrections);
  return {
    originalMetrics: metricsFromOutcomeRows(rows),
    correctedMetrics: metricsFromOutcomeRows(correctedRows),
    correctedRows,
    correctionCount: correctedRows.filter((r) => r.groundTruthCorrected).length,
  };
}
