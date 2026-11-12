import { describe, expect, it } from "vitest";
import {
  attributePolicyChange,
  classifyDecisionTransition,
  emptyDecisionTransitionCounts,
} from "../jobs/job-match-decision-transitions.js";
import {
  buildIdentityCompareReport,
  classifyMatcherTransition,
} from "../jobs/job-match-identity-compare.js";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import type { HistoricalEvalMetrics } from "../jobs/job-match-historical-eval.js";

function job(
  id: string,
  name: string,
  extras?: Partial<JobRecordForMatch>
): JobRecordForMatch {
  return {
    id,
    jobNumber: id.replace(/\D/g, "") || "1",
    name,
    normalizedName: name.toLowerCase(),
    customerId: null,
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const riseUp = job("job-rise", "RISE UP");
const satStairs = job("job-sat-stairs", "SAT - 15 Ext Stairs", {
  customerId: "cust-sat",
});

function emptyMetrics(partial: Partial<HistoricalEvalMetrics>): HistoricalEvalMetrics {
  return {
    totalEvaluated: 0,
    correctMatches: 0,
    wrongMatches: 0,
    ambiguous: 0,
    conflict: 0,
    noMatch: 0,
    precision: null,
    correctCoverage: 0,
    wrongMatchRate: 0,
    ambiguityRate: 0,
    conflictRate: 0,
    noMatchRate: 0,
    marker1Resolutions: 0,
    marker2Resolutions: 0,
    marker3Resolutions: 0,
    marker2NarrowedUnresolved: 0,
    marker3NarrowedUnresolved: 0,
    conflictsEncountered: 0,
    noEvidence: 0,
    internalJobNumberEvidenceCount: 0,
    jobNumberMatchEmittedCount: 0,
    ...partial,
  };
}

describe("V2.1 regression mechanism — weak candidate preserve", () => {
  it("V2 clears weak name candidates; V2.1 preserves them", () => {
    const v2 = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    const v21 = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v2.status).toBe("AMBIGUOUS");
    expect(v2.candidateJobIds).toEqual([]);
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.candidateJobIds).toEqual(["job-rise"]);
  });

  it("preserved weak candidates cause THREAD CONFLICT when V2 would MATCH via thread", () => {
    const jobs = [riseUp, satStairs];
    // Weak unique OVERLAP on "up" → RISE UP only (disjoint from thread Job).
    const subject = "Team follow up";
    const threadHits = [
      { jobId: "job-sat-stairs", supportingEmailIds: ["other-email"] },
    ];

    const v2 = runJobMatchPipeline({
      subject,
      cleanBody: "",
      jobs,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits,
    });
    const v21 = runJobMatchPipeline({
      subject,
      cleanBody: "",
      jobs,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits,
    });

    // V2: weak name clears candidates → authoritative thread expands to MATCH.
    expect(v2.decision).toBe("MATCH");
    expect(v2.selectedJobId).toBe("job-sat-stairs");

    // V2.1: weak name keeps [riseUp]; STRONG thread to satStairs is disjoint → CONFLICT.
    expect(v21.decision).toBe("CONFLICT");
    expect(v21.selectedJobId).toBeNull();
  });

  it("attributes CORRECT→CONFLICT to weak-candidate preserve", () => {
    const attr = attributePolicyChange({
      baseline: {
        decision: "MATCH",
        outcome: "CORRECT_MATCH",
        predictedJobId: "job-sat-stairs",
        resolvingMarker: "THREAD",
        identityStrength: "WEAK",
        nameCandidateCount: 0,
        finalCandidateCount: 1,
      },
      proposed: {
        decision: "CONFLICT",
        outcome: "CONFLICT",
        predictedJobId: null,
        resolvingMarker: null,
        identityStrength: "WEAK",
        nameCandidateCount: 1,
        finalCandidateCount: 2,
      },
      trueJobId: "job-sat-stairs",
    });
    expect(attr.reason).toBe("WEAK_CANDIDATE_PRESERVE_THREAD_CONFLICT");
  });

  it("decision transition matrix reconciles and tracks newly wrong separately", () => {
    const rows = [
      {
        emailMessageId: "e1",
        subject: "a",
        trueJobId: "j1",
        trueJobName: "J1",
        groundTruthSource: "USER_ASSIGNED",
        baseline: {
          decision: "MATCH",
          outcome: "CORRECT_MATCH" as const,
          predictedJobId: "j1",
          predictedJobName: "J1",
          resolvingMarker: "THREAD",
          evidence: [],
          identityDiagnostics: null,
          markerCandidateCounts: { name: 0, contact: 0, thread: 1, final: 1 },
        },
        proposed: {
          decision: "CONFLICT",
          outcome: "CONFLICT" as const,
          predictedJobId: null,
          predictedJobName: null,
          resolvingMarker: null,
          evidence: [],
          identityDiagnostics: null,
          markerCandidateCounts: { name: 1, contact: 0, thread: 1, final: 2 },
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "CORRECT_MATCH",
          proposedOutcome: "CONFLICT",
          baselinePredictedJobId: "j1",
          proposedPredictedJobId: null,
        }),
        groundTruthReviewFlag: false,
      },
      {
        emailMessageId: "e2",
        subject: "b",
        trueJobId: "j2",
        trueJobName: "J2",
        groundTruthSource: "USER_ASSIGNED",
        baseline: {
          decision: "MATCH",
          outcome: "WRONG_MATCH" as const,
          predictedJobId: "jx",
          predictedJobName: "X",
          resolvingMarker: "CONTACT",
          evidence: [],
          identityDiagnostics: null,
        },
        proposed: {
          decision: "MATCH",
          outcome: "CORRECT_MATCH" as const,
          predictedJobId: "j2",
          predictedJobName: "J2",
          resolvingMarker: "CONTACT",
          evidence: [],
          identityDiagnostics: null,
          contactDiagnostics: {
            reason: "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT",
            associationClass: "SINGLE_JOB",
            authorityClass: "AUTHORITATIVE_EMAIL",
            resolutionAllowed: true,
            evidenceIndependentFromThread: true,
          },
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "WRONG_MATCH",
          proposedOutcome: "CORRECT_MATCH",
          baselinePredictedJobId: "jx",
          proposedPredictedJobId: "j2",
        }),
        groundTruthReviewFlag: false,
      },
    ];

    const report = buildIdentityCompareReport({
      baselinePolicy: "CONTEXT_AWARE_V2",
      proposedPolicy: "CONTEXT_AWARE_V2_1",
      baselineMetrics: emptyMetrics({
        totalEvaluated: 2,
        correctMatches: 1,
        wrongMatches: 1,
      }),
      proposedMetrics: emptyMetrics({
        totalEvaluated: 2,
        correctMatches: 1,
        conflict: 1,
      }),
      rows,
      runtimeMs: { baseline: 1, proposed: 1 },
    });

    expect(report.diagnostics).toBeTruthy();
    expect(report.diagnostics!.decisionTransitions.CORRECT_TO_CONFLICT).toBe(1);
    expect(report.diagnostics!.decisionTransitions.WRONG_TO_CORRECT).toBe(1);
    expect(report.diagnostics!.newlyWrong.wrongToCorrect).toBe(1);
    expect(
      classifyDecisionTransition({
        baselineOutcome: "CORRECT_MATCH",
        proposedOutcome: "CONFLICT",
      })
    ).toBe("CORRECT_TO_CONFLICT");

    const counts = emptyDecisionTransitionCounts();
    counts.CORRECT_TO_CONFLICT = 1;
    counts.WRONG_TO_CORRECT = 1;
    let sum = 0;
    for (const n of Object.values(counts)) sum += n;
    expect(sum).toBe(2);
  });
});
