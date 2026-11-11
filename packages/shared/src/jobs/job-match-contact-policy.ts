/**
 * Marker 2 contact safety for CONTEXT_AWARE_V2 / V2.1.
 * BASELINE / V1 leave contact resolution unchanged.
 */

import type { JobContactHit } from "./job-contact-marker.js";
import type { JobMatchDecision, JobMatchEvidence } from "./job-matcher.js";
import type { JobMatchIdentityPolicy } from "./job-name-identity-policy.js";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
} from "./job-name-identity-policy.js";

export type JobContactAssociationClass =
  | "SINGLE_JOB"
  | "MULTI_JOB"
  | "BROAD"
  | "NONE";

export type JobContactAuthorityClass =
  | "MANUAL"
  | "AUTHORITATIVE_EMAIL"
  | "MIXED"
  | "ABSENT";

export type JobContactPolicyReason =
  | "VERIFIED_SINGLE_JOB_CONTACT"
  | "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT"
  | "MULTI_JOB_CONTACT"
  | "BROAD_CONTACT_ASSOCIATION"
  | "INSUFFICIENT_CONTACT_AUTHORITY"
  | "WEAK_NAME_CONTACT_INTERSECTION"
  | "SHARED_EVIDENCE_ORIGIN"
  | "CONTACT_NARROWING_OK"
  | "CONTACT_ABSENT";

export type JobContactDiagnostics = {
  marker: "CONTACT";
  associationClass: JobContactAssociationClass;
  authorityClass: JobContactAuthorityClass;
  contactJobCount: number;
  contactJobIds: string[];
  manualJobIds: string[];
  authoritativeEmailJobIds: string[];
  sharedSupportingEmailIds: string[];
  evidenceIndependentFromThread: boolean | null;
  resolutionAllowed: boolean;
  reason: JobContactPolicyReason;
};

export type ApplyContactSafetyInput = {
  policy: JobMatchIdentityPolicy;
  /** Status after narrowJobMatchCandidates with contact. */
  status: JobMatchDecision;
  selectedJobId: string | null;
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  contactHits: JobContactHit[];
  /**
   * True when Marker 1 abstained with weak identity (V2 clears candidates,
   * but diagnostics may still indicate weakness).
   */
  nameIdentityWasWeak: boolean;
  nameHadStrongAnchor: boolean;
  threadSupportingEmailIds?: string[];
};

export type ApplyContactSafetyResult = {
  status: JobMatchDecision;
  selectedJobId: string | null;
  candidateJobIds: string[];
  evidence: JobMatchEvidence[];
  diagnostics: JobContactDiagnostics;
};

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function classifyContactHits(hits: JobContactHit[]): {
  associationClass: JobContactAssociationClass;
  authorityClass: JobContactAuthorityClass;
  contactJobIds: string[];
  manualJobIds: string[];
  authoritativeEmailJobIds: string[];
} {
  const contactJobIds = unique(hits.map((h) => h.jobId));
  const manualJobIds = unique(
    hits.filter((h) => h.basis === "MANUAL_JOB_CONTACT").map((h) => h.jobId)
  );
  const authoritativeEmailJobIds = unique(
    hits
      .filter((h) => h.basis === "CURRENT_AUTHORITATIVE_EMAIL")
      .map((h) => h.jobId)
  );

  let associationClass: JobContactAssociationClass = "NONE";
  if (contactJobIds.length === 1) associationClass = "SINGLE_JOB";
  else if (contactJobIds.length >= 2) associationClass = "MULTI_JOB";

  // Broad: many distinct Jobs for this sender in the snapshot (≥4).
  if (contactJobIds.length >= 4) associationClass = "BROAD";

  let authorityClass: JobContactAuthorityClass = "ABSENT";
  if (manualJobIds.length > 0 && authoritativeEmailJobIds.length > 0) {
    authorityClass = "MIXED";
  } else if (manualJobIds.length > 0) {
    authorityClass = "MANUAL";
  } else if (authoritativeEmailJobIds.length > 0) {
    authorityClass = "AUTHORITATIVE_EMAIL";
  }

  return {
    associationClass,
    authorityClass,
    contactJobIds,
    manualJobIds,
    authoritativeEmailJobIds,
  };
}

function supportingEmailIds(hits: JobContactHit[]): string[] {
  const out: string[] = [];
  for (const hit of hits) {
    for (const id of hit.supportingEmailIds ?? []) {
      out.push(id);
    }
  }
  return unique(out);
}

function isContextAwareV2Family(policy: JobMatchIdentityPolicy): boolean {
  return (
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2 ||
    policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1
  );
}

/**
 * V2 / V2.1 contact safety gate applied after WEAK contact narrowing.
 * Non-V2-family policies: pass-through with diagnostics only.
 *
 * V2.1 narrowly recovers verified single-Job AUTH contacts when evidence is
 * independent of the thread — without weakening multi-job / broad / weak-name gates.
 */
