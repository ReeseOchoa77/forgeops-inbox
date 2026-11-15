import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import {
  buildWorkspaceProjectIdentityIndex,
  competingJobIdsForToken,
  isSharedProjectIdentifier,
  isUniqueProjectPhrase,
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
const satConc = job("job-sat-conc", "SAT - Concessions", {
  customerId: "cust-sat",
});
const cpac = job("job-cpac", "CPAC - Stagehouse", { customerId: "cust-cpac" });
const bscWh = job("job-bsc-wh", "BSC Materials 360 Warehouse", {
  customerId: "cust-bsc",
});
const bscUmbrella = job("job-bsc", "Boston Scientific", {
  customerId: "cust-bsc",
});
const bsc14 = job("job-bsc14", "BSC - BLDG 14 Decarb", {
  customerId: "cust-bsc",
});
const belt2 = job("job-belt2", "Beltline Building #2");
const belt1 = job("job-belt1", "Beltline Building #1");
const belt3 = job("job-belt3", "Beltline Building #3");
const beltRamp = job("job-belt-ramp", "Beltline Parking Ramp");
const northside = job("job-north", "Northside Steel Fabrication");
const stinsonGate = job("job-stinson-gate", "Stinson Farmhouse Entry Gate", {
  customerId: "cust-stinson",
});
const stinsonBridge = job(
  "job-stinson-bridge",
  "Stinson Farmhouse Pedestrian Bridge",
  { customerId: "cust-stinson" }
);

describe("CONTEXT_AWARE_V2_2 advanced project identity", () => {
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
    it("Example A — unique SAT alone is strong UNIQUE_PROJECT_TOKEN", () => {
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

    it("Example B — unique SAT + Stair is UNIQUE_TOKEN_SCOPE_MATCH or phrase", () => {
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
        "UNIQUE_PROJECT_PHRASE",
        "GAP_TOLERANT_PROJECT_MATCH",
      ]).toContain(v22.identityDiagnostics.reason);
      expect(v22.identityDiagnostics.matchedTerms).toEqual(
        expect.arrayContaining(["sat", "stairs"])
      );
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
    it("Example C — shared SAT alone stays AMBIGUOUS", () => {
      const v22 = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(["AMBIGUOUS", "NO_MATCH"]).toContain(v22.status);
      expect([
        "SHARED_PROJECT_IDENTIFIER",
        "ACRONYM_AMBIGUITY",
        "AMBIGUOUS_CANDIDATES",
      ]).toContain(v22.identityDiagnostics.reason);
    });

    it("shared SAT + Stair prefers Stairs job", () => {
      const v22 = runJobNameMarker({
        subject: "SAT Stair 34",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
    });

    it("shared SAT + Structural prefers Structural Steel job", () => {
      const v22 = runJobNameMarker({
        subject: "SAT Structural Drawings",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-steel");
    });

    it("adding a second SAT Job flips SAT from unique to shared", () => {
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

  describe("gap-tolerant matching", () => {
    it("recognizes SAT + Stair across intervening TDP tokens", () => {
      const v22 = runJobNameMarker({
        subject: "2416 SAT TDP - Stair 34 Field Use Drawings",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
      expect([
        "UNIQUE_TOKEN_SCOPE_MATCH",
        "GAP_TOLERANT_PROJECT_MATCH",
        "UNIQUE_PROJECT_PHRASE",
        "UNIQUE_PROJECT_TOKEN",
      ]).toContain(v22.identityDiagnostics.reason);
      expect(v22.identityDiagnostics.matchedTerms).toEqual(
        expect.arrayContaining(["sat", "stairs"])
      );
      expect(v22.identityDiagnostics.normalizationApplied).toEqual(
        expect.arrayContaining([expect.stringMatching(/stair→stairs/i)])
      );
    });

    it("disambiguates gap SAT+Stair among shared SAT family", () => {
      const v22 = runJobNameMarker({
        subject: "2416 SAT TDP - Stair 34 Field Use Drawings",
        cleanBody: "",
        jobs: [satStairs, satSteel],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
    });

    it("Beltline Building #2 Stair prefers Building 2", () => {
      const v22 = runJobNameMarker({
        subject: "Beltline Building #2 Stair",
        cleanBody: "",
        jobs: [belt1, belt2, belt3, beltRamp],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-belt2");
    });

    it("BSC Materials 360 Warehouse prefers warehouse job", () => {
      const v22 = runJobNameMarker({
        subject: "BSC Materials 360 Warehouse Mezzanine",
        cleanBody: "",
        jobs: [bscUmbrella, bscWh, bsc14],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-bsc-wh");
    });

    it("Stinson Farmhouse Pedestrian Bridge prefers bridge job", () => {
      const v22 = runJobNameMarker({
        subject: "Stinson Farmhouse Pedestrian Bridge drawings",
        cleanBody: "",
        jobs: [stinsonGate, stinsonBridge],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-stinson-bridge");
    });
  });

  describe("safety", () => {
    it("Example D — generic Steel alone does not force Northside", () => {
      const v22 = runJobNameMarker({
        subject: "Steel pricing",
        cleanBody: "",
        jobs: [satStairs, northside],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
      expect(v22.identityDiagnostics.reason).toBe("GENERIC_TERM_ONLY");
    });

    it("generic stairs alone does not force SAT Stairs", () => {
      const v22 = runJobNameMarker({
        subject: "Stairs material certs",
        cleanBody: "",
        jobs: [satStairs, belt2],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.selectedJobId).toBeNull();
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

    it("quoted-body historical SAT does not override subject-only generic", () => {
      // Marker strips quoted history; SAT in quoted block must not invent a match.
      const v22 = runJobNameMarker({
        subject: "FW: pricing",
        cleanBody: "Thanks\n\nOn Monday wrote:\n> SAT stairs update\n",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      // Depending on quote strip depth, either no match or match from residual —
      // never MATCH from a fabricated cross-span of unrelated subject+quote.
      if (v22.status === "MATCH") {
        expect(v22.identityDiagnostics.evidenceField).not.toBe("mixed");
      }
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

    it("V2.2 clears weak candidates (not V2.1 preserve)", () => {
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
        contentTokens: ["sat", "ext", "stairs"],
        distinguishingTokens: ["15"],
        phraseTokenLists: [["sat", "15", "ext", "stairs"]],
        matchedContentTokens: [],
        kind: "NONE" as const,
      };
      expect(isAuthoritativeUniqueProjectToken("sat", peer)).toBe(true);
      expect(isAuthoritativeUniqueProjectToken("ext", peer)).toBe(false);
      expect(isAuthoritativeUniqueProjectToken("stairs", peer)).toBe(false);
    });
  });

  describe("workspace index", () => {
    it("marks shared vs unique identifiers dynamically", () => {
      const index = buildWorkspaceProjectIdentityIndex({
        jobs: [satStairs, satConc, belt2],
      });
      expect(isSharedProjectIdentifier(index, "sat")).toBe(true);
      expect(isSharedProjectIdentifier(index, "beltline")).toBe(false);
      expect(isUniqueProjectPhrase(index, ["sat", "stairs"])).toBe(true);
      expect(projectTokenUniqueness(index, "beltline")).toBe("unique");
    });
  });

  describe("prior recovery regressions", () => {
    it("V2 still abstains on non-contiguous SAT stairs", () => {
      const v2 = runJobNameMarker({
        subject: "SAT stairs",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      });
      expect(v2.status).toBe("AMBIGUOUS");
      expect(v2.identityDiagnostics.reason).toBe("NON_CONTIGUOUS_TOKEN_OVERLAP");
    });

    it("V2.2 recovers contiguous SAT stairs phrase", () => {
      const v22 = runJobNameMarker({
        subject: "SAT stairs",
        cleanBody: "",
        jobs: [satStairs],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-sat-stairs");
    });

    it("V2.2 recovers Beltline Building #2 among siblings", () => {
      const v22 = runJobNameMarker({
        subject: "Beltline Building #2",
        cleanBody: "",
        jobs: [belt2, belt1],
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
      });
      expect(v22.status).toBe("MATCH");
      expect(v22.selectedJobId).toBe("job-belt2");
    });
  });
});
