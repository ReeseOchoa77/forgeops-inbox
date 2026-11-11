import {
  type JobAliasForMatch,
  type JobMatchAssignmentSource,
  type JobMatchDecision,
  type JobMatchEvidence,
  type JobMatchInput,
  type JobMatchMarkerId,
  type JobMatchMarkerTrace,
  type JobMatchResult,
  type JobRecordForMatch,
} from "./job-matcher.js";
import {
  runJobNameMarker,
  DEFAULT_JOB_MATCH_IDENTITY_POLICY,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  type JobMatchEligibilityMode,
  type JobMatchIdentityPolicy,
  type JobNameIdentityDiagnostics,
} from "./job-name-marker.js";

import { runJobContactMarker, type JobContactHit } from "./job-contact-marker.js";
import {
  applyJobContactSafetyPolicy,
  type JobContactDiagnostics,
} from "./job-match-contact-policy.js";
import { runJobThreadMarker, type JobThreadHit } from "./job-thread-marker.js";

export const JOB_MATCH_PIPELINE_VERSION = "job-match-pipeline-v3";

export type LaterMarkerStrength = "ABSENT" | "WEAK" | "STRONG";

export type NarrowJobMatchInput = {
  priorStatus: JobMatchDecision;
  priorSelectedJobId: string | null;
  priorCandidateJobIds: string[];
  priorEvidence: JobMatchEvidence[];
  /** Jobs implicated by the later marker. Empty means the signal was absent. */
  laterJobIds: string[];
  laterMarker: Exclude<JobMatchMarkerId, "NAME">;
  laterEvidence?: JobMatchEvidence[];
  /**
   * WEAK: exact contacts — may resolve inside the name set, never expand it,
   * never override a unique name MATCH.
   * STRONG: authoritative thread history — may CONFLICT with a disjoint set.
   */
  laterStrength: LaterMarkerStrength;
};

export type NarrowJobMatchResult = {
  status: JobMatchDecision;
  selectedJobId: string | null;
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  narrowed: boolean;
  conflict: boolean;
};

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function intersectIds(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return uniqueIds(a.filter((id) => setB.has(id)));
}

/**
 * Intersection-before-expansion narrowing.
 *
 * Unique strong Marker 1 MATCH is not overridden by later evidence.
 * Name candidates are never replaced by a disjoint weaker set.
 */
export function narrowJobMatchCandidates(
  input: NarrowJobMatchInput
): NarrowJobMatchResult {
  const priorIds = uniqueIds(input.priorCandidateJobIds);
  const laterIds = uniqueIds(input.laterJobIds);
  const evidence = [
    ...input.priorEvidence,
    ...(input.laterEvidence ?? []),
  ];

  if (input.priorStatus === "MATCH" && input.priorSelectedJobId) {
    return {
      status: "MATCH",
      selectedJobId: input.priorSelectedJobId,
      candidateJobIds: [input.priorSelectedJobId],
      evidence: input.priorEvidence,
      narrowed: false,
      conflict: false,
    };
  }

  if (input.laterStrength === "ABSENT" || laterIds.length === 0) {
    return {
      status: input.priorStatus === "CONFLICT" ? "CONFLICT" : input.priorStatus,
      selectedJobId: input.priorSelectedJobId,
      candidateJobIds: priorIds,
      evidence: input.priorEvidence,
      narrowed: false,
      conflict: input.priorStatus === "CONFLICT",
    };
  }

  if (priorIds.length === 0) {
    if (laterIds.length === 1) {
      return {
        status: "MATCH",
        selectedJobId: laterIds[0]!,
        candidateJobIds: laterIds,
        evidence,
        narrowed: true,
        conflict: false,
      };
    }
    if (laterIds.length > 1) {
      return {
        status: "AMBIGUOUS",
        selectedJobId: null,
        candidateJobIds: laterIds,
        evidence,
        narrowed: true,
        conflict: false,
      };
    }
  }

  const intersection = intersectIds(priorIds, laterIds);
  if (intersection.length === 1) {
    return {
      status: "MATCH",
      selectedJobId: intersection[0]!,
      candidateJobIds: intersection,
      evidence,
      narrowed: intersection.length !== priorIds.length,
      conflict: false,
    };
  }
  if (intersection.length > 1) {
    return {
      status: "AMBIGUOUS",
      selectedJobId: null,
      candidateJobIds: intersection,
      evidence,
      narrowed: intersection.length !== priorIds.length,
      conflict: false,
    };
  }

  if (input.laterStrength === "STRONG") {
    return {
      status: "CONFLICT",
      selectedJobId: null,
      candidateJobIds: uniqueIds([...priorIds, ...laterIds]),
      evidence,
      narrowed: false,
      conflict: true,
    };
  }

  return {
    status: input.priorStatus,
    selectedJobId: input.priorSelectedJobId,
    candidateJobIds: priorIds,
    evidence,
    narrowed: false,
    conflict: false,
  };
}

