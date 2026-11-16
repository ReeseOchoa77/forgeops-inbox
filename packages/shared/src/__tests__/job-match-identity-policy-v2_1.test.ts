/**
 * CONTEXT_AWARE_V2_1 = production V2 + title-gap rule ONLY.
 * Weak-candidate preserve and AUTH contact recovery are intentionally inactive.
 */
import { describe, expect, it } from "vitest";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
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
    customerId: null,
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const riseUp = job("job-rise", "RISE UP");
const bldg14 = job("job-bldg14", "BSC - BLDG 14", { customerId: "cust-bsc" });
const bsc = job("job-bsc", "Boston Scientific", { customerId: "cust-bsc" });
const satConc = job("job-sat-conc", "SAT - Concessions", { customerId: "cust-sat" });
const satStairs = job("job-sat-stairs", "SAT - 15 Ext Stairs", {
  customerId: "cust-sat",
});
const satSteel = job("job-sat-steel", "SAT - Structural Steel", {
  customerId: "cust-sat",
});
const cpac = job("job-cpac", "CPAC Stagehouse Rails");

describe("CONTEXT_AWARE_V2_1 title-gap experiment", () => {
  it("preserves V2 family / shared-name abstention", () => {
    const v2 = runJobNameMarker({
      subject: "Boston Scientific - delivery update",
      cleanBody: "",
      jobs: [bsc, bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    const v21 = runJobNameMarker({
      subject: "Boston Scientific - delivery update",
      cleanBody: "",
      jobs: [bsc, bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v2.status).toBe("AMBIGUOUS");
    expect(v21.status).toBe("AMBIGUOUS");
    expect(v21.selectedJobId).toBeNull();
  });

  it("clears weak candidates like production V2 (no legacy preserve)", () => {
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
    expect(v21.candidateJobIds).toEqual([]);
  });

  it("strong exact project identity still matches", () => {
    const v21 = runJobNameMarker({
      subject: "SAT - Concessions shop drawings",
      cleanBody: "",
      jobs: [satConc, satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-conc");
  });

  it("gap-tolerant title match recovers ordered project words", () => {
    const v21 = runJobNameMarker({
      subject: "SAT 15 exterior access stairs installation",
      cleanBody: "",
      jobs: [satStairs, cpac],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-stairs");
    expect([
      "GAP_TOLERANT_PROJECT_MATCH",
      "UNIQUE_PROJECT_PHRASE",
    ]).toContain(v21.identityDiagnostics.reason);
  });

  it("does not apply unique-token promotion", () => {
    const v21 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs, cpac],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v21.selectedJobId).toBeNull();
    expect(v21.identityDiagnostics.reason).not.toBe("UNIQUE_PROJECT_TOKEN");
  });

  it("AUTH-only contact does not recover (same as V2)", () => {
    const contactHits = [
      {
        jobId: "job-sat-stairs",
        source: "AUTHORITATIVE_EMAIL" as const,
        supportingEmailIds: ["auth-1"],
      },
    ];
    const v2 = runJobMatchPipeline({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      contactHits,
    });
    const v21 = runJobMatchPipeline({
      subject: "Team follow up",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      contactHits,
    });
    expect(v2.decision).not.toBe("MATCH");
    expect(v21.decision).not.toBe("MATCH");
  });

  it("V2.2 unique-token path is not inherited", () => {
    const v21 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    const v22 = runJobNameMarker({
      subject: "SAT testing complete",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    });
    expect(v22.status).toBe("MATCH");
    expect(v21.selectedJobId).toBeNull();
  });

  it("shared-family gap title can still resolve under V2.1", () => {
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
