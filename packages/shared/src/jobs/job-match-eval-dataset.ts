/**
 * Pure dataset selection helpers for Job Matcher historical evaluation UI.
 * Selected Jobs filter ground-truth emails only — never matcher candidates.
 */

import {
  classifyHistoricalEvalOutcome,
  type HistoricalEvalEmail,
  type HistoricalEvalOutcome,
} from "./job-match-historical-eval.js";
import type { JobRecordForMatch } from "./job-matcher.js";

/** Soft sync ceiling — larger runs should use sampling, not unbounded HTTP. */
export const JOB_MATCHER_EVAL_MAX_SYNC = 1000;

export const JOB_MATCHER_EVAL_TOTAL_PRESETS = [25, 50, 100, 250, 500, 1000] as const;
export const JOB_MATCHER_EVAL_PER_JOB_PRESETS = [5, 10, 25, 50, 100] as const;

export type JobMatcherEvalJobsMode = "ALL" | "SPECIFIC" | "SELECTED";
export type JobMatcherEvalSampling = "TOTAL" | "PER_JOB" | "ALL_ELIGIBLE";
export type JobMatcherEvalLifecycle = "ALL" | "CURRENT" | "ARCHIVED";

/** Statuses treated as archived/historical for dataset Job lifecycle filter. */
export const JOB_MATCHER_EVAL_ARCHIVED_STATUSES = [
  "ARCHIVED",
  "COMPLETE",
  "COMPLETED",
  "CANCELLED",
] as const;

export type JobMatcherEvalDatasetSpec = {
  jobsMode: JobMatcherEvalJobsMode;
  /** Required for SPECIFIC / SELECTED. Ignored for ALL. */
  jobIds: string[];
  sampling: JobMatcherEvalSampling;
  /** TOTAL or PER_JOB count. Ignored for ALL_ELIGIBLE. */
  count: number | null;
  jobLifecycle: JobMatcherEvalLifecycle;
};

export type EligibleEmailIndexRow = {
  id: string;
  jobId: string;
};

export type JobMatcherEvalJobBreakdown = {
  jobId: string;
  jobNumber: string | null;
  jobName: string;
  jobStatus: string | null;
  evaluated: number;
  correct: number;
  wrong: number;
  ambiguous: number;
  conflict: number;
  noMatch: number;
};

export function isArchivedLikeJobStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (JOB_MATCHER_EVAL_ARCHIVED_STATUSES as readonly string[]).includes(status);
}

export function jobPassesLifecycleFilter(
  status: string | null | undefined,
  lifecycle: JobMatcherEvalLifecycle
): boolean {
  if (lifecycle === "ALL") return true;
  const archived = isArchivedLikeJobStatus(status);
  if (lifecycle === "ARCHIVED") return archived;
  return !archived;
}

export function validateJobMatcherEvalDatasetSpec(
  spec: JobMatcherEvalDatasetSpec
): string | null {
  if (spec.jobsMode === "SPECIFIC") {
    if (spec.jobIds.length !== 1) return "SPECIFIC mode requires exactly one jobId";
  } else if (spec.jobsMode === "SELECTED") {
    if (spec.jobIds.length < 1) return "SELECTED mode requires at least one jobId";
  } else if (spec.jobIds.length > 0) {
    return "ALL mode must not include jobIds";
  }

  if (spec.sampling === "ALL_ELIGIBLE") {
    if (spec.count != null) return "ALL_ELIGIBLE must not include count";
  } else {
    if (spec.count == null || !Number.isInteger(spec.count) || spec.count < 1) {
      return "count must be a positive integer";
    }
    if (spec.sampling === "TOTAL" && spec.count > JOB_MATCHER_EVAL_MAX_SYNC) {
      return `TOTAL count cannot exceed ${JOB_MATCHER_EVAL_MAX_SYNC}`;
    }
    if (spec.sampling === "PER_JOB" && spec.count > 100) {
      return "PER_JOB count cannot exceed 100";
    }
  }
  return null;
}

/**
 * Deterministic sample: emails ordered by id ascending within each Job,
 * then selection rules applied. Never duplicates.
 */
