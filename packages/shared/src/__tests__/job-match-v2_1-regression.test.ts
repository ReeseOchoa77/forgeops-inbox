/**
 * V2 → V2.1 deltas for the title-gap experiment.
 * Legacy weak-preserve / THREAD-CONFLICT regressions are inactive.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
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

const satStairs = job("job-sat-stairs", "SAT - 15 Ext Stairs", {
  customerId: "cust-sat",
});
const cpac = job("job-cpac", "CPAC Stagehouse Rails");

describe("V2.1 title-gap regression / transitions", () => {
  it("V2 abstains on gap title; V2.1 can MATCH", () => {
    const subject = "SAT 15 exterior access stairs installation";
    const v2 = runJobNameMarker({
      subject,
      cleanBody: "",
      jobs: [satStairs, cpac],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
    });
    const v21 = runJobNameMarker({
      subject,
      cleanBody: "",
      jobs: [satStairs, cpac],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
    });
    expect(v2.selectedJobId).toBeNull();
    expect(v2.identityDiagnostics.reason).toBe("NON_CONTIGUOUS_TOKEN_OVERLAP");
    expect(v21.status).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-sat-stairs");
  });
});
