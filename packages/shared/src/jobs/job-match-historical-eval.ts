import { isAuthoritativeEmailJobAssignment } from "../project-folders/verified-folder-job-assignment.js";
import { canonicalizeJobNameTokens } from "./job-name-normalize.js";
import type {
  JobMatchDecision,
  JobMatchEvidence,
  JobMatchResult,
  JobRecordForMatch,
} from "./job-matcher.js";

export const HISTORICAL_EVAL_NON_AUTHORITATIVE_SOURCES = [
  "AI_SUGGESTED",
  "AI_AUTO_ASSIGNED",
  "JOB_NUMBER_MATCH",
  "FOLDER_ALIAS",
  "IMPORT",
] as const;

export type HistoricalEvalOutcome =
  | "CORRECT_MATCH"
  | "WRONG_MATCH"
  | "AMBIGUOUS"
  | "CONFLICT"
  | "NO_MATCH";

export type HistoricalEvalResolvingMarker = "NAME" | "CONTACT" | "THREAD";

export type HistoricalEvalCliArgs = {
  workspace: string;
  limit: number | null;
  jobId: string | null;
  maxWrongDetails: number;
  concurrency: number;
};

export type HistoricalEvalEmail = {
  id: string;
  subject: string | null;
  direction: string | null;
  trueJobId: string;
  hasAttachments?: boolean;
  result: JobMatchResult;
};

export type HistoricalEvalWrongDetail = {
  emailMessageId: string;
  direction: string | null;
  subject: string | null;
  actualJobId: string;
  actualJobName: string;
  predictedJobId: string | null;
  predictedJobName: string | null;
  resolvingMarker: HistoricalEvalResolvingMarker | null;
  evidence: string[];
  candidateJobIds: string[];
  candidateJobNames: string[];
  clusters: string[];
};

export type HistoricalEvalMetrics = {
  totalEvaluated: number;
  correctMatches: number;
  wrongMatches: number;
  ambiguous: number;
  conflict: number;
  noMatch: number;
  precision: number | null;
  correctCoverage: number;
  wrongMatchRate: number;
  ambiguityRate: number;
  conflictRate: number;
  noMatchRate: number;
  marker1Resolutions: number;
  marker2Resolutions: number;
  marker3Resolutions: number;
  marker2NarrowedUnresolved: number;
  marker3NarrowedUnresolved: number;
  conflictsEncountered: number;
  noEvidence: number;
  internalJobNumberEvidenceCount: number;
  jobNumberMatchEmittedCount: number;
};

export type HistoricalEvalDatasetSummary = {
  workspaceId: string;
  workspaceName: string | null;
  totalEmails: number;
  jobLinkedEmails: number;
  authoritativeEmails: number;
  nonAuthoritativeJobLinkedEmails: number;
  distinctAuthoritativeJobs: number;
  countsByJobStatus: Record<string, number>;
  countsByAssignmentSource: Record<string, number>;
  manualAssignmentCount: number;
  verifiedProjectFolderCount: number;
  sentCount: number;
  receivedCount: number;
  unknownDirectionCount: number;
  distinctInboxConnections: number;
};

export const READ_ONLY_PRISMA_WRITE_OPERATIONS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "executeRaw",
  "executeRawUnsafe",
  "runCommandRaw",
]);

export function assertReadOnlyPrismaOperation(operation: string): void {
  const name = operation.replace(/^\$/, "");
  if (
    READ_ONLY_PRISMA_WRITE_OPERATIONS.has(operation) ||
    READ_ONLY_PRISMA_WRITE_OPERATIONS.has(name)
  ) {
    throw new Error(`Read-only evaluator blocked write: ${operation}`);
  }
}

export function isHistoricalEvalGroundTruth(row: {
  jobId?: string | null;
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
}): boolean {
  if (!row.jobId) return false;
  if (row.jobAssignmentSource === "JOB_NUMBER_MATCH") return false;
  return isAuthoritativeEmailJobAssignment(row);
}

