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
  buildIdentityMultiPolicyCompareReport,
  buildIdentityMultiPolicyCompareRow,
  buildIdentityV2FamilyCompareReport,
  buildV2FamilyCompareRow,
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
  normalizeEvalIdentityPolicies,
  pickCompareBaselinePolicy,
  selectEvalEmailIds,
  summarizeDatasetSpec,
  validateJobMatcherEvalDatasetSpec,
  type EvalRowDiagnostics,
  type HistoricalEvalEmail,
  type HistoricalEvalMetrics,
  type HistoricalEvalWrongDetail,
  type IdentityCompareReport,
  type IdentityCompareRow,
  type IdentityMultiPolicyCompareReport,
  type IdentityThreeWayCompareReport,
  type IdentityV2FamilyCompareReport,
  type JobMatchIdentityPolicy,
  type JobMatcherEvalDiagnostics,
  type JobMatcherEvalDatasetSpec,
  type JobMatcherEvalJobBreakdown,
  type JobMatcherEvalJobsMode,
  type JobMatcherEvalLifecycle,
  type JobMatcherEvalSampling,
  type JobMatchResult,
  JOB_MATCHER_EVAL_LOAD_BATCH_SIZE,
  assertExportRowsMatchMetrics,
  DEFAULT_JOB_MATCH_IDENTITY_POLICY,
  JOB_MATCH_IDENTITY_EXPERIMENT_REVISION,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_5,
  experimentRevisionForIdentityPolicy,
  jobMatchPolicyAdvanceRank,
  selectDisplayMetricsForEvaluation,
} from "@forgeops/shared";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  findEvalWorkspace,
  loadAuthoritativeEvalEmailIndex,
  loadHistoricalEvalDatasetSummary,
  loadEvalAttachmentsByEmailIds,
  loadHistoricalEvalEmailsByIds,
  loadJobMatchEvalSnapshot,
  loadWorkspaceJobsForEval,
} from "./job-match-eval-read.js";
import {
  completeJobMatcherEvalProgress,
  failJobMatcherEvalProgress,
  startJobMatcherEvalProgress,
  updateJobMatcherEvalProgress,
} from "./job-matcher-eval-progress.js";

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

export type JobMatcherEvalPolicyResultBundle = {
  identityPolicy: JobMatchIdentityPolicy;
  /**
   * Experiment implementation revision when this policy was scored.
   * Absent/undefined on legacy runs that used older V2.1/V2.2 algorithms.
   */
  experimentRevision: string | null;
  metrics: HistoricalEvalMetrics;
  diagnostics: JobMatcherEvalDiagnostics;
  jobBreakdown: JobMatcherEvalJobBreakdown[];
  rows: JobMatcherEvalRow[];
  wrongMatches: HistoricalEvalWrongDetail[];
};

export type JobMatcherHistoricalEvalResult = {
  intelligenceId: "job-matcher";
  databaseWrites: "NONE";
  autoAssignEnabled: boolean;
  /** Stable id for this evaluation run (exports / progress). */
  evaluationRunId: string;
  identityPolicy: JobMatchIdentityPolicy;
  /**
   * Current experiment implementation revision stamped on this run.
   * Legacy persisted/cached results may omit this — do not treat those V2.1/V2.2
   * rows as the independent title-gap / unique-token experiments.
   */
  experimentRevision: string;
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
  /** Present when paired compare was requested. Same email IDs / snapshot. */
  comparison: IdentityCompareReport | null;
  /** Present when legacy BASELINE/V1/V2(+V2.1) three-way compare was requested. */
  threeWayComparison: IdentityThreeWayCompareReport | null;
  /**
   * Present when Compare All (V2 / V2.1 / V2.2) was requested (legacy).
   * Same email IDs / snapshot / eligibility for every policy.
   */
  v2FamilyComparison: IdentityV2FamilyCompareReport | null;
  /**
   * Dynamic N-policy comparison for arbitrary selected models (preferred).
   * Absent on single-policy runs and some legacy persisted results.
   */
  multiPolicyComparison: IdentityMultiPolicyCompareReport | null;
  /** Policies requested for this run (validated / deduped). */
  selectedIdentityPolicies: JobMatchIdentityPolicy[];
  /** SINGLE = one policy; COMPARE = two or more on the same dataset. */
  evaluationSelectionMode: "SINGLE" | "COMPARE";
  /**
   * Metrics + rows for the primary Evaluation cards / email list / detailed export —
   * most advanced policy present in this completed evaluation (registry rank).
   * Never mixes policies. Must reconcile with displayRows aggregates.
   */
  displayIdentityPolicy: JobMatchIdentityPolicy;
  displayMetrics: HistoricalEvalMetrics;
  /**
   * Full per-policy metrics + email rows for every policy scored in this run.
   * Powers the evaluation dashboard matcher selector without re-running eval.
   * Same email IDs / snapshot for every entry.
   */
  policyResults: JobMatcherEvalPolicyResultBundle[];
  /** Same evaluation run fingerprint (sorted selected email ids). */
  datasetFingerprint: string;
  runtimeMs: number;
  groundTruthQuality: "MODERATE";
  groundTruthNotes: string;
};

