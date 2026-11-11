import { describe, expect, it } from "vitest";
import {
  assertTransitionsReconcile,
  buildIdentityCompareReport,
  classifyMatcherTransition,
  emptyTransitionCounts,
} from "../jobs/job-match-identity-compare.js";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";
import {
  JOB_MATCH_IDENTITY_POLICY_BASELINE,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
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

const riseUp = job("job-rise", "RISE UP");
const satStairs = job("job-stairs", "SAT - 15 Ext Stairs");
const beltBuilding = job("job-belt-bldg", "Beltline Building #1");
const beltStairs = job("job-belt-stairs", "Beltline Stairs");
const beamJob = job("job-beam", "Main Street Beam Repair");
const rtuJob = job("job-rtu", "RTU frame");
const turningPoint = job("job-point", "Turning Point");
const fixAuto = job("job-auto", "Fix Auto");
const mgcc = job("job-mgcc", "Municipal Garage");

describe("CONTEXT_AWARE_V1 identity policy scenarios", () => {
  it("A — generic word only does not match RISE UP from 'up'", () => {
    const baseline = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
    });
    expect(baseline.status).toBe("MATCH");
    expect(baseline.selectedJobId).toBe("job-rise");

    const v1 = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("AMBIGUOUS");
    expect(v1.selectedJobId).toBeNull();
    expect(v1.candidateJobIds).toEqual(["job-rise"]);
    expect(v1.identityDiagnostics.reason).toBe("GENERIC_TERM_ONLY");
    expect(v1.identityDiagnostics.resolutionAllowed).toBe(false);
  });

  it("B — distinctive full phrase remains strong", () => {
    const v1 = runJobNameMarker({
      subject: "Rise Up Center - steel shop drawings",
      cleanBody: "",
      jobs: [riseUp, satStairs, beltBuilding],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("MATCH");
    expect(v1.selectedJobId).toBe("job-rise");
    expect(v1.identityDiagnostics.strongIdentityAnchor).toBe(true);
  });

  it("C — shared project prefix does not arbitrarily select", () => {
    const v1 = runJobNameMarker({
      subject: "Beltline - material delivery",
      cleanBody: "",
      jobs: [beltBuilding, beltStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("AMBIGUOUS");
    expect(v1.selectedJobId).toBeNull();
    expect(v1.candidateJobIds.sort()).toEqual([
      "job-belt-bldg",
      "job-belt-stairs",
    ]);
  });

  it("D — distinguishing phrase selects Beltline Stairs", () => {
    const v1 = runJobNameMarker({
      subject: "Beltline Stairs - shop drawings",
      cleanBody: "",
      jobs: [beltBuilding, beltStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("MATCH");
    expect(v1.selectedJobId).toBe("job-belt-stairs");
    expect(v1.identityDiagnostics.strongIdentityAnchor).toBe(true);
  });

  it("E — generic construction term stairs alone does not match", () => {
    const baseline = runJobNameMarker({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
    });
    expect(baseline.status).toBe("MATCH");

    const v1 = runJobNameMarker({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("AMBIGUOUS");
    expect(v1.identityDiagnostics.reason).toBe("GENERIC_TERM_ONLY");
  });

  it("F — weak identity does not block strong thread resolution", () => {
    const result = runJobMatchPipeline({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs, riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits: [{ jobId: "job-stairs", supportingEmailIds: ["other-email"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-stairs");
    expect(result.markerTrace?.find((t) => t.marker === "NAME")?.status).toBe(
      "AMBIGUOUS"
    );
    expect(result.markerTrace?.find((t) => t.marker === "THREAD")?.status).toBe(
      "MATCH"
    );
  });

  it("G — multiple distinct project names stay ambiguous", () => {
    const v1 = runJobNameMarker({
      subject: "Alleghany Apartments and Beltline Stairs drawings",
      cleanBody: "",
      jobs: [
        job("job-alleghany", "Alleghany Apartments"),
        beltStairs,
      ],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("AMBIGUOUS");
    expect(v1.selectedJobId).toBeNull();
    expect(v1.candidateJobIds.length).toBeGreaterThanOrEqual(2);
  });

  it("H — alias collision does not arbitrarily match", () => {
    const aliases: JobAliasForMatch[] = [
      { jobId: "job-a", alias: "Nova", normalizedAlias: "nova" },
      { jobId: "job-b", alias: "Nova", normalizedAlias: "nova" },
    ];
    const v1 = runJobNameMarker({
      subject: "Nova RFI",
      cleanBody: "",
      jobs: [job("job-a", "Project Alpha"), job("job-b", "Project Beta")],
      aliases,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("AMBIGUOUS");
    expect(v1.selectedJobId).toBeNull();
  });

  it("I — internal Job number remains disabled as matching evidence", () => {
    const v1 = runJobNameMarker({
      subject: "Please update job 2191",
      cleanBody: "",
      jobs: [job("job-2191", "Alleghany Apartments", { jobNumber: "2191" })],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("NO_MATCH");
    expect(v1.selectedJobId).toBeNull();
  });

  it("J — holdout: evaluated email is excluded from thread evidence by caller", () => {
    // Pipeline itself receives pre-filtered threadHits; empty holdout → no self-evidence.
    const result = runJobMatchPipeline({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
      threadHits: [],
    });
    expect(result.decision).not.toBe("MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("K — baseline policy reproduces unique OVERLAP MATCH (parity)", () => {
    for (const [subject, j] of [
      ["Team follow up", riseUp],
      ["beam delivery", beamJob],
      ["rtu inspection", rtuJob],
      ["point of contact", turningPoint],
      ["auto quote", fixAuto],
    ] as const) {
      const baseline = runJobNameMarker({
        subject,
        cleanBody: "",
        jobs: [j],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_BASELINE,
      });
      expect(baseline.status).toBe("MATCH");
      expect(baseline.selectedJobId).toBe(j.id);
      expect(baseline.identityDiagnostics.reason).toBe("BASELINE_UNIQUE_OVERLAP");
    }
  });

  it("L — paired transition counts reconcile to evaluated count", () => {
    const metrics = (overrides: Partial<HistoricalEvalMetrics>): HistoricalEvalMetrics => ({
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
      ...overrides,
    });

    const rows = [
      {
        emailMessageId: "e1",
        subject: "a",
        trueJobId: "j1",
        trueJobName: "J1",
        groundTruthSource: "USER_ASSIGNED",
        baseline: {
          decision: "MATCH",
          outcome: "WRONG_MATCH" as const,
          predictedJobId: "jx",
          predictedJobName: "X",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        proposed: {
          decision: "AMBIGUOUS",
          outcome: "AMBIGUOUS" as const,
          predictedJobId: null,
          predictedJobName: null,
          resolvingMarker: null,
          evidence: [],
          identityDiagnostics: null,
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "WRONG_MATCH",
          proposedOutcome: "AMBIGUOUS",
          baselinePredictedJobId: "jx",
          proposedPredictedJobId: null,
        }),
        groundTruthReviewFlag: false,
      },
      {
        emailMessageId: "e2",
        subject: "b",
        trueJobId: "j1",
        trueJobName: "J1",
        groundTruthSource: "USER_ASSIGNED",
        baseline: {
          decision: "MATCH",
          outcome: "CORRECT_MATCH" as const,
          predictedJobId: "j1",
          predictedJobName: "J1",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        proposed: {
          decision: "MATCH",
          outcome: "CORRECT_MATCH" as const,
          predictedJobId: "j1",
          predictedJobName: "J1",
          resolvingMarker: "NAME",
          evidence: [],
          identityDiagnostics: null,
        },
        transition: classifyMatcherTransition({
          baselineOutcome: "CORRECT_MATCH",
          proposedOutcome: "CORRECT_MATCH",
          baselinePredictedJobId: "j1",
          proposedPredictedJobId: "j1",
        }),
        groundTruthReviewFlag: false,
      },
    ];

    const report = buildIdentityCompareReport({
      baselineMetrics: metrics({
        totalEvaluated: 2,
        correctMatches: 1,
        wrongMatches: 1,
      }),
      proposedMetrics: metrics({
        totalEvaluated: 2,
        correctMatches: 1,
        ambiguous: 1,
      }),
      rows,
      runtimeMs: { baseline: 10, proposed: 12 },
    });
    expect(report.transitions.WRONG_TO_UNRESOLVED).toBe(1);
    expect(report.transitions.CORRECT_TO_CORRECT).toBe(1);
    expect(assertTransitionsReconcile(report.transitions, rows.length)).toBe(
      true
    );
    expect(
      assertTransitionsReconcile(emptyTransitionCounts(), 0)
    ).toBe(true);
  });

  it("distinctive single-token alias MGCC remains strong under V1", () => {
    const v1 = runJobNameMarker({
      subject: "MGCC shop drawings",
      cleanBody: "",
      jobs: [mgcc, satStairs],
      aliases: [
        {
          jobId: "job-mgcc",
          alias: "MGCC",
          normalizedAlias: "mgcc",
        },
      ],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V1,
    });
    expect(v1.status).toBe("MATCH");
    expect(v1.selectedJobId).toBe("job-mgcc");
    expect(v1.identityDiagnostics.reason).toBe("DISTINCTIVE_SINGLE_TOKEN");
  });

  it("production default remains BASELINE when policy omitted", () => {
    const result = runJobNameMarker({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [riseUp],
    });
    expect(result.identityPolicy).toBe("BASELINE");
    expect(result.status).toBe("MATCH");
  });
});