export function parseHistoricalEvalCliArgs(
  argv: string[]
): HistoricalEvalCliArgs {
  const args: HistoricalEvalCliArgs = {
    workspace: "",
    limit: null,
    jobId: null,
    maxWrongDetails: 50,
    concurrency: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token || token === "--help" || token === "-h") {
      throw new Error(
        "Usage: evaluate-job-matcher-production --workspace <id> [--limit N] [--job <jobId>] [--max-wrong-details 50] [--concurrency 1]"
      );
    }
    const next = argv[i + 1];
    if (token === "--workspace") {
      args.workspace = requireArg(token, next);
      i += 1;
      continue;
    }
    if (token === "--limit") {
      args.limit = parsePositiveInt(token, next);
      i += 1;
      continue;
    }
    if (token === "--job") {
      args.jobId = requireArg(token, next);
      i += 1;
      continue;
    }
    if (token === "--max-wrong-details") {
      args.maxWrongDetails = parsePositiveInt(token, next);
      i += 1;
      continue;
    }
    if (token === "--concurrency") {
      args.concurrency = Math.min(4, parsePositiveInt(token, next));
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.workspace.trim()) {
    throw new Error("Missing required --workspace <workspaceId>");
  }
  return args;
}

function requireArg(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(requireArg(flag, value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function maskSenderEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim().toLowerCase();
  if (!value) return "";
  const at = value.indexOf("@");
  if (at <= 0) return "***";
  return `${value[0]!}***${value.slice(at)}`;
}

export function matcherUsedInternalJobNumber(result: JobMatchResult): boolean {
  return result.evidence.some(
    (row) => row.type === "SUBJECT_JOB_NUMBER" || row.type === "CONTENT_JOB_NUMBER"
  );
}

export function resolvingMarkerForResult(
  result: JobMatchResult
): HistoricalEvalResolvingMarker | null {
  if ((result.decision ?? "NO_MATCH") !== "MATCH" || !result.selectedJobId) {
    return null;
  }
  const name = result.markerTrace?.find((row) => row.marker === "NAME");
  if (name?.status === "MATCH") return "NAME";
  const contact = result.markerTrace?.find((row) => row.marker === "CONTACT");
  if (contact?.status === "MATCH") return "CONTACT";
  const thread = result.markerTrace?.find((row) => row.marker === "THREAD");
  if (thread?.status === "MATCH") return "THREAD";
  return "NAME";
}

export function classifyHistoricalEvalOutcome(input: {
  trueJobId: string;
  result: JobMatchResult;
}): HistoricalEvalOutcome {
  const decision: JobMatchDecision = input.result.decision ?? "NO_MATCH";
  if (decision === "MATCH" && input.result.selectedJobId === input.trueJobId) {
    return "CORRECT_MATCH";
  }
  if (decision === "MATCH") return "WRONG_MATCH";
  if (decision === "AMBIGUOUS") return "AMBIGUOUS";
  if (decision === "CONFLICT") return "CONFLICT";
  return "NO_MATCH";
}

export function clusterWrongMatch(input: {
  subject: string | null;
  trueJob: JobRecordForMatch | undefined;
  predictedJob: JobRecordForMatch | undefined;
  result: JobMatchResult;
  hasAttachments?: boolean | undefined;
}): string[] {
  const clusters: string[] = [];
  const decision = input.result.decision ?? "NO_MATCH";
  const name = input.result.markerTrace?.find((row) => row.marker === "NAME");
  const contact = input.result.markerTrace?.find((row) => row.marker === "CONTACT");
  const thread = input.result.markerTrace?.find((row) => row.marker === "THREAD");
  const trueName = input.trueJob?.name ?? "";
  const predictedName = input.predictedJob?.name ?? "";
  const trueTokens = new Set(canonicalizeJobNameTokens(trueName));
  const predictedTokens = canonicalizeJobNameTokens(predictedName);
  const shared = predictedTokens.filter((token) => trueTokens.has(token));

  if (decision === "CONFLICT" || thread?.status === "CONFLICT") {
    clusters.push("thread conflict");
  }
  if (name?.status === "AMBIGUOUS" || (name?.candidateJobIds.length ?? 0) > 1) {
    clusters.push("multiple projects mentioned");
  }
  if (
    /\b(building|bldg|phase|ph)\b/i.test(trueName) &&
    /\b(building|bldg|phase|ph)\b/i.test(predictedName)
  ) {
    clusters.push("Building/Phase ambiguity");
  }
  if (shared.length > 0 && input.trueJob && input.predictedJob) {
    clusters.push("similar Job names");
  }
  if (
    input.trueJob?.customerId &&
    input.predictedJob?.customerId &&
    input.trueJob.customerId === input.predictedJob.customerId
  ) {
    clusters.push("shared customer/GC");
  }
  if (contact?.candidateJobIds.some((id) => id !== input.trueJob?.id)) {
    clusters.push("shared sender across Jobs");
  }
  if (name?.status === "NO_MATCH" || (name?.candidateJobIds.length ?? 0) === 0) {
    clusters.push("missing project identity");
  }
  if (!contact || contact.candidateJobIds.length === 0) {
    clusters.push("new contact");
  }
  if (!thread || thread.candidateJobIds.length === 0) {
    clusters.push("new thread");
  }
  if (input.result.evidence.length === 0) {
    clusters.push("insufficient evidence");
  }
  const subject = (input.subject ?? "").trim();
  if (subject.length > 0 && subject.length < 12 && input.result.evidence.length === 0) {
    clusters.push("vague email");
  }
  if (input.hasAttachments) {
    clusters.push("attachment filename may contain useful identity");
  }
  if (
    input.trueJob?.externalRef &&
    input.predictedJob?.externalRef &&
    input.trueJob.externalRef !== input.predictedJob.externalRef
  ) {
    clusters.push("externalRef conflict");
  }
  if (clusters.length === 0) clusters.push("insufficient evidence");
  return [...new Set(clusters)];
}

export function aggregateHistoricalEvalResults(
  rows: HistoricalEvalEmail[]
): HistoricalEvalMetrics {
  let correctMatches = 0;
  let wrongMatches = 0;
  let ambiguous = 0;
  let conflict = 0;
  let noMatch = 0;
  let marker1Resolutions = 0;
  let marker2Resolutions = 0;
  let marker3Resolutions = 0;
  let marker2NarrowedUnresolved = 0;
  let marker3NarrowedUnresolved = 0;
  let conflictsEncountered = 0;
  let noEvidence = 0;
  let internalJobNumberEvidenceCount = 0;
  let jobNumberMatchEmittedCount = 0;

  for (const row of rows) {
    const outcome = classifyHistoricalEvalOutcome(row);
    if (outcome === "CORRECT_MATCH") correctMatches += 1;
    else if (outcome === "WRONG_MATCH") wrongMatches += 1;
    else if (outcome === "AMBIGUOUS") ambiguous += 1;
    else if (outcome === "CONFLICT") conflict += 1;
    else noMatch += 1;

    const marker = resolvingMarkerForResult(row.result);
    if (outcome === "CORRECT_MATCH") {
      if (marker === "NAME") marker1Resolutions += 1;
      else if (marker === "CONTACT") marker2Resolutions += 1;
      else if (marker === "THREAD") marker3Resolutions += 1;
    }

    const nameIds =
      row.result.markerTrace?.find((t) => t.marker === "NAME")?.candidateJobIds ??
      [];
    const contact = row.result.markerTrace?.find((t) => t.marker === "CONTACT");
    const thread = row.result.markerTrace?.find((t) => t.marker === "THREAD");
    if (
      contact &&
      contact.status !== "MATCH" &&
      contact.candidateJobIds.length > 0 &&
      contact.candidateJobIds.length < nameIds.length
    ) {
      marker2NarrowedUnresolved += 1;
    }
    if (
      thread &&
      thread.status !== "MATCH" &&
      thread.status !== "CONFLICT" &&
      (contact?.candidateJobIds.length ?? nameIds.length) >
        thread.candidateJobIds.length
    ) {
      marker3NarrowedUnresolved += 1;
    }
    if (row.result.decision === "CONFLICT" || thread?.status === "CONFLICT") {
      conflictsEncountered += 1;
    }
    if (
      (row.result.decision ?? "NO_MATCH") === "NO_MATCH" &&
      row.result.evidence.length === 0
    ) {
      noEvidence += 1;
    }
    if (matcherUsedInternalJobNumber(row.result)) {
      internalJobNumberEvidenceCount += 1;
    }
    if (row.result.assignmentSource === "JOB_NUMBER_MATCH") {
      jobNumberMatchEmittedCount += 1;
    }
  }

  const totalEvaluated = rows.length;
  const decided = correctMatches + wrongMatches;
  return {
    totalEvaluated,
    correctMatches,
    wrongMatches,
    ambiguous,
    conflict,
    noMatch,
    precision: decided === 0 ? null : correctMatches / decided,
    correctCoverage: totalEvaluated === 0 ? 0 : correctMatches / totalEvaluated,
    wrongMatchRate: totalEvaluated === 0 ? 0 : wrongMatches / totalEvaluated,
    ambiguityRate: totalEvaluated === 0 ? 0 : ambiguous / totalEvaluated,
    conflictRate: totalEvaluated === 0 ? 0 : conflict / totalEvaluated,
    noMatchRate: totalEvaluated === 0 ? 0 : noMatch / totalEvaluated,
    marker1Resolutions,
    marker2Resolutions,
    marker3Resolutions,
    marker2NarrowedUnresolved,
    marker3NarrowedUnresolved,
    conflictsEncountered,
    noEvidence,
    internalJobNumberEvidenceCount,
    jobNumberMatchEmittedCount,
  };
}

export function buildWrongMatchDetails(input: {
  rows: HistoricalEvalEmail[];
  jobsById: Map<string, JobRecordForMatch>;
  maxWrongDetails: number;
}): { details: HistoricalEvalWrongDetail[]; truncated: number; totalWrong: number } {
  const wrong = input.rows.filter(
    (row) => classifyHistoricalEvalOutcome(row) === "WRONG_MATCH"
  );
  const details = wrong.slice(0, input.maxWrongDetails).map((row) => {
    const actual = input.jobsById.get(row.trueJobId);
    const predicted = row.result.selectedJobId
      ? input.jobsById.get(row.result.selectedJobId)
      : undefined;
    const candidateJobIds = row.result.candidateJobIds ?? [];
    return {
      emailMessageId: row.id,
      direction: row.direction,
      subject: row.subject,
      actualJobId: row.trueJobId,
      actualJobName: actual?.name ?? "(missing Job)",
      predictedJobId: row.result.selectedJobId,
      predictedJobName: predicted?.name ?? null,
      resolvingMarker: resolvingMarkerForResult(row.result),
      evidence: formatEvidence(row.result.evidence),
      candidateJobIds,
      candidateJobNames: candidateJobIds.map(
        (id) => input.jobsById.get(id)?.name ?? id
      ),
      clusters: clusterWrongMatch({
        subject: row.subject,
        trueJob: actual,
        predictedJob: predicted,
        result: row.result,
        hasAttachments: row.hasAttachments,
      }),
    };
  });
  return {
    details,
    truncated: Math.max(0, wrong.length - details.length),
    totalWrong: wrong.length,
  };
}

function formatEvidence(evidence: JobMatchEvidence[]): string[] {
  return evidence.slice(0, 12).map((row) => `${row.type}: ${row.value}`.slice(0, 180));
}

export function shadowReadinessRecommendation(
  metrics: HistoricalEvalMetrics
): string {
  if (metrics.totalEvaluated === 0) {
    return "No authoritative emails evaluated. No assignment-readiness conclusion.";
  }
  if (metrics.precision === null) {
    return "No MATCH decisions. Precision is undefined. NOT ready for automatic assignment.";
  }
  if (metrics.precision < 0.99) {
    return "Precision < 99%. NOT ready for automatic assignment.";
  }
  if (metrics.correctCoverage < 0.5) {
    return "Precision >= 99% but coverage is modest. Potentially ready for shadow-mode observation only. Do not enable auto-assignment.";
  }
  return "Very high precision on this historical holdout. Future candidate for carefully gated auto-assignment only after live shadow results. Do not enable auto-assignment from this report.";
}

function formatRate(value: number | null): string {
  if (value === null) return "n/a (no MATCH decisions)";
  return `${(value * 100).toFixed(2)}%`;
}

function formatCountMap(map: Record<string, number>): string {
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return "(none)";
  return keys.map((key) => `  ${key}: ${map[key]}`).join("\n");
}

export function formatHistoricalEvalReport(input: {
  dataset: HistoricalEvalDatasetSummary;
  metrics: HistoricalEvalMetrics;
  wrong: ReturnType<typeof buildWrongMatchDetails>;
  autoAssignEnabled: boolean;
  databaseWrites: "NONE";
}): string {
  const { dataset, metrics, wrong } = input;
  const lines: string[] = [
    "FORGEOPS JOB MATCHER HISTORICAL EVALUATION",
    "",
    "Workspace:",
    dataset.workspaceName
      ? `${dataset.workspaceId} (${dataset.workspaceName})`
      : dataset.workspaceId,
    "",
    "Dataset",
    "-------",
    `Total emails: ${dataset.totalEmails}`,
    `Job-linked: ${dataset.jobLinkedEmails}`,
    `Authoritative: ${dataset.authoritativeEmails}`,
    `Non-authoritative job-linked: ${dataset.nonAuthoritativeJobLinkedEmails}`,
    `Jobs represented: ${dataset.distinctAuthoritativeJobs}`,
    `Inbox connections: ${dataset.distinctInboxConnections}`,
    `Manual assignments: ${dataset.manualAssignmentCount}`,
    `Verified project-folder: ${dataset.verifiedProjectFolderCount}`,
    `SENT: ${dataset.sentCount}`,
    `RECEIVED: ${dataset.receivedCount}`,
    `Unknown direction: ${dataset.unknownDirectionCount}`,
    "Counts by Job status:",
    formatCountMap(dataset.countsByJobStatus),
    "Counts by jobAssignmentSource:",
    formatCountMap(dataset.countsByAssignmentSource),
    "",
    "Results",
    "-------",
    `Evaluated: ${metrics.totalEvaluated}`,
    `Correct: ${metrics.correctMatches}`,
    `Wrong: ${metrics.wrongMatches}`,
    `Ambiguous: ${metrics.ambiguous}`,
    `Conflict: ${metrics.conflict}`,
    `No match: ${metrics.noMatch}`,
    "",
    `Precision: ${formatRate(metrics.precision)}`,
    `Correct coverage: ${formatRate(metrics.correctCoverage)}`,
    `Wrong-match rate: ${formatRate(metrics.wrongMatchRate)}`,
    `Ambiguity rate: ${formatRate(metrics.ambiguityRate)}`,
    `Conflict rate: ${formatRate(metrics.conflictRate)}`,
    `No-match rate: ${formatRate(metrics.noMatchRate)}`,
    "",
    "Marker contribution",
    "-------------------",
    `Marker 1: ${metrics.marker1Resolutions}`,
    `Marker 2: ${metrics.marker2Resolutions}`,
    `Marker 3: ${metrics.marker3Resolutions}`,
    `Marker 2 narrowed but did not resolve: ${metrics.marker2NarrowedUnresolved}`,
    `Marker 3 narrowed but did not resolve: ${metrics.marker3NarrowedUnresolved}`,
    `Conflicts encountered: ${metrics.conflictsEncountered}`,
    `No-evidence cases: ${metrics.noEvidence}`,
    "",
    "Safety",
    "------",
    `Internal Job number evidence: ${
      metrics.internalJobNumberEvidenceCount === 0
        ? "DISABLED"
        : `UNEXPECTED (${metrics.internalJobNumberEvidenceCount})`
    }`,
    "JOB_NUMBER_MATCH ground truth: EXCLUDED",
    `JOB_NUMBER_MATCH emitted by matcher: ${
      metrics.jobNumberMatchEmittedCount === 0
        ? "NONE"
        : `UNEXPECTED (${metrics.jobNumberMatchEmittedCount})`
    }`,
    `Database writes: ${input.databaseWrites}`,
    `Auto-assignment: ${input.autoAssignEnabled ? "ON" : "OFF"}`,
    "",
    "Wrong-match diagnostics",
    "-----------------------",
    `Wrong-match count: ${wrong.totalWrong}`,
  ];

  if (wrong.details.length === 0) {
    lines.push("(none)");
  } else {
    for (const detail of wrong.details) {
      lines.push(
        [
          `- EmailMessage.id: ${detail.emailMessageId}`,
          `  direction: ${detail.direction ?? "(unknown)"}`,
          `  subject: ${detail.subject ?? ""}`,
          `  actual Job: ${detail.actualJobId} (${detail.actualJobName})`,
          `  predicted Job: ${detail.predictedJobId ?? "(none)"} (${
            detail.predictedJobName ?? ""
          })`,
          `  resolving marker: ${detail.resolvingMarker ?? "(none)"}`,
          `  evidence: ${detail.evidence.join(" | ") || "(none)"}`,
          `  candidates: ${
            detail.candidateJobIds
              .map((id, i) => `${id} (${detail.candidateJobNames[i] ?? ""})`)
              .join("; ") || "(none)"
          }`,
          `  clusters: ${detail.clusters.join(", ")}`,
        ].join("\n")
      );
    }
    if (wrong.truncated > 0) {
      lines.push(
        `(truncated ${wrong.truncated} additional wrong-match details)`
      );
    }
  }

  lines.push(
    "",
    "Recommendation",
    "--------------",
    shadowReadinessRecommendation(metrics),
    ""
  );
  return lines.join("\n");
}