function assignmentSourceForNameMatch(
  _evidence: JobMatchEvidence[]
): JobMatchAssignmentSource {
  // Internal Job.jobNumber is never matching evidence. JOB_NUMBER_MATCH is
  // historical provenance only — the live pipeline must not emit it.
  return "AI_AUTO_ASSIGNED";
}

function toResult(input: {
  decision: JobMatchDecision;
  selectedJobId: string | null;
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  assignmentSource: JobMatchAssignmentSource | null;
  confidence: number;
  eligibleJobCount: number;
  markerTrace: JobMatchMarkerTrace[];
  identityPolicy: JobMatchIdentityPolicy;
  identityDiagnostics: JobNameIdentityDiagnostics;
  contactDiagnostics?: JobContactDiagnostics;
}): JobMatchResult {
  const requiresReview =
    input.decision === "AMBIGUOUS" || input.decision === "CONFLICT";
  return {
    selectedJobId: input.selectedJobId,
    confidence: input.confidence,
    evidence: input.evidence,
    ambiguousCandidateIds:
      requiresReview ? input.candidateJobIds : [],
    candidateJobIds: input.candidateJobIds,
    decision: input.decision,
    markerTrace: input.markerTrace,
    requiresReview,
    assignmentSource: input.assignmentSource,
    candidateCount: input.eligibleJobCount,
    matcherVersion: JOB_MATCH_PIPELINE_VERSION,
    identityPolicy: input.identityPolicy,
    identityDiagnostics: input.identityDiagnostics,
    ...(input.contactDiagnostics
      ? { contactDiagnostics: input.contactDiagnostics }
      : {}),
  };
}

function decisionFromNameStatus(
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH"
): JobMatchDecision {
  return status;
}

function assignmentSourceForDecision(
  decision: JobMatchDecision,
  evidence: JobMatchEvidence[]
): JobMatchAssignmentSource | null {
  if (decision !== "MATCH") return null;
  return assignmentSourceForNameMatch(evidence);
}

/**
 * Ordered marker pipeline.
 *
 * Marker 1 identifies the plausible Job-name candidate set. A UNIQUE STRONG
 * identity MATCH stops the pipeline. Otherwise Marker 2 (active exact contact)
 * then Marker 3 (authoritative thread) narrow via narrowJobMatchCandidates.
 */
