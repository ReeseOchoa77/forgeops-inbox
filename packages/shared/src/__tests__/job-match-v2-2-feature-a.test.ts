/**
 * Feature A only — unique project token matching under CONTEXT_AWARE_V2_2.
 * Does not cover gap-tolerant / scope / family features beyond this rule.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import {
  buildWorkspaceProjectIdentityIndex,
  projectTokenUniqueness,
} from "../jobs/job-project-identity-index.js";
import { getProductionJobMatchIdentityPolicy } from "../jobs/job-match-policy-registry.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";

function job(
  id: string,
  name: string,
  extras?: Partial<JobRecordForMatch>
): JobRecordForMatch {
  return {
    id,
    jobNumber: extras?.jobNumber ?? "1",
    name,
    normalizedName: name.toLowerCase(),
    customerId: extras?.customerId ?? null,
    externalRef: extras?.externalRef ?? null,
    status: "ACTIVE",
    ...extras,
  };
}

const satStairs = job("job-sat-stairs", "SAT - 15 Ext Stairs", {
  customerId: "cust-sat",
});
const satSteel = job("job-sat-steel", "SAT - Structural Steel", {
  customerId: "cust-sat",
});
const cpac = job("job-cpac", "CPAC Stagehouse Rails");
const bsc = job("job-bsc", "BSC Materials 360 Warehouse");
const steelOnly = job("job-steel", "Northside Steel Fabrication");

describe("V2.2 Feature A — unique project token matching", () => {
  it("production default remains CONTEXT_AWARE_V2", () => {
    expect(getProductionJobMatchIdentityPolicy()).toBe("CONTEXT_AWARE_V2");
  });

  it("1 — one SAT Job + 'SAT testing complete' → MATCH via UNIQUE_PROJECT_TOKEN", () => {
    const v22 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs, cpac, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.status).toBe("MATCH");
    expect(v22.selectedJobId).toBe("job-sat-stairs");
    expect(v22.identityDiagnostics.reason).toBe("UNIQUE_PROJECT_TOKEN");
    expect(v22.identityDiagnostics.identityStrength).toBe("STRONG");
    expect(v22.identityDiagnostics.projectTokenUniqueness).toBe("unique");
    expect(v22.identityDiagnostics.matchedTerms).toEqual(
      expect.arrayContaining(["sat"])
    );
  });

  it("2 — one SAT Job + 'SAT Stair 34' → MATCH (unique token with or without scope)", () => {
    const v22 = runJobNameMarker({
      subject: "SAT Stair 34",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.status).toBe("MATCH");
    expect(v22.selectedJobId).toBe("job-sat-stairs");
  });

  it("3 — two SAT Jobs + 'SAT testing complete' → no unique-token promotion", () => {
    const v22 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs, satSteel],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.selectedJobId).toBeNull();
    expect(["AMBIGUOUS", "NO_MATCH"]).toContain(v22.status);
    expect(v22.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
  });

  it("4 — 'Saturday testing' does not match SAT (token boundary)", () => {
    const v22 = runJobNameMarker({
      subject: "Saturday testing",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.selectedJobId).toBeNull();
    expect(v22.status).toBe("NO_MATCH");
  });

  it("5 — unique generic 'Steel' alone is not promoted", () => {
    const v22 = runJobNameMarker({
      subject: "Steel pricing",
      cleanBody: "",
      jobs: [steelOnly],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.selectedJobId).toBeNull();
    expect(v22.identityDiagnostics.reason).toBe("GENERIC_TERM_ONLY");
    expect(v22.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
  });

  it("6 — unique SAT plus conflicting CPAC does not force SAT", () => {
    const v22 = runJobNameMarker({
      subject: "SAT and CPAC delivery",
      cleanBody: "",
      jobs: [satStairs, cpac],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.selectedJobId).toBeNull();
    expect(v22.identityDiagnostics.reason).toBe(
      "CONTRADICTORY_PROJECT_EVIDENCE"
    );
  });

  it("7 — adding a second SAT Job flips SAT from unique to shared", () => {
    const one = buildWorkspaceProjectIdentityIndex({ jobs: [satStairs] });
    expect(projectTokenUniqueness(one, "sat")).toBe("unique");
    const two = buildWorkspaceProjectIdentityIndex({
      jobs: [satStairs, satSteel],
    });
    expect(projectTokenUniqueness(two, "sat")).toBe("shared");
  });

  it("8 — V2 remains unchanged for unique SAT alone (still AMBIGUOUS)", () => {
    const v2 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs, cpac, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("AMBIGUOUS");
    expect(v2.selectedJobId).toBeNull();
    expect(v2.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
  });
});
