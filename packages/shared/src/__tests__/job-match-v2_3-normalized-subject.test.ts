/**
 * CONTEXT_AWARE_V2_3 — normalized subject identity (independent of V2.1 / V2.2).
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import {
  joinPoolAwareCompoundTokens,
  projectIdentityTokensEquivalent,
} from "../jobs/job-project-identity-normalize.js";
import { listEvaluationSelectablePolicies } from "../jobs/job-match-policy-registry.js";

function job(
  id: string,
  name: string,
  extras?: Partial<JobRecordForMatch>
): JobRecordForMatch {
  return {
    id,
    jobNumber: extras?.jobNumber ?? (id.replace(/\D/g, "") || "1"),
    name,
    normalizedName: name.toLowerCase(),
    customerId: extras?.customerId ?? "cust-belt",
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const ramp = job("job-ramp", "Beltline Parking Ramp");
const bldg1 = job("job-b1", "Beltline Bldg #1");
const bldg2 = job("job-b2", "Beltline Bldg #2");
const beltPool = [ramp, bldg1, bldg2];

const satStairs = job("job-sat-stairs", "SAT - Exterior Stairs", {
  customerId: "cust-sat",
});
const satConc = job("job-sat-conc", "SAT - Concessions", {
  customerId: "cust-sat",
});

describe("CONTEXT_AWARE_V2_3 normalized subject identity", () => {
  it("is registered for model selection", () => {
    const ids = listEvaluationSelectablePolicies().map((e) => e.id);
    expect(ids).toContain("CONTEXT_AWARE_V2_3");
    expect(
      listEvaluationSelectablePolicies().find(
        (e) => e.id === "CONTEXT_AWARE_V2_3"
      )?.displayName
    ).toBe("V2.3 — Normalized Subject Identity");
  });

  it("Belt-line Parking Ramp → Beltline Parking Ramp", () => {
    const v23 = runJobNameMarker({
      subject: "Belt-line parking ramp",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("MATCH");
    expect(v23.selectedJobId).toBe("job-ramp");
    expect([
      "NORMALIZED_SUBJECT_IDENTITY",
      "PROJECT_ALIAS_NORMALIZATION",
      "DISTINCTIVE_SUBJECT_TERMS",
    ]).toContain(v23.identityDiagnostics.reason);
    expect(v23.identityDiagnostics.normalizationApplied?.length ?? 0).toBeGreaterThan(
      0
    );
  });

  it("Beltline Building 1 → Beltline Bldg #1", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Building 1- Structural steel shops",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("MATCH");
    expect(v23.selectedJobId).toBe("job-b1");
  });

  it("Beltline Bldg #1 → Beltline Bldg #1", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Bldg #1 shop drawings",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("MATCH");
    expect(v23.selectedJobId).toBe("job-b1");
  });

  it("Beltline Building #1 → Beltline Bldg #1", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Building #1 for approval",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("MATCH");
    expect(v23.selectedJobId).toBe("job-b1");
  });

  it("Beltline Building 2 does not match Building 1", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Building 2 structural shops",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.selectedJobId).toBe("job-b2");
    expect(v23.selectedJobId).not.toBe("job-b1");
  });

  it("Beltline Parking Ramp does not match Building 1", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Parking Ramp update",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("MATCH");
    expect(v23.selectedJobId).toBe("job-ramp");
    expect(v23.selectedJobId).not.toBe("job-b1");
  });

  it("generic Beltline subject remains ambiguous", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline drawing revisions",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("AMBIGUOUS");
    expect(v23.selectedJobId).toBeNull();
    expect([
      "INSUFFICIENT_DISTINGUISHING_EVIDENCE",
      "COMPETING_PROJECT_CANDIDATES",
      "SHARED_PROJECT_IDENTIFIER",
      "AMBIGUOUS_CANDIDATES",
      "GENERIC_TERM_ONLY",
      "SHARED_CUSTOMER_IDENTITY",
    ]).toContain(v23.identityDiagnostics.reason);
  });

  it("strong Building 1 subject beats incidental Parking Ramp body mention", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Building 1 - Structural steel shops",
      cleanBody:
        "Parking ramp drawings will be issued separately.",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("MATCH");
    expect(v23.selectedJobId).toBe("job-b1");
    expect([
      "INCIDENTAL_BODY_REFERENCE",
      "NORMALIZED_SUBJECT_IDENTITY",
      "DISTINCTIVE_SUBJECT_TERMS",
      "ABBREVIATION_EQUIVALENCE",
    ]).toContain(v23.identityDiagnostics.reason);
    expect(v23.identityDiagnostics.competingJobIds).toContain("job-ramp");
  });

  it("explicit contradictory body evidence is not silently ignored", () => {
    const v23 = runJobNameMarker({
      subject: "Beltline Building 1 - Structural steel shops",
      cleanBody:
        "Correction: these drawings are actually for the parking ramp, not Building 1.",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.selectedJobId).toBeNull();
    expect(v23.status).toBe("AMBIGUOUS");
    expect(v23.identityDiagnostics.reason).toBe("EXPLICIT_BODY_CONTRADICTION");
  });

  it("shared SAT identifier without distinguishing evidence remains ambiguous", () => {
    const v23 = runJobNameMarker({
      subject: "SAT project updates",
      cleanBody: "",
      jobs: [satStairs, satConc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.status).toBe("AMBIGUOUS");
    expect(v23.selectedJobId).toBeNull();
  });

  it("production V2 behavior remains unchanged on Belt-line hyphen case", () => {
    const v2 = runJobNameMarker({
      subject: "Belt-line parking ramp",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.selectedJobId).toBeNull();
    expect(v2.status).toBe("AMBIGUOUS");
  });

  it("V2.1 does not inherit V2.3 normalized subject recovery", () => {
    const v21 = runJobNameMarker({
      subject: "Belt-line parking ramp",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
  });

  it("V2.2 does not inherit V2.3 normalized subject recovery", () => {
    const v22 = runJobNameMarker({
      subject: "Belt-line parking ramp",
      cleanBody: "",
      jobs: beltPool,
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.selectedJobId).toBeNull();
  });

  it("removed Jobs are excluded", () => {
    const removed = job("job-ramp-gone", "Beltline Parking Ramp", {
      archivedAt: new Date("2024-01-01"),
    });
    const v23 = runJobNameMarker({
      subject: "Belt-line parking ramp",
      cleanBody: "",
      jobs: [removed, bldg1, bldg2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.selectedJobId).not.toBe("job-ramp-gone");
  });

  it("unawarded active bids are excluded", () => {
    const bid = job("job-ramp-bid", "Beltline Parking Ramp", {
      status: "BIDDING",
    });
    const v23 = runJobNameMarker({
      subject: "Belt-line parking ramp",
      cleanBody: "",
      jobs: [bid, bldg1, bldg2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.selectedJobId).not.toBe("job-ramp-bid");
  });

  it("internal Job numbers are never used as matching evidence", () => {
    const numbered = job("job-num", "Beltline Parking Ramp", {
      jobNumber: "9911",
    });
    const v23 = runJobNameMarker({
      subject: "Job 9911 update",
      cleanBody: "",
      jobs: [numbered, bldg1, bldg2],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
    });
    expect(v23.selectedJobId).toBeNull();
  });

  it("pool-aware compound join is controlled", () => {
    const vocab = new Set(["beltline", "parking", "ramp"]);
    expect(
      joinPoolAwareCompoundTokens(["belt", "line", "parking", "ramp"], vocab)
    ).toEqual({
      tokens: ["beltline", "parking", "ramp"],
      compoundsJoined: ["belt+line->beltline"],
    });
    // Without vocabulary entry, do not join arbitrary pairs.
    expect(
      joinPoolAwareCompoundTokens(["steel", "shops"], new Set(["beltline"]))
    ).toEqual({
      tokens: ["steel", "shops"],
      compoundsJoined: [],
    });
    expect(projectIdentityTokensEquivalent("bldg", "building")).toBe(true);
  });
});