export type JobMatcherEvalDatasetPreview = {
  spec: JobMatcherEvalDatasetSpec;
  summaryLabel: string;
  /** Workspace-wide email count (all emails, not just eligible). */
  workspaceTotalEmails: number;
  /** Authoritative GT pool before Job/lifecycle filters. */
  authoritativeEmailCount: number;
  /** Eligible under current Jobs mode + lifecycle filters. */
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

  const [index, jobs, workspaceSummary] = await Promise.all([
    loadAuthoritativeEvalEmailIndex(input.prisma, input.workspaceId),
    loadWorkspaceJobsForEval(input.prisma, input.workspaceId),
    loadHistoricalEvalDatasetSummary(input.prisma, workspace),
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
    workspaceTotalEmails: workspaceSummary.totalEmails,
    authoritativeEmailCount: workspaceSummary.authoritativeEmails,
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
  const contact = row.result.contactDiagnostics;
  const trace = row.result.markerTrace ?? [];
  const nameTrace = trace.find((t) => t.marker === "NAME");
  const contactTrace = trace.find((t) => t.marker === "CONTACT");
  const threadTrace = trace.find((t) => t.marker === "THREAD");
  const nameCandidates = nameTrace?.candidateJobIds ?? [];
  const finalCandidates =
    row.result.candidateJobIds ??
    row.result.ambiguousCandidateIds ??
    (row.result.selectedJobId ? [row.result.selectedJobId] : []);
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
    contactDiagnostics: contact
      ? {
          reason: contact.reason,
          associationClass: contact.associationClass,
          authorityClass: contact.authorityClass,
          resolutionAllowed: contact.resolutionAllowed,
          evidenceIndependentFromThread: contact.evidenceIndependentFromThread,
        }
      : null,
    markerCandidateCounts: {
      name: nameCandidates.length,
      contact: contactTrace?.candidateJobIds.length ?? 0,
      thread: threadTrace?.candidateJobIds.length ?? 0,
      final: finalCandidates.length,
    },
    gtInNameCandidates: nameCandidates.includes(row.trueJobId),
    gtInFinalCandidates: finalCandidates.includes(row.trueJobId),
  };
}

function toEvalRows(input: {
  evaluated: HistoricalEvalEmail[];
  jobsById: Map<
    string,
    {
      name: string;
      jobNumber: string | null;
      status?: string | null;
      archivedAt?: Date | string | null;
    }
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
      trueJobStatus: trueJob?.status ?? null,
      trueJobArchivedAt: trueJob?.archivedAt ?? null,
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
   * Identity policy for a single-policy evaluation.
   * Default CONTEXT_AWARE_V2 — production matcher semantics.
   * Ignored when identityPolicies has length ≥ 1.
   */
  identityPolicy?: JobMatchIdentityPolicy;
  /**
   * Preferred: evaluate / compare exactly these policies (validated server-side).
   * Length 1 = single; length ≥ 2 = same-dataset comparison. Not a fake policy.
   */
  identityPolicies?: JobMatchIdentityPolicy[];
  /**
   * Legacy shadow compare mode on the same emails/snapshot.
   * Mapped to identityPolicies when identityPolicies is omitted.
   * Production default remains CONTEXT_AWARE_V2; experimental policies are never auto-activated.
   */
  compareWithIdentityPolicy?:
    | "CONTEXT_AWARE_V1"
    | "CONTEXT_AWARE_V2"
    | "CONTEXT_AWARE_V2_1"
    | "CONTEXT_AWARE_V2_2"
    | "CONTEXT_AWARE_V2_3"
    | "CONTEXT_AWARE_V2_4"
    | "CONTEXT_AWARE_V3"
    | "CONTEXT_AWARE_V2_5"
    | "ALL_THREE";
  /** Optional client-supplied run id for progress polling. */
  evaluationRunId?: string;
}): Promise<JobMatcherHistoricalEvalResult> {
  const startedAt = Date.now();
  const evaluationRunId = input.evaluationRunId?.trim() || randomUUID();
  const compareWith = input.compareWithIdentityPolicy ?? null;

  const selectedPolicies = resolveSelectedEvalPolicies({
    ...(input.identityPolicies ? { identityPolicies: input.identityPolicies } : {}),
    ...(input.identityPolicy ? { identityPolicy: input.identityPolicy } : {}),
    ...(compareWith ? { compareWithIdentityPolicy: compareWith } : {}),
  });
  const evaluationSelectionMode =
    selectedPolicies.length >= 2 ? ("COMPARE" as const) : ("SINGLE" as const);
  const policiesTotal = selectedPolicies.length;

  const spec = normalizeSpec(
    input.dataset ?? (input.limit != null ? { limit: input.limit } : { limit: 50 })
  );
  const invalid = validateJobMatcherEvalDatasetSpec(spec);
  if (invalid) throw new Error(invalid);

  const workspace = await findEvalWorkspace(input.prisma, input.workspaceId);
  if (!workspace) {
    throw new Error("Workspace not found");
  }

  try {
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

  if (new Set(selection.selectedIds).size !== selection.selectedIds.length) {
    throw new Error("Evaluation selection produced duplicate email IDs");
  }

  startJobMatcherEvalProgress({
    workspaceId: input.workspaceId,
    evaluationRunId,
    emailsTotal: selection.selectedIds.length,
    policiesTotal,
    phase: "loading_emails",
  });

  const matcher = new JobMatcherService(
    createJobMatchEvalLoaderFromSnapshot(snapshot),
    null,
    { logCompletions: false }
  );
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));

  const needsAttachmentIdentity =
    selectedPolicies.includes(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4) ||
    selectedPolicies.includes(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3) ||
    selectedPolicies.includes(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_5);

  const emailRecords = await loadHistoricalEvalEmailsByIds(input.prisma, {
    workspaceId: input.workspaceId,
    ids: selection.selectedIds,
    batchSize: JOB_MATCHER_EVAL_LOAD_BATCH_SIZE,
  });

  if (emailRecords.length !== selection.selectedIds.length) {
    throw new Error(
      `Failed to load evaluation emails: expected ${selection.selectedIds.length}, loaded ${emailRecords.length}. Refusing incomplete evaluation.`
    );
  }

  const sourceById = new Map(
    emailRecords.map((e) => [e.id, e.jobAssignmentSource] as const)
  );

  const attachmentsByEmailId = needsAttachmentIdentity
    ? await loadEvalAttachmentsByEmailIds(input.prisma, {
        workspaceId: input.workspaceId,
        emailMessageIds: emailRecords.map((e) => e.id),
      })
    : new Map();

  let policiesCompleted = 0;
  const evaluatedByPolicy = new Map<
    JobMatchIdentityPolicy,
    HistoricalEvalEmail[]
  >();

  async function scoreEmails(
    policy: JobMatchIdentityPolicy
  ): Promise<{ evaluated: HistoricalEvalEmail[]; runtimeMs: number }> {
    const t0 = Date.now();
    updateJobMatcherEvalProgress({
      workspaceId: input.workspaceId,
      evaluationRunId,
      phase: `scoring_${policy}`,
      emailsCompleted: 0,
      emailsTotal: emailRecords.length,
      policiesCompleted,
      policiesTotal,
    });

    const SCORE_BATCH = 50;
    const evaluated: HistoricalEvalEmail[] = [];
    for (let offset = 0; offset < emailRecords.length; offset += SCORE_BATCH) {
      const batch = emailRecords.slice(offset, offset + SCORE_BATCH);
      const scored = await mapLimit(batch, 2, async (email) => {
        if (!isHistoricalEvalGroundTruth(email)) {
          return null;
        }
        // Matcher must NOT receive trueJobId / selected Job as a hint.
        const attachments = attachmentsByEmailId.get(email.id) ?? [];
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
          ...(policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4 ||
          policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3 ||
          policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_5
            ? {
                attachmentsForMatch: attachments,
                ...(email.hasAttachments && attachments.length === 0
                  ? { attachmentsPresentButNotLoaded: true }
                  : {}),
              }
            : {}),
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
      for (const row of scored) {
        if (row) evaluated.push(row);
      }
      updateJobMatcherEvalProgress({
        workspaceId: input.workspaceId,
        evaluationRunId,
        phase: `scoring_${policy}`,
        emailsCompleted: Math.min(
          offset + batch.length,
          emailRecords.length
        ),
        emailsTotal: emailRecords.length,
        policiesCompleted,
        policiesTotal,
      });
    }
    if (evaluated.length !== emailRecords.length) {
      throw new Error(
        `Incomplete scoring under ${policy}: expected ${emailRecords.length}, got ${evaluated.length}`
      );
    }
    evaluatedByPolicy.set(policy, evaluated);
    policiesCompleted += 1;
    updateJobMatcherEvalProgress({
      workspaceId: input.workspaceId,
      evaluationRunId,
      phase: `scored_${policy}`,
      emailsCompleted: emailRecords.length,
      policiesCompleted,
      policiesTotal,
    });
    return { evaluated, runtimeMs: Date.now() - t0 };
  }

  // Score only the requested policies on the same emails / snapshot / pool.
  const primaryPolicy = selectedPolicies[0]!;
  const runtimeMsByPolicy: Record<string, number> = {};
  for (const policy of selectedPolicies) {
    const scored = await scoreEmails(policy);
    runtimeMsByPolicy[policy] = scored.runtimeMs;
  }
  const primaryEvaluated = evaluatedByPolicy.get(primaryPolicy) ?? [];
  const evaluated = primaryEvaluated;

  let comparison: IdentityCompareReport | null = null;
  let threeWayComparison: IdentityThreeWayCompareReport | null = null;
  let v2FamilyComparison: IdentityV2FamilyCompareReport | null = null;
  let multiPolicyComparison: IdentityMultiPolicyCompareReport | null = null;

  if (selectedPolicies.length >= 2) {
    const metricsByPolicy: Record<string, HistoricalEvalMetrics> = {};
    for (const policy of selectedPolicies) {
      metricsByPolicy[policy] = aggregateHistoricalEvalResults(
        evaluatedByPolicy.get(policy) ?? []
      );
    }

    const emailIds = (evaluatedByPolicy.get(selectedPolicies[0]!) ?? []).map(
      (r) => r.id
    );
    const byPolicyMaps = new Map(
      selectedPolicies.map((p) => [
        p,
        new Map((evaluatedByPolicy.get(p) ?? []).map((r) => [r.id, r])),
      ] as const)
    );

    const multiRows = [];
    for (const emailId of emailIds) {
      const sides = [];
      let subject: string | null = null;
      let trueJobId = "";
      for (const policy of selectedPolicies) {
        const row = byPolicyMaps.get(policy)?.get(emailId);
        if (!row) break;
        subject = row.subject;
        trueJobId = row.trueJobId;
        sides.push({
          policy,
          summary: sideSummaryFromEval(row, jobsById),
        });
      }
      if (sides.length !== selectedPolicies.length || !trueJobId) continue;
      multiRows.push(
        buildIdentityMultiPolicyCompareRow({
          emailMessageId: emailId,
          subject,
          trueJobId,
          trueJobName: jobsById.get(trueJobId)?.name ?? "(missing Job)",
          groundTruthSource: sourceById.get(emailId) ?? null,
          sides,
        })
      );
    }

    multiPolicyComparison = buildIdentityMultiPolicyCompareReport({
      policies: selectedPolicies,
      metricsByPolicy,
      runtimeMsByPolicy,
      rows: multiRows,
      baselinePolicy: pickCompareBaselinePolicy(selectedPolicies),
    });

    // Legacy paired panel when exactly two policies (export / old UI).
    if (selectedPolicies.length === 2) {
      const [leftPolicy, rightPolicy] = selectedPolicies;
      const left = evaluatedByPolicy.get(leftPolicy!) ?? [];
      const right = evaluatedByPolicy.get(rightPolicy!) ?? [];
      const rightById = new Map(right.map((r) => [r.id, r]));
      const compareRows: IdentityCompareRow[] = [];
      for (const leftRow of left) {
        const rightRow = rightById.get(leftRow.id);
        if (!rightRow) continue;
        const baseline = sideSummaryFromEval(leftRow, jobsById);
        const proposedSide = sideSummaryFromEval(rightRow, jobsById);
        const transition = classifyMatcherTransition({
          baselineOutcome: baseline.outcome,
          proposedOutcome: proposedSide.outcome,
          baselinePredictedJobId: baseline.predictedJobId,
          proposedPredictedJobId: proposedSide.predictedJobId,
        });
        compareRows.push({
          emailMessageId: leftRow.id,
          subject: leftRow.subject,
          trueJobId: leftRow.trueJobId,
          trueJobName:
            jobsById.get(leftRow.trueJobId)?.name ?? "(missing Job)",
          groundTruthSource: sourceById.get(leftRow.id) ?? null,
          baseline,
          proposed: proposedSide,
          transition,
          groundTruthReviewFlag:
            baseline.outcome === "WRONG_MATCH" ||
            proposedSide.outcome === "WRONG_MATCH",
        });
      }
      const report = buildIdentityCompareReport({
        baselinePolicy: leftPolicy!,
        proposedPolicy: rightPolicy!,
        baselineMetrics: metricsByPolicy[leftPolicy!]!,
        proposedMetrics: metricsByPolicy[rightPolicy!]!,
        rows: compareRows,
        runtimeMs: {
          baseline: runtimeMsByPolicy[leftPolicy!] ?? 0,
          proposed: runtimeMsByPolicy[rightPolicy!] ?? 0,
        },
      });
      if (!assertTransitionsReconcile(report.transitions, compareRows.length)) {
        throw new Error(
          `Comparison transition counts do not equal evaluated (${compareRows.length})`
        );
      }
      comparison = report;
    }

    // Preserve V2-family shape when exactly those three policies were selected.
    const isV2Family =
      selectedPolicies.length === 3 &&
      selectedPolicies.includes(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2) &&
      selectedPolicies.includes(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1) &&
      selectedPolicies.includes(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2);
    if (isV2Family) {
      const v2Map = byPolicyMaps.get(JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2)!;
      const v21Map = byPolicyMaps.get(
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
      )!;
      const v22Map = byPolicyMaps.get(
        JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2
      )!;
      const familyRows = [];
      for (const emailId of emailIds) {
        const v2Row = v2Map.get(emailId);
        const v21Row = v21Map.get(emailId);
        const v22Row = v22Map.get(emailId);
        if (!v2Row || !v21Row || !v22Row) continue;
        familyRows.push(
          buildV2FamilyCompareRow({
            emailMessageId: emailId,
            subject: v2Row.subject,
            trueJobId: v2Row.trueJobId,
            trueJobName:
              jobsById.get(v2Row.trueJobId)?.name ?? "(missing Job)",
            groundTruthSource: sourceById.get(emailId) ?? null,
            v2: sideSummaryFromEval(v2Row, jobsById),
            v21: sideSummaryFromEval(v21Row, jobsById),
            v22: sideSummaryFromEval(v22Row, jobsById),
          })
        );
      }
      v2FamilyComparison = buildIdentityV2FamilyCompareReport({
        v2Metrics: metricsByPolicy[JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2]!,
        v21Metrics:
          metricsByPolicy[JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1]!,
        v22Metrics:
          metricsByPolicy[JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2]!,
        rows: familyRows,
        runtimeMs: {
          v2: runtimeMsByPolicy[JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2] ?? 0,
          v21:
            runtimeMsByPolicy[JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1] ??
            0,
          v22:
            runtimeMsByPolicy[JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2] ??
            0,
        },
      });
    }
  }

  const metrics = aggregateHistoricalEvalResults(evaluated);
  const display = selectDisplayMetricsForEvaluation({
    primaryPolicy,
    primaryMetrics: metrics,
    comparison,
    threeWayComparison,
    v2FamilyComparison,
    multiPolicyComparison,
  });
  const displayEvaluated =
    evaluatedByPolicy.get(display.policy) ?? evaluated;
  const displayMetricsRecomputed =
    aggregateHistoricalEvalResults(displayEvaluated);
  // Prefer recomputed metrics from the same email records used for display rows.
  const displayMetrics = displayMetricsRecomputed;
  if (
    display.metrics.correctMatches !== displayMetrics.correctMatches ||
    display.metrics.wrongMatches !== displayMetrics.wrongMatches ||
    display.metrics.ambiguous !== displayMetrics.ambiguous ||
    display.metrics.conflict !== displayMetrics.conflict ||
    display.metrics.noMatch !== displayMetrics.noMatch
  ) {
    throw new Error(
      `Display metrics for ${display.policy} disagree with scored email aggregates`
    );
  }

  const jobBreakdown = buildJobMatcherEvalJobBreakdown(
    displayEvaluated,
    jobsById
  );
  const wrong = buildWrongMatchDetails({
    rows: displayEvaluated,
    jobsById,
    maxWrongDetails: input.maxWrongDetails ?? 50,
  });
  /**
   * Email list + detailed export rows always match the displayed (most advanced)
   * policy — never BASELINE primary rows labeled as V2/V2.1.
   */
  const { rows, diagnostics } = toEvalRows({
    evaluated: displayEvaluated,
    jobsById,
    sourceById,
    identityPolicy: display.policy,
  });
  const integrity = assertExportRowsMatchMetrics({
    rows,
    metrics: displayMetrics,
    policyLabel: display.policy,
  });
  if (!integrity.ok) {
    throw new Error(integrity.message);
  }

  /** One bundle per scored policy — same email IDs, no rematch on UI switch. */
  const policyResults: JobMatcherEvalPolicyResultBundle[] = [
    ...evaluatedByPolicy.entries(),
  ]
    .sort(
      ([a], [b]) =>
        jobMatchPolicyAdvanceRank(a) - jobMatchPolicyAdvanceRank(b)
    )
    .map(([policy, policyEvaluated]) => {
      const policyMetrics = aggregateHistoricalEvalResults(policyEvaluated);
      const { rows: policyRows, diagnostics: policyDiagnostics } = toEvalRows({
        evaluated: policyEvaluated,
        jobsById,
        sourceById,
        identityPolicy: policy,
      });
      const policyIntegrity = assertExportRowsMatchMetrics({
        rows: policyRows,
        metrics: policyMetrics,
        policyLabel: policy,
      });
      if (!policyIntegrity.ok) {
        throw new Error(policyIntegrity.message);
      }
      return {
        identityPolicy: policy,
        experimentRevision: experimentRevisionForIdentityPolicy(policy),
        metrics: policyMetrics,
        diagnostics: policyDiagnostics,
        jobBreakdown: buildJobMatcherEvalJobBreakdown(
          policyEvaluated,
          jobsById
        ),
        rows: policyRows,
        wrongMatches: buildWrongMatchDetails({
          rows: policyEvaluated,
          jobsById,
          maxWrongDetails: input.maxWrongDetails ?? 50,
        }).details,
      };
    });

  const datasetFingerprint = selection.selectedIds.slice().sort().join(",");

  const result: JobMatcherHistoricalEvalResult = {
    intelligenceId: "job-matcher",
    databaseWrites: "NONE",
    autoAssignEnabled: isJobMatcherAutoAssignEnabled(),
    evaluationRunId,
    identityPolicy: primaryPolicy,
    experimentRevision:
      experimentRevisionForIdentityPolicy(primaryPolicy) ??
      JOB_MATCH_IDENTITY_EXPERIMENT_REVISION,
    dataset: {
      spec,
      summaryLabel: summarizeDatasetSpec(spec),
      eligibleCount: selection.eligibleCount,
      jobsInScope: selection.jobsInScope,
      expectedMax: selection.expectedMax,
      sampleSizeRequested: spec.count,
      actualEvaluated: displayEvaluated.length,
      capped: selection.capped,
      capReason: selection.capReason,
      selectedEmailIds: selection.selectedIds,
      workspaceSummary,
    },
    metrics,
    displayIdentityPolicy: display.policy,
    displayMetrics,
    policyResults,
    datasetFingerprint,
    diagnostics,
    jobBreakdown,
    rows,
    wrongMatches: wrong.details,
    comparison,
    threeWayComparison,
    v2FamilyComparison,
    multiPolicyComparison,
    selectedIdentityPolicies: selectedPolicies,
    evaluationSelectionMode,
    runtimeMs: Date.now() - startedAt,
    groundTruthQuality: "MODERATE",
    groundTruthNotes:
      "Authoritative EmailMessage.jobId (USER_ASSIGNED / VERIFIED_PROJECT_FOLDER). Folder labels can be noisy. AI_* / JOB_NUMBER_MATCH / IMPORT excluded. Selected Job filters ground truth only — never matcher input. Production identity policy is CONTEXT_AWARE_V2; V2.1 = V2 + title-gap only; V2.2 = V2 + unique-token only (independent experiments). experimentRevision stamps the implementation; older runs without it used prior V2.1/V2.2 algorithms. Dashboard model selection switches among policyResults without re-running.",
  };
  completeJobMatcherEvalProgress({
    workspaceId: input.workspaceId,
    evaluationRunId,
  });
  return result;
  } catch (err) {
    failJobMatcherEvalProgress({
      workspaceId: input.workspaceId,
      evaluationRunId,
      error: err instanceof Error ? err.message : "Evaluation failed",
    });
    throw err;
  }
}

/**
 * Resolve which policies to score. Prefer explicit identityPolicies;
 * otherwise map legacy compareWith / single identityPolicy.
 */
function resolveSelectedEvalPolicies(input: {
  identityPolicies?: JobMatchIdentityPolicy[];
  identityPolicy?: JobMatchIdentityPolicy;
  compareWithIdentityPolicy?:
    | "CONTEXT_AWARE_V1"
    | "CONTEXT_AWARE_V2"
    | "CONTEXT_AWARE_V2_1"
    | "CONTEXT_AWARE_V2_2"
    | "CONTEXT_AWARE_V2_3"
    | "CONTEXT_AWARE_V2_4"
    | "CONTEXT_AWARE_V3"
    | "CONTEXT_AWARE_V2_5"
    | "ALL_THREE"
    | null;
}): JobMatchIdentityPolicy[] {
  if (input.identityPolicies && input.identityPolicies.length > 0) {
    const normalized = normalizeEvalIdentityPolicies(input.identityPolicies);
    if (normalized.length === 0) {
      throw new Error("identityPolicies must include at least one valid policy");
    }
    return normalized;
  }

  const compareWith = input.compareWithIdentityPolicy ?? null;
  if (compareWith === "CONTEXT_AWARE_V1") {
    return normalizeEvalIdentityPolicies(["BASELINE", "CONTEXT_AWARE_V1"]);
  }
  if (compareWith === "CONTEXT_AWARE_V2") {
    return normalizeEvalIdentityPolicies([
      "CONTEXT_AWARE_V1",
      "CONTEXT_AWARE_V2",
    ]);
  }
  if (compareWith === "CONTEXT_AWARE_V2_1") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    ]);
  }
  if (compareWith === "CONTEXT_AWARE_V2_2") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ]);
  }
  if (compareWith === "CONTEXT_AWARE_V2_3") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    ]);
  }
  if (compareWith === "CONTEXT_AWARE_V2_4") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_4,
    ]);
  }
  if (compareWith === "CONTEXT_AWARE_V3") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V3,
    ]);
  }
  if (compareWith === "CONTEXT_AWARE_V2_5") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_5,
    ]);
  }
  if (compareWith === "ALL_THREE") {
    return normalizeEvalIdentityPolicies([
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ]);
  }

  return normalizeEvalIdentityPolicies([
    input.identityPolicy ?? DEFAULT_JOB_MATCH_IDENTITY_POLICY,
  ]);
}
