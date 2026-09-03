/**
 * Confirmed ForgeOps Job association → deterministic BUSINESS.
 *
 * Distinct from probabilistic job-reference / job-candidate signals.
 * Pure helpers — no I/O.
 */

import type {
  ClassificationDecisionRule,
  ClassificationEvidenceRecord,
} from "./classification-evidence-display.js";
import type { FlagsCumulativeClassifierResult } from "./flags-cumulative-classifier.js";

export const CONFIRMED_JOB_ASSOCIATION_RULE =
  "CONFIRMED_JOB_ASSOCIATION" as const satisfies ClassificationDecisionRule;

export type ConfirmedWorkspaceJob = {
  id: string;
  jobNumber: string | null;
  name: string;
};

export type JobAssociationMarker =
  | {
      status: "CONFIRMED";
      jobId: string;
      jobNumber: string | null;
      name: string;
      decisionEffect: string;
      /** existing_message_job | job_matcher */
      source: string;
      forcedDecision: boolean;
    }
  | {
      status: "CANDIDATE";
      /** Probabilistic only — not attached to EmailMessage/Classification.jobId */
      confidencePct: number | null;
      explanation: string | null;
      hintedJobId: string | null;
    }
  | {
      status: "NONE";
    };

/**
 * Validate a loaded Job row belongs to the workspace (defense in depth).
 * Cross-workspace / missing jobs must not trigger the rule.
 */
export function resolveConfirmedWorkspaceJob(input: {
  workspaceId: string;
  job:
    | {
        id: string;
        workspaceId: string;
        jobNumber: string | null;
        name: string;
      }
    | null
    | undefined;
}): ConfirmedWorkspaceJob | null {
  if (!input.job) return null;
  if (input.job.workspaceId !== input.workspaceId) return null;
  return {
    id: input.job.id,
    jobNumber: input.job.jobNumber,
    name: input.job.name,
  };
}

export function confirmedJobAssociationDecisionEffect(
  job: ConfirmedWorkspaceJob,
  opts?: { source?: string }
): string {
  const label = [job.jobNumber ? `#${job.jobNumber}` : null, job.name]
    .filter(Boolean)
    .join(" — ");
  if (opts?.source === "verified_project_folder") {
    return `Email originated from verified Job folder (${label || job.id}) → BUSINESS`;
  }
  return `Confirmed job association (${label || job.id}) → BUSINESS`;
}

/**
 * Force BUSINESS when a valid workspace Job is already attached.
 * Does not create loops: callers apply once after flags (before PERSONAL skip)
 * and/or after JobMatcher assigns a jobId.
 */
export function applyConfirmedJobAssociationOverride(
  decision: FlagsCumulativeClassifierResult,
  job: ConfirmedWorkspaceJob,
  source: string
): FlagsCumulativeClassifierResult & {
  overridden: boolean;
  jobAssociation: Extract<JobAssociationMarker, { status: "CONFIRMED" }>;
} {
  const forced = decision.mailboxCategory === "PERSONAL";
  const decisionRule = forced
    ? CONFIRMED_JOB_ASSOCIATION_RULE
    : decision.decisionRule;
  const decisionEffect = confirmedJobAssociationDecisionEffect(job, {
    source,
  });

  const classificationDecision = {
    ...decision.classificationDecision,
    rule: decisionRule,
    flags: {
      ...decision.classificationDecision.flags,
      confirmedJobAssociation: true,
    },
  };

  const classificationEvidence: ClassificationEvidenceRecord = {
    ...decision.classificationEvidence,
    decisionRule,
    classificationDecision,
    jobAssociation: {
      status: "CONFIRMED",
      jobId: job.id,
      jobNumber: job.jobNumber,
      name: job.name,
      decisionEffect,
      source,
      forcedDecision: forced,
    },
  };

  return {
    mailboxCategory: "BUSINESS",
    decisionRule,
    // Confirmed job is authoritative — do not keep personal-override review flag
    // solely from weaker PERSONAL path; leave other requiresReview signals intact
    // unless we forced PERSONAL→BUSINESS (then clear review-from-personal).
    requiresReview: forced ? false : decision.requiresReview,
    classificationDecision,
    classificationEvidence,
    overridden: forced,
    jobAssociation: {
      status: "CONFIRMED",
      jobId: job.id,
      jobNumber: job.jobNumber,
      name: job.name,
      decisionEffect,
      source,
      forcedDecision: forced,
    },
  };
}

export function buildJobCandidateMarker(input: {
  jobReferenceConfidence: number | null | undefined;
  explanation: string | null | undefined;
  hintedJobId: string | null | undefined;
}): Extract<JobAssociationMarker, { status: "CANDIDATE" }> | null {
  const conf = input.jobReferenceConfidence;
  const hasHint = Boolean(input.hintedJobId);
  const hasConf = typeof conf === "number" && Number.isFinite(conf) && conf > 0;
  if (!hasHint && !hasConf) return null;
  return {
    status: "CANDIDATE",
    confidencePct:
      hasConf && conf != null ? Math.round(Math.max(0, Math.min(1, conf)) * 100) : null,
    explanation: input.explanation ?? null,
    hintedJobId: input.hintedJobId ?? null,
  };
}