export function selectEvalEmailIds(input: {
  emails: EligibleEmailIndexRow[];
  /** jobId → status for lifecycle filtering when jobs are not pre-filtered. */
  jobStatusById: Map<string, string | null | undefined>;
  spec: JobMatcherEvalDatasetSpec;
  maxSync?: number;
}): {
  selectedIds: string[];
  eligibleCount: number;
  jobsInScope: number;
  expectedMax: number;
  capped: boolean;
  capReason: string | null;
} {
  const maxSync = input.maxSync ?? JOB_MATCHER_EVAL_MAX_SYNC;
  const scopedJobIds =
    input.spec.jobsMode === "ALL"
      ? null
      : new Set(input.spec.jobIds);

  const byJob = new Map<string, string[]>();
  for (const row of input.emails) {
    if (scopedJobIds && !scopedJobIds.has(row.jobId)) continue;
    if (
      !jobPassesLifecycleFilter(
        input.jobStatusById.get(row.jobId) ?? null,
        input.spec.jobLifecycle
      )
    ) {
      continue;
    }
    const list = byJob.get(row.jobId) ?? [];
    list.push(row.id);
    byJob.set(row.jobId, list);
  }

  for (const [jobId, ids] of byJob) {
    ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    byJob.set(jobId, ids);
  }

  const jobIds = [...byJob.keys()].sort();
  const eligibleCount = jobIds.reduce((n, id) => n + (byJob.get(id)?.length ?? 0), 0);
  const jobsInScope = jobIds.length;

  let selected: string[] = [];
  let capped = false;
  let capReason: string | null = null;

  if (input.spec.sampling === "PER_JOB") {
    const per = input.spec.count ?? 0;
    for (const jobId of jobIds) {
      selected.push(...(byJob.get(jobId) ?? []).slice(0, per));
    }
    if (selected.length > maxSync) {
      selected = selected.slice(0, maxSync);
      capped = true;
      capReason = `Capped at ${maxSync} emails for synchronous evaluation`;
    }
  } else if (input.spec.sampling === "ALL_ELIGIBLE") {
    for (const jobId of jobIds) {
      selected.push(...(byJob.get(jobId) ?? []));
    }
    if (selected.length > maxSync) {
      selected = selected.slice(0, maxSync);
      capped = true;
      capReason = `ALL_ELIGIBLE exceeds sync max ${maxSync}; evaluate a sample or raise ops queue work`;
    }
  } else {
    // TOTAL — round-robin across Jobs so large Jobs do not dominate.
    const per = input.spec.count ?? 0;
    const target = Math.min(per, maxSync, eligibleCount);
    if (per > maxSync) {
      capped = true;
      capReason = `Capped at ${maxSync} emails for synchronous evaluation`;
    }
    const cursors = new Map(jobIds.map((id) => [id, 0]));
    while (selected.length < target) {
      let progressed = false;
      for (const jobId of jobIds) {
        if (selected.length >= target) break;
        const ids = byJob.get(jobId) ?? [];
        const i = cursors.get(jobId) ?? 0;
        if (i >= ids.length) continue;
        selected.push(ids[i]!);
        cursors.set(jobId, i + 1);
        progressed = true;
      }
      if (!progressed) break;
    }
  }

  const expectedMax =
    input.spec.sampling === "PER_JOB"
      ? Math.min(jobsInScope * (input.spec.count ?? 0), maxSync, eligibleCount)
      : input.spec.sampling === "ALL_ELIGIBLE"
        ? Math.min(eligibleCount, maxSync)
        : Math.min(input.spec.count ?? 0, maxSync, eligibleCount);

  return {
    selectedIds: selected,
    eligibleCount,
    jobsInScope,
    expectedMax,
    capped,
    capReason,
  };
}

export function buildJobMatcherEvalJobBreakdown(
  rows: HistoricalEvalEmail[],
  jobsById: Map<string, JobRecordForMatch>
): JobMatcherEvalJobBreakdown[] {
  const buckets = new Map<
    string,
    {
      evaluated: number;
      correct: number;
      wrong: number;
      ambiguous: number;
      conflict: number;
      noMatch: number;
    }
  >();

  for (const row of rows) {
    const b = buckets.get(row.trueJobId) ?? {
      evaluated: 0,
      correct: 0,
      wrong: 0,
      ambiguous: 0,
      conflict: 0,
      noMatch: 0,
    };
    b.evaluated += 1;
    const outcome: HistoricalEvalOutcome = classifyHistoricalEvalOutcome(row);
    if (outcome === "CORRECT_MATCH") b.correct += 1;
    else if (outcome === "WRONG_MATCH") b.wrong += 1;
    else if (outcome === "AMBIGUOUS") b.ambiguous += 1;
    else if (outcome === "CONFLICT") b.conflict += 1;
    else b.noMatch += 1;
    buckets.set(row.trueJobId, b);
  }

  return [...buckets.entries()]
    .map(([jobId, b]) => {
      const job = jobsById.get(jobId);
      return {
        jobId,
        jobNumber: job?.jobNumber ?? null,
        jobName: job?.name ?? "(missing Job)",
        jobStatus: job?.status ?? null,
        ...b,
      };
    })
    .sort((a, b) => a.jobName.localeCompare(b.jobName));
}

export function summarizeDatasetSpec(spec: JobMatcherEvalDatasetSpec): string {
  const jobs =
    spec.jobsMode === "ALL"
      ? "All Jobs"
      : spec.jobsMode === "SPECIFIC"
        ? `1 Job`
        : `${spec.jobIds.length} selected Jobs`;
  const sampling =
    spec.sampling === "ALL_ELIGIBLE"
      ? "All eligible"
      : spec.sampling === "PER_JOB"
        ? `${spec.count} emails per Job`
        : `${spec.count} emails total`;
  const life =
    spec.jobLifecycle === "ALL"
      ? "Current + Archived"
      : spec.jobLifecycle === "CURRENT"
        ? "Current only"
        : "Archived only";
  return `${jobs} · ${sampling} · ${life}`;
}
