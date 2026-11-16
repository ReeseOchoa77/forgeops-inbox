/**
 * CONTEXT_AWARE_V2_2 = production V2 + unique project token rule ONLY.
 * Title-gap / scope-family bundled recovery from the prior experiment is inactive.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import {
  buildWorkspaceProjectIdentityIndex,
  competingJobIdsForToken,
  projectTokenUniqueness,
} from "../jobs/job-project-identity-index.js";
import { getProductionJobMatchIdentityPolicy } from "../jobs/job-match-policy-registry.js";
import { isAuthoritativeUniqueProjectToken } from "../jobs/job-name-identity-policy.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";

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
    customerId: extras?.customerId ?? null,
    externalRef: null,
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
const cpac = job("job-cpac", "CPAC - Stagehouse", { customerId: "cust-cpac" });
const bscWh = job("job-bsc-wh", "BSC Materials 360 Warehouse", {
  customerId: "cust-bsc",
});
const northside = job("job-north", "Northside Steel Fabrication");

describe("CONTEXT_AWARE_V2_2 unique-token experiment", () => {
  it("production remains CONTEXT_AWARE_V2", () => {
    expect(getProductionJobMatchIdentityPolicy()).toBe("CONTEXT_AWARE_V2");
  });

  it("V2 behavior unchanged for unique SAT alone", () => {
    const v2 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    expect(v2.status).toBe("AMBIGUOUS");
    expect(v2.selectedJobId).toBeNull();
  });

  describe("unique project identifier", () => {
    it("unique SAT alone is strong UNIQUE_PROJECT_TOKEN", () => {
      const v22 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
      expect(v22.identityDiagnostics.reason).toBe("UNIQUE_PROJECT_TOKEN");
      expect(v22.identityDiagnostics.projectTokenUniqueness).toBe("unique");
      expect(v22.identityDiagnostics.strongIdentityAnchor).toBe(true);
    });

    it("unique SAT + Stair is UNIQUE_TOKEN_SCOPE_MATCH or UNIQUE_PROJECT_TOKEN", () => {
      const v22 = runJobNameMarker({
        subject: "SAT Stair 34",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
      expect([
        "UNIQUE_TOKEN_SCOPE_MATCH",
        "UNIQUE_PROJECT_TOKEN",
      ]).toContain(v22.identityDiagnostics.reason);
    });

    it("unique CPAC alone matches", () => {
      const v22 = runJobNameMarker({
        subject: "CPAC update",
        cleanBody: "",
        jobs: [cpac],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-cpac");
      expect(v22.identityDiagnostics.reason).toBe("UNIQUE_PROJECT_TOKEN");
    });

    it("Saturday does not match SAT (token boundary)", () => {
      const v22 = runJobNameMarker({
        subject: "Saturday testing",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
    });

    it("non-head unique short token 'ext' alone does not match", () => {
      const v22 = runJobNameMarker({
        subject: "ext delivery",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
    });
  });

  describe("shared project identifier", () => {
    it("shared SAT alone stays unresolved", () => {
      const v22 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
    });

    it("shared SAT + Stair does not use title-gap under V2.2", () => {
      const v22 = runJobNameMarker({
        subject: "SAT Stair 34",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).not.toBe(
        "GAP_TOLERANT_PROJECT_MATCH"
      );
    });

    it("adding a second SAT Job flips SAT from unique to shared in the index", () => {
      const one = buildWorkspaceProjectIdentityIndex({ jobs: [satStairs] });
      expect(projectTokenUniqueness(one, "sat")).toBe("unique");
      const two = buildWorkspaceProjectIdentityIndex({
        jobs: [satStairs, satSteel],
      });
      expect(projectTokenUniqueness(two, "sat")).toBe("shared");
      expect(competingJobIdsForToken(two, "sat").sort()).toEqual([
        "job-sat-stairs",
        "job-sat-steel",
      ]);
    });
  });

  describe("title-gap isolation", () => {
    it("gap-tolerant subject that V2.1 would resolve stays unresolved when SAT is shared", () => {
      const input = {
        subject: "2416 SAT TDP - Stair 34 Field Use Drawings",
        cleanBody: "",
        jobs: [satStairs, satSteel],
      };
      const v21 = runJobNameMarker({
        ...input,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      const v22 = runJobNameMarker({
        ...input,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v21.status).toBe("MATCH");
      expect(v22.selectedJobId).toBeNull();
    });
  });

  describe("safety", () => {
    it("generic Steel alone does not force Northside", () => {
      const v22 = runJobNameMarker({
        subject: "Steel pricing",
        cleanBody: "",
        jobs: [satStairs, northside],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).toBe("GENERIC_TERM_ONLY");
    });

    it("contradictory unique project tokens stay unresolved", () => {
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

    it("internal job number in subject is not identity evidence", () => {
      const numbered = job("job-num", "Unrelated Project Alpha", {
        jobNumber: "2169",
      });
      const v22 = runJobNameMarker({
        subject: "Job 2169 update",
        cleanBody: "",
        jobs: [numbered, satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).not.toBe("job-num");
    });

    it("V2.2 clears weak candidates", () => {
      const v22 = runJobNameMarker({
        subject: "Team follow up",
        cleanBody: "",
        jobs: [job("job-rise", "RISE UP")],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("AMBIGUOUS");
      expect(v22.candidateJobIds).toEqual([]);
    });

    it("isAuthoritativeUniqueProjectToken rejects non-head short tokens", () => {
      const peer = {
        jobId: satStairs.id,
        customerId: satStairs.customerId,
        contentTokens: ["sat", "15", "ext", "stairs"],
        phraseTokenLists: [["sat", "15", "ext", "stairs"]],
        distinguishingTokens: [],
      };
      expect(isAuthoritativeUniqueProjectToken("sat", peer)).toBe(true);
      expect(isAuthoritativeUniqueProjectToken("ext", peer)).toBe(false);
    });

    it("BSC warehouse unique token still works when alone", () => {
      const v22 = runJobNameMarker({
        subject: "BSC update",
        cleanBody: "",
        jobs: [bscWh],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-bsc-wh");
    });
  });
});