export function runJobMatchPipeline(input: {
  subject: string | null | undefined;
  bodyText?: string | null | undefined;
  cleanBody?: string | null | undefined;
  jobs: JobRecordForMatch[];
  aliases?: JobAliasForMatch[] | undefined;
  senderEmail?: string | null | undefined;
  inboxConnectionId?: string | null | undefined;
  providerThreadId?: string | null | undefined;
  contactHits?: JobContactHit[] | undefined;
  threadHits?: JobThreadHit[] | undefined;
  eligibilityMode?: JobMatchEligibilityMode;
  identityPolicy?: JobMatchIdentityPolicy;
}): JobMatchResult {
  const eligibilityMode = input.eligibilityMode ?? "production";
  const identityPolicy =
    input.identityPolicy ?? DEFAULT_JOB_MATCH_IDENTITY_POLICY;
  const marker1 = runJobNameMarker({
    subject: input.subject,
    bodyText: input.bodyText,
    cleanBody: input.cleanBody,
    jobs: input.jobs,
    aliases: input.aliases ?? [],
    eligibilityMode,
    identityPolicy,
  });

  const markerTrace: JobMatchMarkerTrace[] = [
    {
      marker: "NAME",
      status: marker1.status,
      selectedJobId: marker1.selectedJobId,
      candidateJobIds: marker1.candidateJobIds,
    },
  ];

  if (marker1.status === "MATCH" && marker1.selectedJobId) {
    return toResult({
      decision: "MATCH",
      selectedJobId: marker1.selectedJobId,
      candidateJobIds: marker1.candidateJobIds,
      evidence: marker1.evidence,
      assignmentSource: assignmentSourceForNameMatch(marker1.evidence),
      confidence: marker1.confidence,
      eligibleJobCount: marker1.eligibleJobCount,
      markerTrace,
      identityPolicy,
      identityDiagnostics: marker1.identityDiagnostics,
    });
  }

  let current = {
    status: decisionFromNameStatus(marker1.status),
    selectedJobId: marker1.selectedJobId,
    candidateJobIds: marker1.candidateJobIds,
    evidence: marker1.evidence,
    confidence: marker1.confidence,
  };

  const contact = runJobContactMarker({
    senderEmail: input.senderEmail,
    hits: input.contactHits ?? [],
    eligibleJobs: input.jobs,
    eligibilityMode,
  });
  const afterContactNarrow = narrowJobMatchCandidates({
    priorStatus: current.status,
    priorSelectedJobId: current.selectedJobId,
    priorCandidateJobIds: current.candidateJobIds,
    priorEvidence: current.evidence,
    laterJobIds: contact.candidateJobIds,
    laterMarker: "CONTACT",
    laterEvidence: contact.evidence,
    laterStrength: contact.candidateJobIds.length === 0 ? "ABSENT" : "WEAK",
  });

  const threadPreviewHits = input.threadHits ?? [];
  const threadSupportingEmailIds = threadPreviewHits.flatMap(
    (h) => h.supportingEmailIds ?? []
  );
  const contactSafety = applyJobContactSafetyPolicy({
    policy: identityPolicy,
    status: afterContactNarrow.status,
    selectedJobId: afterContactNarrow.selectedJobId,
    candidateJobIds: afterContactNarrow.candidateJobIds,
    evidence: afterContactNarrow.evidence,
    contactHits: input.contactHits ?? [],
    nameIdentityWasWeak:
      marker1.identityDiagnostics.identityStrength === "WEAK",
    nameHadStrongAnchor: marker1.identityDiagnostics.strongIdentityAnchor,
    threadSupportingEmailIds,
  });

  markerTrace.push({
    marker: "CONTACT",
    status: contactSafety.status,
    selectedJobId: contactSafety.selectedJobId,
    candidateJobIds: contactSafety.candidateJobIds,
  });
  current = {
    status: contactSafety.status,
    selectedJobId: contactSafety.selectedJobId,
    candidateJobIds: contactSafety.candidateJobIds,
    evidence: contactSafety.evidence,
    confidence:
      contactSafety.status === "MATCH"
        ? Math.max(current.confidence, 0.86)
        : current.confidence,
  };

  if (current.status === "MATCH" && current.selectedJobId) {
    return toResult({
      decision: "MATCH",
      selectedJobId: current.selectedJobId,
      candidateJobIds: current.candidateJobIds,
      evidence: current.evidence,
      assignmentSource: assignmentSourceForDecision(
        current.status,
        current.evidence
      ),
      confidence: current.confidence,
      eligibleJobCount: marker1.eligibleJobCount,
      markerTrace,
      identityPolicy,
      identityDiagnostics: marker1.identityDiagnostics,
      contactDiagnostics: contactSafety.diagnostics,
    });
  }

  const thread = runJobThreadMarker({
    inboxConnectionId: input.inboxConnectionId,
    providerThreadId: input.providerThreadId,
    hits: input.threadHits ?? [],
    eligibleJobs: input.jobs,
    eligibilityMode,
  });
  let afterThread = narrowJobMatchCandidates({
    priorStatus: current.status,
    priorSelectedJobId: current.selectedJobId,
    priorCandidateJobIds: current.candidateJobIds,
    priorEvidence: current.evidence,
    laterJobIds: thread.candidateJobIds,
    laterMarker: "THREAD",
    laterEvidence: thread.evidence,
    laterStrength: thread.candidateJobIds.length === 0 ? "ABSENT" : "STRONG",
  });

  // V2 conflict veto: strong name family evidence vs disjoint authoritative thread.
  if (
    identityPolicy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2 &&
    marker1.identityDiagnostics.strongIdentityAnchor &&
    marker1.identityDiagnostics.competingJobIds.length > 0 &&
    thread.candidateJobIds.length === 1 &&
    afterThread.status === "MATCH" &&
    afterThread.selectedJobId &&
    !marker1.identityDiagnostics.competingJobIds.includes(
      afterThread.selectedJobId
    ) &&
    !marker1.identityDiagnostics.candidateJobIds.includes(
      afterThread.selectedJobId
    )
  ) {
    afterThread = {
      status: "CONFLICT",
      selectedJobId: null,
      candidateJobIds: uniqueIds([
        ...marker1.identityDiagnostics.competingJobIds,
        ...thread.candidateJobIds,
      ]),
      evidence: afterThread.evidence,
      narrowed: false,
      conflict: true,
    };
  }

  // V2: contact+thread from same supporting emails are not independent
  // corroboration for contact-only paths (already abstained). Flag only.
  if (
    identityPolicy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2 &&
    contactSafety.diagnostics.evidenceIndependentFromThread === false &&
    afterThread.status === "MATCH" &&
    current.status !== "MATCH" &&
    marker1.identityDiagnostics.identityStrength === "WEAK"
  ) {
    // Thread alone remains authoritative continuity — keep MATCH.
    // Shared-origin note lives in contactDiagnostics.
  }

  markerTrace.push({
    marker: "THREAD",
    status: afterThread.status,
    selectedJobId: afterThread.selectedJobId,
    candidateJobIds: afterThread.candidateJobIds,
  });

  const confidence =
    afterThread.status === "MATCH"
      ? Math.max(current.confidence, 0.9)
      : afterThread.status === "CONFLICT"
        ? current.confidence
        : current.confidence;

  return toResult({
    decision: afterThread.status,
    selectedJobId: afterThread.selectedJobId,
    candidateJobIds: afterThread.candidateJobIds,
    evidence: afterThread.evidence,
    assignmentSource: assignmentSourceForDecision(
      afterThread.status,
      afterThread.evidence
    ),
    confidence,
    eligibleJobCount: marker1.eligibleJobCount,
    markerTrace,
    identityPolicy,
    identityDiagnostics: marker1.identityDiagnostics,
    contactDiagnostics: contactSafety.diagnostics,
  });
}

export function jobMatchPipelineFromEmailInput(
  input: JobMatchInput,
  jobs: JobRecordForMatch[],
  aliases: JobAliasForMatch[],
  extras?: {
    contactHits?: JobContactHit[] | undefined;
    threadHits?: JobThreadHit[] | undefined;
  }
): JobMatchResult {
  return runJobMatchPipeline({
    subject: input.subject,
    bodyText: input.bodyText,
    cleanBody: input.cleanBody,
    jobs,
    aliases,
    senderEmail: input.senderEmail,
    inboxConnectionId: input.inboxConnectionId,
    providerThreadId: input.providerThreadId,
    contactHits: extras?.contactHits,
    threadHits: extras?.threadHits,
    eligibilityMode: input.eligibilityMode ?? "production",
    identityPolicy: input.identityPolicy ?? DEFAULT_JOB_MATCH_IDENTITY_POLICY,
  });
}
