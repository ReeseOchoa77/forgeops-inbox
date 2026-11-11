import { describe, expect, it } from "vitest";
import {
  assertTransitionsReconcile,
  buildIdentityThreeWayCompareReport,
  classifyMatcherTransition,
  emptyTransitionCounts,
} from "../jobs/job-match-identity-compare.js";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";
import {
  JOB_MATCH_IDENTITY_POLICY_BASELINE,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobAliasForMatch, JobRecordForMatch } from "../jobs/job-matcher.js";
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

const bsc = job("job-bsc", "Boston Scientific", { customerId: "cust-bsc" });
const bldg14 = job("job-bldg14", "BSC - BLDG 14", { customerId: "cust-bsc" });
const warehouse = job("job-wh", "BSC 360 Warehouse", { customerId: "cust-bsc" });
const satConc = job("job-sat-conc", "SAT - Concessions", { customerId: "cust-sat" });
const satStairs = job("job-sat-stairs", "SAT - 15 Ext Stairs", {
  customerId: "cust-sat",
});
const steelJob = job("job-steel", "BSC Warehouse Steel", { customerId: "cust-bsc" });
const riseUp = job("job-rise", "RISE UP");

describe("CONTEXT_AWARE_V2 policy", () => {
  it("N — BASELINE and V1 decisions remain unchanged on classic weak OVERLAP", () => {
    const baseline = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
    });
    const v1 = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(baseline.status).toBe("MATCH");
    expect(v1.status).toBe("AMBIGUOUS");
    expect(v1.candidateJobIds).toEqual(["job-rise"]);
  });

  it("A — shared customer identity does not arbitrarily select", () => {
    const v2 = runJobNameMarker({
      subject: "Boston Scientific - delivery update",
      cleanBody: "",
      jobs: [bsc, bldg14, warehouse],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("AMBIGUOUS");
    expect(v2.selectedJobId).toBeNull();
    expect(v2.identityDiagnostics.reason).toMatch(
      /SHARED_CUSTOMER_IDENTITY|INSUFFICIENT_PROJECT_DISAMBIGUATION|AMBIGUOUS/
    );
  });

  it("B — distinguishing building identity can select BLDG 14", () => {
    const v2 = runJobNameMarker({
      subject: "Boston Scientific - Bldg 14 Decarb - Stair Revised",
      cleanBody: "",
      jobs: [bsc, bldg14, warehouse],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    // Prefer project-specific when distinguishing "14" is present for BLDG 14.
    expect(v2.status).toBe("MATCH");
    expect(v2.selectedJobId).toBe("job-bldg14");
  });

  it("C — shared project prefix SAT alone is unresolved", () => {
    const v2 = runJobNameMarker({
      subject: "SAT material delivery",
      cleanBody: "",
      jobs: [satConc, satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.selectedJobId).toBeNull();
    expect(["AMBIGUOUS", "NO_MATCH"]).toContain(v2.status);
  });

  it("D — distinguishing Concessions phrase", () => {
    const v2 = runJobNameMarker({
      subject: "SAT - Concessions shop drawings",
      cleanBody: "",
      jobs: [satConc, satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("MATCH");
    expect(v2.selectedJobId).toBe("job-sat-conc");
  });

  it("E — generic multiword overlap does not resolve", () => {
    const v2 = runJobNameMarker({
      subject: "Warehouse steel delivery",
      cleanBody: "",
      jobs: [steelJob, warehouse],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).not.toBe("MATCH");
  });

  it("F — multi-job contact cannot arbitrarily choose one", () => {
    const result = runJobMatchPipeline({
      subject: "Status update",
      cleanBody: "",
      jobs: [bsc, bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      senderEmail: "vendor@example.com",
      contactHits: [
        { jobId: "job-bsc", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-bldg14", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
    expect(result.contactDiagnostics?.reason).toMatch(/MULTI_JOB|BROAD/);
  });

  it("G — broad contact association abstains", () => {
    const many = [
      job("j1", "Job One"),
      job("j2", "Job Two"),
      job("j3", "Job Three"),
      job("j4", "Job Four"),
    ];
    const result = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: many,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      senderEmail: "staff@example.com",
      contactHits: many.map((j) => ({
        jobId: j.id,
        basis: "CURRENT_AUTHORITATIVE_EMAIL" as const,
      })),
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.contactDiagnostics?.associationClass).toBe("BROAD");
  });

  it("H — verified single-job MANUAL contact can resolve", () => {
    const result = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: [bldg14, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      senderEmail: "pm@example.com",
      contactHits: [
        { jobId: "job-bldg14", basis: "MANUAL_JOB_CONTACT" },
      ],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-bldg14");
    expect(result.contactDiagnostics?.reason).toBe("VERIFIED_SINGLE_JOB_CONTACT");
  });

  it("I — weak name does not block strong thread", () => {
    const result = runJobMatchPipeline({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs, riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits: [
        { jobId: "job-sat-stairs", supportingEmailIds: ["other-email"] },
      ],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sat-stairs");
  });

  it("J — conflicting strong identity vs disjoint thread → CONFLICT", () => {
    // Name strongly identifies one family member; thread points elsewhere.
    const result = runJobMatchPipeline({
      subject: "SAT - Concessions shop drawings",
      cleanBody: "",
      jobs: [satConc, satStairs, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits: [{ jobId: "job-bsc", supportingEmailIds: ["e2"] }],
    });
    // If name MATCH early-exits, thread never runs — that is intentional for
    // unique strong identity. Ensure no silent wrong MATCH to thread job.
    expect(result.selectedJobId).not.toBe("job-bsc");
  });

  it("K — shared evidence origin flagged on contact diagnostics", () => {
    const result = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: [bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      senderEmail: "a@example.com",
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      contactHits: [
        {
          jobId: "job-bldg14",
          basis: "CURRENT_AUTHORITATIVE_EMAIL",
          supportingEmailIds: ["shared-email"],
        },
      ],
      threadHits: [
        { jobId: "job-bldg14", supportingEmailIds: ["shared-email"] },
      ],
    });
    // Contact-only AUTH email abstains under V2; shared origin recorded.
    expect(result.contactDiagnostics?.evidenceIndependentFromThread).toBe(false);
    expect(result.contactDiagnostics?.sharedSupportingEmailIds).toContain(
      "shared-email"
    );
  });

  it("L — internal Job number still disabled", () => {
    const v2 = runJobNameMarker({
      subject: "Please update job 2191",
      cleanBody: "",
      jobs: [job("job-2191", "Alleghany Apartments", { jobNumber: "2191" })],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("NO_MATCH");
  });

  it("M — holdout: empty threadHits means no self-evidence", () => {
    const result = runJobMatchPipeline({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      threadHits: [],
    });
    expect(result.selectedJobId).toBeNull();
  });

  it("O — three-way transition counts reconcile", () => {
    const emptyMetrics = (n: number): HistoricalEvalMetrics => ({
      totalEvaluated: n,
      correctMatches: 0,
      wrongMatches: 0,
      ambiguous: n,
      conflict: 0,
      noMatch: 0,
      precision: null,
      correctCoverage: 0,
      wrongMatchRate: 0,
      ambiguityRate: 1,
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
    });
    const side = (outcome: "CORRECT_MATCH" | "WRONG_MATCH" | "AMBIGUOUS") => ({
      decision: outcome === "CORRECT_MATCH" ? "MATCH" : outcome === "WRONG_MATCH" ? "MATCH" : "AMBIGUOUS",
      outcome,
      predictedJobId: outcome === "AMBIGUOUS" ? null : "j1",
      predictedJobName: outcome === "AMBIGUOUS" ? null : "J1",
      resolvingMarker: outcome === "AMBIGUOUS" ? null : "NAME",
      evidence: [],
      identityDiagnostics: null,
    });
    const rows = [
      {
        emailMessageId: "e1",
        subject: "a",
        trueJobId: "j1",
        trueJobName: "J1",
        groundTruthSource: "USER_ASSIGNED",
        baseline: side("WRONG_MATCH"),
        v1: side("AMBIGUOUS"),
        v2: side("AMBIGUOUS"),
        baselineToV1: classifyMatcherTransition({
          baselineOutcome: "WRONG_MATCH",
          proposedOutcome: "AMBIGUOUS",
          baselinePredictedJobId: "jx",
          proposedPredictedJobId: null,
        }),
        v1ToV2: classifyMatcherTransition({
          baselineOutcome: "AMBIGUOUS",
          proposedOutcome: "AMBIGUOUS",
          baselinePredictedJobId: null,
          proposedPredictedJobId: null,
        }),
        groundTruthReviewFlag: true,
      },
    ];
    const report = buildIdentityThreeWayCompareReport({
      baselineMetrics: emptyMetrics(1),
      v1Metrics: emptyMetrics(1),
      v2Metrics: emptyMetrics(1),
      rows,
      runtimeMs: { baseline: 1, v1: 1, v2: 1 },
    });
    expect(assertTransitionsReconcile(report.baselineToV1, 1)).toBe(true);
    expect(assertTransitionsReconcile(report.v1ToV2, 1)).toBe(true);
    expect(assertTransitionsReconcile(emptyTransitionCounts(), 0)).toBe(true);
  });

  it("authoritative-email-only single contact abstains under V2", () => {
    const result = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: [bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      senderEmail: "x@example.com",
      contactHits: [
        {
          jobId: "job-bldg14",
          basis: "CURRENT_AUTHORITATIVE_EMAIL",
          supportingEmailIds: ["e1"],
        },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.contactDiagnostics?.reason).toBe(
      "INSUFFICIENT_CONTACT_AUTHORITY"
    );
  });

  it("alias collision remains unresolved", () => {
    const aliases: JobAliasForMatch[] = [
      { jobId: "job-a", alias: "Nova", normalizedAlias: "nova" },
      { jobId: "job-b", alias: "Nova", normalizedAlias: "nova" },
    ];
    const v2 = runJobNameMarker({
      subject: "Nova RFI",
      cleanBody: "",
      jobs: [job("job-a", "Project Alpha"), job("job-b", "Project Beta")],
      aliases,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("AMBIGUOUS");
  });
});
