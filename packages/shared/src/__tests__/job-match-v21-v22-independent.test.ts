/**
 * Independent experiment isolation:
 * V2.1 = V2 + title-gap ONLY
 * V2.2 = V2 + unique-token ONLY
 * Neither inherits the other's rule; production V2 stays unchanged.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import { JOB_MATCH_IDENTITY_EXPERIMENT_REVISION } from "../jobs/job-name-identity-policy.js";
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
const satWarehouse = job("job-sat-wh", "SAT - Warehouse Expansion", {
  customerId: "cust-sat",
  status: "REMOVED",
});
const cpac = job("job-cpac", "CPAC Stagehouse Rails");
const bsc = job("job-bsc", "BSC 360 Warehouse");
const steelOnly = job("job-steel", "Northside Steel Fabrication");

describe("independent V2.1 / V2.2 experiments", () => {
  it("production default remains CONTEXT_AWARE_V2", () => {
    expect(getProductionJobMatchIdentityPolicy()).toBe("CONTEXT_AWARE_V2");
  });

  it("stamps the independent-experiment revision", () => {
    expect(JOB_MATCH_IDENTITY_EXPERIMENT_REVISION).toBe(
      "independent-v21-title-gap-v22-unique-token-r1"
    );
  });

  describe("V2 baseline unchanged", () => {
    it("unique SAT alone stays AMBIGUOUS (no unique-token, no title-gap)", () => {
      const v2 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, cpac, bsc],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      });
      expect(v2.status).toBe("AMBIGUOUS");
      expect(v2.selectedJobId).toBeNull();
    });

    it("gap-tolerant SAT TDP Stair does not MATCH under V2", () => {
      const v2 = runJobNameMarker({
        subject: "SAT 15 exterior access stairs installation",
        cleanBody: "",
        jobs: [satStairs, cpac],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      });
      expect(v2.selectedJobId).toBeNull();
    });

    it("clears weak candidates", () => {
      const v2 = runJobNameMarker({
        subject: "Team follow up",
        cleanBody: "",
        jobs: [job("job-rise", "RISE UP")],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      });
      expect(v2.status).toBe("AMBIGUOUS");
      expect(v2.candidateJobIds).toEqual([]);
    });
  });

  describe("V2.1 title-gap only", () => {
    it("gap-tolerant ordered title match works", () => {
      const v21 = runJobNameMarker({
        subject: "SAT 15 exterior access stairs installation",
        cleanBody: "",
        jobs: [satStairs, cpac, bsc],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      expect(v21.status).toBe("MATCH");
      expect(v21.selectedJobId).toBe("job-sat-stairs");
      expect([
        "GAP_TOLERANT_PROJECT_MATCH",
        "UNIQUE_PROJECT_PHRASE",
      ]).toContain(v21.identityDiagnostics.reason);
    });

    it("token order / intervening budget still required (scattered generic does not MATCH)", () => {
      const v21 = runJobNameMarker({
        subject: "stairs delivery and fabrication notes",
        cleanBody: "",
        jobs: [satStairs, cpac],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      expect(v21.selectedJobId).toBeNull();
    });

    it("unique-token promotion is disabled (SAT alone does not MATCH)", () => {
      const v21 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, cpac, bsc],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      expect(v21.selectedJobId).toBeNull();
      expect(v21.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
    });

    it("disambiguates shared SAT family via gap title evidence", () => {
      const v21 = runJobNameMarker({
        subject: "2416 SAT TDP - Stair 34 Field Use Drawings",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      expect(v21.status).toBe("MATCH");
      expect(v21.selectedJobId).toBe("job-sat-stairs");
    });
  });

  describe("V2.2 unique-token only", () => {
    it("unique SAT identifies one eligible Job", () => {
      const v22 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, cpac, bsc],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
      expect(v22.identityDiagnostics.reason).toBe("UNIQUE_PROJECT_TOKEN");
    });

    it("SAT does not match Saturday", () => {
      const v22 = runJobNameMarker({
        subject: "Saturday testing",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.status).toBe("NO_MATCH");
    });

    it("shared SAT does not confidently assign", () => {
      const v22 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
    });

    it("removed Jobs do not affect uniqueness", () => {
      const v22 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        // Marker receives the eligible pool; REMOVED must not be included.
        jobs: [satStairs, cpac],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
      // If REMOVED were wrongly included, SAT would be shared with satWarehouse.
      void satWarehouse;
    });

    it("generic unique terms are not strong evidence", () => {
      const v22 = runJobNameMarker({
        subject: "Steel pricing",
        cleanBody: "",
        jobs: [steelOnly],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
    });

    it("title gap matching is disabled", () => {
      // Two SAT Jobs so unique-token cannot fire; gap evidence would resolve under V2.1.
      const v22 = runJobNameMarker({
        subject: "2416 SAT TDP - Stair 34 Field Use Drawings",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).not.toBe(
        "GAP_TOLERANT_PROJECT_MATCH"
      );
      expect(v22.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_PHRASE");
    });

    it("internal job number is not identity evidence", () => {
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
  });

  describe("cross-policy isolation", () => {
    it("gap-only email: MATCH under V2.1, not under V2.2 when SAT is shared", () => {
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
      expect(v21.selectedJobId).toBe("job-sat-stairs");
      expect(v22.selectedJobId).toBeNull();
    });

    it("unique-SAT-alone email: MATCH under V2.2, not under V2.1", () => {
      const input = {
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, cpac, bsc],
      };
      const v21 = runJobNameMarker({
        ...input,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      const v22 = runJobNameMarker({
        ...input,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
      expect(v21.selectedJobId).toBeNull();
    });
  });
});