export function applyJobContactSafetyPolicy(
  input: ApplyContactSafetyInput
): ApplyContactSafetyResult {
  const classified = classifyContactHits(input.contactHits);
  const contactEmails = supportingEmailIds(input.contactHits);
  const threadEmails = unique(input.threadSupportingEmailIds ?? []);
  const shared = contactEmails.filter((id) => threadEmails.includes(id));
  const evidenceIndependentFromThread =
    threadEmails.length === 0 || contactEmails.length === 0
      ? null
      : shared.length === 0;

  const baseDiag = (overrides: Partial<JobContactDiagnostics>): JobContactDiagnostics => ({
    marker: "CONTACT",
    associationClass: classified.associationClass,
    authorityClass: classified.authorityClass,
    contactJobCount: classified.contactJobIds.length,
    contactJobIds: classified.contactJobIds,
    manualJobIds: classified.manualJobIds,
    authoritativeEmailJobIds: classified.authoritativeEmailJobIds,
    sharedSupportingEmailIds: shared,
    evidenceIndependentFromThread,
    resolutionAllowed: input.status === "MATCH",
    reason: "CONTACT_ABSENT",
    ...overrides,
  });

  if (!isContextAwareV2Family(input.policy)) {
    return {
      status: input.status,
      selectedJobId: input.selectedJobId,
      candidateJobIds: input.candidateJobIds,
      evidence: input.evidence,
      diagnostics: baseDiag({
        reason:
          classified.contactJobIds.length === 0
            ? "CONTACT_ABSENT"
            : input.status === "MATCH"
              ? "CONTACT_NARROWING_OK"
              : classified.associationClass === "MULTI_JOB" ||
                  classified.associationClass === "BROAD"
                ? "MULTI_JOB_CONTACT"
                : "CONTACT_NARROWING_OK",
        resolutionAllowed: input.status === "MATCH",
      }),
    };
  }

  // V2 family — no contact signal
  if (classified.contactJobIds.length === 0) {
    return {
      status: input.status,
      selectedJobId: input.selectedJobId,
      candidateJobIds: input.candidateJobIds,
      evidence: input.evidence,
      diagnostics: baseDiag({
        reason: "CONTACT_ABSENT",
        resolutionAllowed: false,
      }),
    };
  }

  // Multi-job / broad: never independently resolve a unique MATCH.
  if (
    (classified.associationClass === "MULTI_JOB" ||
      classified.associationClass === "BROAD") &&
    input.status === "MATCH" &&
    input.selectedJobId
  ) {
    return {
      status: "AMBIGUOUS",
      selectedJobId: null,
      candidateJobIds:
        input.candidateJobIds.length > 0
          ? input.candidateJobIds
          : classified.contactJobIds,
      evidence: input.evidence,
      diagnostics: baseDiag({
        reason:
          classified.associationClass === "BROAD"
            ? "BROAD_CONTACT_ASSOCIATION"
            : "MULTI_JOB_CONTACT",
        resolutionAllowed: false,
      }),
    };
  }

  // Weak name steered an intersection MATCH — abstain.
  if (
    input.status === "MATCH" &&
    input.nameIdentityWasWeak &&
    !input.nameHadStrongAnchor
  ) {
    return {
      status: "AMBIGUOUS",
      selectedJobId: null,
      candidateJobIds: input.candidateJobIds,
      evidence: input.evidence,
      diagnostics: baseDiag({
        reason: "WEAK_NAME_CONTACT_INTERSECTION",
        resolutionAllowed: false,
      }),
    };
  }

  // Contact unique resolve: MANUAL always OK; V2.1 also allows single-Job AUTH
  // when independent of thread evidence.
  if (input.status === "MATCH" && input.selectedJobId) {
    const selectedManual = classified.manualJobIds.includes(input.selectedJobId);
    if (selectedManual) {
      return {
        status: "MATCH",
        selectedJobId: input.selectedJobId,
        candidateJobIds: [input.selectedJobId],
        evidence: input.evidence,
        diagnostics: baseDiag({
          reason: "VERIFIED_SINGLE_JOB_CONTACT",
          resolutionAllowed: true,
        }),
      };
    }

    const selectedAuth = classified.authoritativeEmailJobIds.includes(
      input.selectedJobId
    );
    const allowAuthSingleJob =
      input.policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1 &&
      classified.associationClass === "SINGLE_JOB" &&
      selectedAuth &&
      evidenceIndependentFromThread !== false;

    if (allowAuthSingleJob) {
      return {
        status: "MATCH",
        selectedJobId: input.selectedJobId,
        candidateJobIds: [input.selectedJobId],
        evidence: input.evidence,
        diagnostics: baseDiag({
          reason: "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT",
          resolutionAllowed: true,
        }),
      };
    }

    return {
      status: "AMBIGUOUS",
      selectedJobId: null,
      candidateJobIds: [input.selectedJobId],
      evidence: input.evidence,
      diagnostics: baseDiag({
        reason: "INSUFFICIENT_CONTACT_AUTHORITY",
        resolutionAllowed: false,
      }),
    };
  }

  return {
    status: input.status,
    selectedJobId: input.selectedJobId,
    candidateJobIds: input.candidateJobIds,
    evidence: input.evidence,
    diagnostics: baseDiag({
      reason:
        classified.associationClass === "MULTI_JOB" ||
        classified.associationClass === "BROAD"
          ? classified.associationClass === "BROAD"
            ? "BROAD_CONTACT_ASSOCIATION"
            : "MULTI_JOB_CONTACT"
          : "CONTACT_NARROWING_OK",
      resolutionAllowed: false,
    }),
  };
}
