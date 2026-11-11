/**
 * Workspace-scoped, read-only Job Matcher historical evaluation for Intelligence UI.
 * Reuses the same snapshot/eval helpers as the Railway CLI. Never persists matches.
 *
 * Dataset modes filter ground-truth emails only — selected Job IDs are never passed
 * into the matcher as target leakage.
 */
import {
  JobMatcherService,
  aggregateHistoricalEvalResults,
  assertTransitionsReconcile,
  buildIdentityCompareReport,
  buildJobMatcherEvalDiagnostics,
  buildJobMatcherEvalJobBreakdown,
  buildWrongMatchDetails,
  classifyHistoricalEvalOutcome,
  classifyMatcherTransition,
  createJobMatchEvalLoaderFromSnapshot,
  isHistoricalEvalGroundTruth,
  isJobMatcherAutoAssignEnabled,
  resolvingMarkerForResult,
  jobPassesLifecycleFilter,
  selectEvalEmailIds,
  summarizeDatasetSpec,
  validateJobMatcherEvalDatasetSpec,
  type EvalRowDiagnostics,
  type HistoricalEvalEmail,
  type HistoricalEvalMetrics,
  type HistoricalEvalWrongDetail,
  type IdentityCompareReport,
  type IdentityCompareRow,
  type JobMatchIdentityPolicy,
  type JobMatcherEvalDiagnostics,
  type JobMatcherEvalDatasetSpec,
  type JobMatcherEvalJobBreakdown,
  type JobMatcherEvalJobsMode,
  type JobMatcherEvalLifecycle,
  type JobMatcherEvalSampling,
  type JobMatchResult,
  JOB_MATCHER_EVAL_MAX_SYNC,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";
import {
  findEvalWorkspace,
  loadAuthoritativeEvalEmailIndex,
  loadHistoricalEvalDatasetSummary,
  loadHistoricalEvalEmailsByIds,
  loadJobMatchEvalSnapshot,
  loadWorkspaceJobsForEval,
} from "./job-match-eval-read.js";

export type JobMatcherEvalRow = {
  emailMessageId: string;
  subject: string | null;
  direction: string | null;
  trueJobId: string;
  trueJobName: string;
  trueJobNumber: string | null;
  jobAssignmentSource: string | null;
  predictedJobId: string | null;
  predictedJobName: string | null;
  predictedJobNumber: string | null;
  decision: string;
  outcome: string;
  resolvingMarker: string | null;
  evidence: Array<{ type: string; value: string }>;
  markerTrace: Array<{
    marker: string;
    status: string;
    candidateJobIds: string[];
    candidateJobNames: string[];
  }>;
  identityPolicy?: JobMatchIdentityPolicy;
  identityDiagnostics?: JobMatchResult["identityDiagnostics"];
  /** Deterministic diagnostics derived after matcher execution. */
  diagnostics: EvalRowDiagnostics;
};

export type JobMatcherHistoricalEvalResult = {
  intelligenceId: "job-matcher";
  databaseWrites: "NONE";
  autoAssignEnabled: boolean;
  identityPolicy: JobMatchIdentityPolicy;
  dataset: {
    spec: JobMatcherEvalDatasetSpec;
    summaryLabel: string;
    eligibleCount: number;
    jobsInScope: number;
    expectedMax: number;
    sampleSizeRequested: number | null;
    actualEvaluated: number;
    capped: boolean;
    capReason: string | null;
    selectedEmailIds: string[];
    workspaceSummary: Awaited<ReturnType<typeof loadHistoricalEvalDatasetSummary>>;
  };
  metrics: HistoricalEvalMetrics;
  diagnostics: JobMatcherEvalDiagnostics;
  jobBreakdown: JobMatcherEvalJobBreakdown[];
  rows: JobMatcherEvalRow[];
  wrongMatches: HistoricalEvalWrongDetail[];
  /** Present when compareWithIdentityPolicy was requested. Same email IDs / snapshot. */
  comparison: IdentityCompareReport | null;
  runtimeMs: number;
  groundTruthQuality: "MODERATE";
  groundTruthNotes: string;
};

export type JobMatcherEvalDatasetPreview = {
  spec: JobMatcherEvalDatasetSpec;
  summaryLabel: string;
  eligibleCount: number;
  jobsInScope: number;
  expectedMax: number;
  capped: boolean;
  capReason: string | null;
  jobs: Array<{
    id: string;
    name: string;
    jobNumber: string | null;
    status: string;
    eligibleEmailCount: number;
  }>;
  groundTruth: string;
};

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        out[index] = await fn(items[index]!);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

export type JobMatcherEvalDatasetInput = {
  jobsMode?: JobMatcherEvalJobsMode;
  jobIds?: string[];
  sampling?: JobMatcherEvalSampling;
  count?: number | null;
  jobLifecycle?: JobMatcherEvalLifecycle;
  /** Back-compat with V1 UI. */
  limit?: number;
};

function normalizeSpec(input: JobMatcherEvalDatasetInput): JobMatcherEvalDatasetSpec {
  if (input.jobsMode && input.sampling) {
    return {
      jobsMode: input.jobsMode,
      jobIds: input.jobIds ?? [],
      sampling: input.sampling,
      count: input.sampling === "ALL_ELIGIBLE" ? null : (input.count ?? null),
      jobLifecycle: input.jobLifecycle ?? "ALL",
    };
  }
  // Legacy: { limit: 50|100|500 } → ALL Jobs TOTAL sample
  const limit = input.limit ?? 50;
  return {
    jobsMode: "ALL",
    jobIds: [],
    sampling: "TOTAL",
    count: limit,
    jobLifecycle: "ALL",
  };
}

export async function previewJobMatcherEvalDataset(input: {
  prisma: PrismaClient;
  workspaceId: string;
  spec: JobMatcherEvalDatasetInput;
}): Promise<JobMatcherEvalDatasetPreview> {
  const spec = normalizeSpec(input.spec);
  const invalid = validateJobMatcherEvalDatasetSpec(spec);
  if (invalid) throw new Error(invalid);

  const workspace = await findEvalWorkspace(input.prisma, input.workspaceId);
  if (!workspace) throw new Error("Workspace not found");

  const [index, jobs] = await Promise.all([
    loadAuthoritativeEvalEmailIndex(input.prisma, input.workspaceId),
    loadWorkspaceJobsForEval(input.prisma, input.workspaceId),
  ]);
  const jobStatusById = new Map(jobs.map((j) => [j.id, j.status]));
  const selection = selectEvalEmailIds({
    emails: index,
    jobStatusById,
    spec,
  });

  const eligibleByJob = new Map<string, number>();
  for (const row of index) {
    if (spec.jobsMode !== "ALL" && !spec.jobIds.includes(row.jobId)) continue;
    if (!jobPassesLifecycleFilter(jobStatusById.get(row.jobId) ?? null, spec.jobLifecycle)) {
      continue;
    }
    eligibleByJob.set(row.jobId, (eligibleByJob.get(row.jobId) ?? 0) + 1);
  }

  const scopedJobs =
    spec.jobsMode === "ALL"
      ? jobs.filter((j) => (eligibleByJob.get(j.id) ?? 0) > 0)
      : jobs.filter((j) => spec.jobIds.includes(j.id));

  return {
    spec,
    summaryLabel: summarizeDatasetSpec(spec),
    eligibleCount: selection.eligibleCount,
    jobsInScope: selection.jobsInScope,
    expectedMax: selection.expectedMax,
    capped: selection.capped,
    capReason: selection.capReason,
    jobs: scopedJobs
      .map((j) => ({
        id: j.id,
        name: j.name,
        jobNumber: j.jobNumber,
        status: j.status,
        eligibleEmailCount: eligibleByJob.get(j.id) ?? 0,
      }))
      .filter((j) => j.eligibleEmailCount > 0 || spec.jobsMode !== "ALL")
      .sort((a, b) => a.name.localeCompare(b.name)),
    groundTruth: "USER_ASSIGNED + VERIFIED_PROJECT_FOLDER (authoritative; JOB_NUMBER_MATCH excluded)",
  };
}

function sideSummaryFromEval(
  row: HistoricalEvalEmail,
  jobsById: Map<string, { name: string }>
): IdentityCompareRow["baseline"] {
  const outcome = classifyHistoricalEvalOutcome(row);
  const predicted = row.result.selectedJobId
    ? jobsById.get(row.result.selectedJobId)
    : undefined;
  const diag = row.result.identityDiagnostics;
  return {
    decision: row.result.decision ?? "NO_MATCH",
    outcome,
    predictedJobId: row.result.selectedJobId,
    predictedJobName: predicted?.name ?? null,
    resolvingMarker: resolvingMarkerForResult(row.result),
    evidence: row.result.evidence.map((e) => ({ type: e.type, value: e.value })),
    identityDiagnostics: diag
      ? {
          identityStrength: diag.identityStrength,
          matchedPhrase: diag.matchedPhrase,
          matchedTerms: diag.matchedTerms,
          weakTerms: diag.weakTerms,
          reason: diag.reason,
          resolutionAllowed: diag.resolutionAllowed,
          strongIdentityAnchor: diag.strongIdentityAnchor,
        }
      : null,
  };
}

function toEvalRows(input: {
  evaluated: HistoricalEvalEmail[];
  jobsById: Map<
    string,
    { name: string; jobNumber: string | null; status?: string | null }
  >;
  sourceById: Map<string, string | null>;
  identityPolicy: JobMatchIdentityPolicy;
}): { rows: JobMatcherEvalRow[]; diagnostics: JobMatcherEvalDiagnostics } {
  const baseRows = input.evaluated.map((row) => {
    const trueJob = input.jobsById.get(row.trueJobId);
    const predicted = row.result.selectedJobId
      ? input.jobsById.get(row.result.selectedJobId)
      : undefined;
    const outcome = classifyHistoricalEvalOutcome(row);
    return {
      emailMessageId: row.id,
      subject: row.subject,
      direction: row.direction,
      trueJobId: row.trueJobId,
      trueJobName: trueJob?.name ?? "(missing Job)",
      trueJobNumber: trueJob?.jobNumber ?? null,
      jobAssignmentSource: input.sourceById.get(row.id) ?? null,
      predictedJobId: row.result.selectedJobId,
      predictedJobName: predicted?.name ?? null,
      predictedJobNumber: predicted?.jobNumber ?? null,
      decision: row.result.decision ?? "NO_MATCH",
      outcome,
      resolvingMarker: resolvingMarkerForResult(row.result),
      evidence: row.result.evidence.map((e) => ({
        type: e.type,
        value: e.value,
      })),
      markerTrace: (row.result.markerTrace ?? []).map((t) => ({
        marker: t.marker,
        status: t.status,
        candidateJobIds: t.candidateJobIds,
        candidateJobNames: t.candidateJobIds.map(
          (id) => input.jobsById.get(id)?.name ?? id
        ),
      })),
      identityPolicy: input.identityPolicy,
      identityDiagnostics: row.result.identityDiagnostics,
    };
  });

  const { diagnostics, rowDiagnostics } =
    buildJobMatcherEvalDiagnostics(baseRows);
  const rows: JobMatcherEvalRow[] = baseRows.map((row) => ({
    ...row,
    diagnostics: rowDiagnostics[row.emailMessageId]!,
  }));
  return { rows, diagnostics };
}

export async function runJobMatcherHistoricalEval(input: {
  prisma: PrismaClient;
  workspaceId: string;
  /** V2 dataset builder. */
  dataset?: JobMatcherEvalDatasetInput;
  /** V1 back-compat. */
  limit?: number;
  maxWrongDetails?: number;
  /**
   * Identity policy for the primary evaluation result.
   * Default BASELINE — production matcher semantics.
   */
  identityPolicy?: JobMatchIdentityPolicy;
  /**
   * When set to CONTEXT_AWARE_V1, also score the same emails/snapshot with V1
   * and attach a paired comparison report. Primary metrics remain identityPolicy.
   */
  compareWithIdentityPolicy?: "CONTEXT_AWARE_V1";
}): Promise<JobMatcherHistoricalEvalResult> {
  const startedAt = Date.now();
  const identityPolicy: JobMatchIdentityPolicy =
    input.identityPolicy ?? "BASELINE";
  const compareWith = input.compareWithIdentityPolicy ?? null;

  const spec = normalizeSpec(
    input.dataset ?? (input.limit != null ? { limit: input.limit } : { limit: 50 })
  );
  const invalid = validateJobMatcherEvalDatasetSpec(spec);
  if (invalid) throw new Error(invalid);

  const workspace = await findEvalWorkspace(input.prisma, input.workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }

  const [workspaceSummary, index, jobs, snapshot] = await Promise.all([
    loadHistoricalEvalDatasetSummary(input.prisma, workspace),
    loadAuthoritativeEvalEmailIndex(input.prisma, input.workspaceId),
    loadWorkspaceJobsForEval(input.prisma, input.workspaceId),
    loadJobMatchEvalSnapshot(input.prisma, input.workspaceId),
  ]);

  if (spec.jobsMode !== "ALL") {
    for (const jobId of spec.jobIds) {
      if (!jobs.some((j) => j.id === jobId)) {
        throw new Error(`Job ${jobId} not found in workspace`);
      }
    }
  }

  const jobStatusById = new Map(jobs.map((j) => [j.id, j.status]));
  const selection = selectEvalEmailIds({
    emails: index,
    jobStatusById,
    spec,
  });

  if (spec.sampling === "ALL_ELIGIBLE" && selection.eligibleCount > JOB_MATCHER_EVAL_MAX_SYNC) {
    throw new Error(
      `ALL_ELIGIBLE has ${selection.eligibleCount} emails; sync max is ${JOB_MATCHER_EVAL_MAX_SYNC}. Use TOTAL or PER_JOB sampling.`
    );
  }

  const matcher = new JobMatcherService(
    createJobMatchEvalLoaderFromSnapshot(snapshot),
    null,
    { logCompletions: false }
  );
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));

  const emailRecords = await loadHistoricalEvalEmailsByIds(input.prisma, {
    workspaceId: input.workspaceId,
    ids: selection.selectedIds,
  });

  const sourceById = new Map(
    emailRecords.map((e) => [e.id, e.jobAssignmentSource] as const)
  );

  async function scoreEmails(
    policy: JobMatchIdentityPolicy
  ): Promise<{ evaluated: HistoricalEvalEmail[]; runtimeMs: number }> {
    const t0 = Date.now();
    const scored = await mapLimit(emailRecords, 2, async (email) => {
      if (!isHistoricalEvalGroundTruth(email)) {
        return null;
      }
      // Matcher must NOT receive trueJobId / selected Job as a hint.
      const result = await matcher.match({
        workspaceId: input.workspaceId,
        emailMessageId: email.id,
        inboxConnectionId: email.inboxConnectionId,
        subject: email.subject,
        cleanBody: email.cleanBody,
        senderEmail: email.senderEmail,
        providerThreadId: email.providerThreadId,
        eligibilityMode: "evaluation",
        identityPolicy: policy,
      });
      return {
        id: email.id,
        subject: email.subject,
        direction: email.direction,
        trueJobId: email.jobId,
        hasAttachments: email.hasAttachments,
        result,
      } satisfies HistoricalEvalEmail;
    });
    const evaluated: HistoricalEvalEmail[] = [];
    for (const row of scored) {
      if (row) evaluated.push(row);
    }
    return { evaluated, runtimeMs: Date.now() - t0 };
  }

  // When comparing, always run BASELINE then V1 on the same ordered email set.
  const primaryPolicy: JobMatchIdentityPolicy =
    compareWith != null ? "BASELINE" : identityPolicy;
  const primary = await scoreEmails(primaryPolicy);
  const evaluated = primary.evaluated;

  let comparison: IdentityCompareReport | null = null;
  if (compareWith === "CONTEXT_AWARE_V1") {
    const proposed = await scoreEmails("CONTEXT_AWARE_V1");
    const proposedById = new Map(proposed.evaluated.map((r) => [r.id, r]));
    const compareRows: IdentityCompareRow[] = [];
    for (const baselineRow of evaluated) {
      const proposedRow = proposedById.get(baselineRow.id);
      if (!proposedRow) continue;
      const baseline = sideSummaryFromEval(baselineRow, jobsById);
      const proposedSide = sideSummaryFromEval(proposedRow, jobsById);
      const transition = classifyMatcherTransition({
        baselineOutcome: baseline.outcome,
        proposedOutcome: proposedSide.outcome,
        baselinePredictedJobId: baseline.predictedJobId,
        proposedPredictedJobId: proposedSide.predictedJobId,
      });
      const groundTruthReviewFlag =
        proposedSide.outcome === "WRONG_MATCH" &&
        baseline.outcome === "WRONG_MATCH" &&
        proposedSide.predictedJobId !== null &&
        proposedSide.predictedJobId !== baselineRow.trueJobId;
      compareRows.push({
        emailMessageId: baselineRow.id,
        subject: baselineRow.subject,
        trueJobId: baselineRow.trueJobId,
        trueJobName: jobsById.get(baselineRow.trueJobId)?.name ?? "(missing Job)",
        groundTruthSource: sourceById.get(baselineRow.id) ?? null,
        baseline,
        proposed: proposedSide,
        transition,
        groundTruthReviewFlag,
      });
    }
    const report = buildIdentityCompareReport({
      baselineMetrics: aggregateHistoricalEvalResults(evaluated),
      proposedMetrics: aggregateHistoricalEvalResults(proposed.evaluated),
      rows: compareRows,
      runtimeMs: {
        baseline: primary.runtimeMs,
        proposed: proposed.runtimeMs,
      },
    });
    if (
      !assertTransitionsReconcile(report.transitions, compareRows.length)
    ) {
      throw new Error(
        `Comparison transition counts (${Object.values(report.transitions).reduce((a, b) => a + b, 0)}) do not equal evaluated (${compareRows.length})`
      );
    }
    comparison = report;
  }

  const metrics = aggregateHistoricalEvalResults(evaluated);
  const jobBreakdown = buildJobMatcherEvalJobBreakdown(evaluated, jobsById);
  const wrong = buildWrongMatchDetails({
    rows: evaluated,
    jobsById,
    maxWrongDetails: input.maxWrongDetails ?? 50,
  });
  const { rows, diagnostics } = toEvalRows({
    evaluated,
    jobsById,
    sourceById,
    identityPolicy: primaryPolicy,
  });

  return {
    intelligenceId: "job-matcher",
    databaseWrites: "NONE",
    autoAssignEnabled: isJobMatcherAutoAssignEnabled(),
    identityPolicy: primaryPolicy,
    dataset: {
      spec,
      summaryLabel: summarizeDatasetSpec(spec),
      eligibleCount: selection.eligibleCount,
      jobsInScope: selection.jobsInScope,
      expectedMax: selection.expectedMax,
      sampleSizeRequested: spec.count,
      actualEvaluated: evaluated.length,
      capped: selection.capped,
      capReason: selection.capReason,
      selectedEmailIds: selection.selectedIds,
      workspaceSummary,
    },
    metrics,
    diagnostics,
    jobBreakdown,
    rows,
    wrongMatches: wrong.details,
    comparison,
    runtimeMs: Date.now() - startedAt,
    groundTruthQuality: "MODERATE",
    groundTruthNotes:
      "Authoritative EmailMessage.jobId (USER_ASSIGNED / VERIFIED_PROJECT_FOLDER). Folder labels can be noisy. AI_* / JOB_NUMBER_MATCH / IMPORT excluded. Selected Job filters ground truth only — never matcher input. CONTEXT_AWARE_V1 is shadow-only until approved; production default remains BASELINE.",
  };
}
