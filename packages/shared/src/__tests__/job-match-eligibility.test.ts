import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
  filterJobsEligibleForMatching,
  isJobMatcherEligibleJob,
  isJobMatcherEligibleStatus,
  isJobMatcherNeverEligibleStatus,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import {
  buildWorkspaceProjectIdentityIndex,
  projectTokenUniqueness,
} from "../jobs/job-project-identity-index.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";

function job(
  id: string,
  name: string,
  extras?: Partial<JobRecordForMatch>
): JobRecordForMatch {
  return {
    id,
    jobNumber: "1",
    name,
    normalizedName: name.toLowerCase(),
    customerId: null,
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

describe("Job Matcher candidate eligibility", () => {
  it("1 — active awarded Job is eligible", () => {
    expect(isJobMatcherEligibleStatus("ACTIVE")).toBe(true);
    expect(isJobMatcherEligibleStatus("AWARDED")).toBe(true);
    expect(isJobMatcherEligibleStatus("ON_HOLD")).toBe(true);
  });

  it("2 — removed (archivedAt) Job is excluded", () => {
    expect(
      isJobMatcherEligibleJob({
        status: "ACTIVE",
        archivedAt: new Date("2026-01-01"),
      })
    ).toBe(false);
    expect(
      isJobMatcherEligibleJob(
        { status: "ACTIVE", archivedAt: new Date("2026-01-01") },
        "evaluation"
      )
    ).toBe(false);
  });

  it("3 — active bid (BIDDING) is excluded in production and evaluation", () => {
    expect(isJobMatcherNeverEligibleStatus("BIDDING")).toBe(true);
    expect(isJobMatcherEligibleStatus("BIDDING")).toBe(false);
    expect(isJobMatcherEligibleStatus("BIDDING", "evaluation")).toBe(false);
    expect(isJobMatcherEligibleStatus("LEAD")).toBe(false);
    expect(isJobMatcherEligibleStatus("LEAD", "evaluation")).toBe(false);
  });

  it("4 — lost/canceled bid (CANCELLED) is excluded", () => {
    expect(isJobMatcherEligibleStatus("CANCELLED")).toBe(false);
    expect(isJobMatcherEligibleStatus("CANCELLED", "evaluation")).toBe(false);
  });

  it("5 — bid converted to awarded Job becomes eligible", () => {
    expect(isJobMatcherEligibleStatus("BIDDING")).toBe(false);
    expect(isJobMatcherEligibleStatus("AWARDED")).toBe(true);
    expect(isJobMatcherEligibleStatus("ACTIVE")).toBe(true);
  });

  it("6 — completed Job: production excluded; evaluation included", () => {
    expect(isJobMatcherEligibleStatus("COMPLETE")).toBe(false);
    expect(isJobMatcherEligibleStatus("COMPLETE", "evaluation")).toBe(true);
    expect(isJobMatcherEligibleStatus("COMPLETED", "evaluation")).toBe(true);
    expect(isJobMatcherEligibleStatus("ARCHIVED")).toBe(false);
    expect(isJobMatcherEligibleStatus("ARCHIVED", "evaluation")).toBe(true);
  });

  it("7 — removed Job with exact name match cannot be assigned", () => {
    const removed = job("removed", "SAT - 15 Ext Stairs", {
      status: "CANCELLED",
    });
    const softRemoved = job("soft", "Unique Soft Removed Project", {
      status: "ACTIVE",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    for (const policy of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ] as const) {
      const r1 = runJobNameMarker({
        subject: "SAT - 15 Ext Stairs",
        cleanBody: "",
        jobs: [removed],
        identityPolicy: policy,
      });
      expect(r1.selectedJobId).toBeNull();
      expect(r1.eligibleJobCount).toBe(0);

      const r2 = runJobNameMarker({
        subject: "Unique Soft Removed Project",
        cleanBody: "",
        jobs: [softRemoved],
        identityPolicy: policy,
      });
      expect(r2.selectedJobId).toBeNull();
      expect(r2.eligibleJobCount).toBe(0);
    }
  });

  it("8 — active bid with exact name match cannot be assigned", () => {
    const bid = job("bid", "SAT Structural Steel", { status: "BIDDING" });
    for (const policy of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ] as const) {
      const r = runJobNameMarker({
        subject: "SAT Structural Steel",
        cleanBody: "",
        jobs: [bid],
        identityPolicy: policy,
      });
      expect(r.selectedJobId).toBeNull();
      expect(r.eligibleJobCount).toBe(0);
    }
  });

  it("9 — ineligible Jobs do not affect V2.2 token uniqueness", () => {
    const awarded = job("sat-stairs", "SAT - 15 Ext Stairs", {
      status: "ACTIVE",
    });
    const bid = job("sat-bid", "SAT Structural", { status: "BIDDING" });
    const removed = job("sat-removed", "SAT Warehouse", {
      status: "CANCELLED",
    });
    const index = buildWorkspaceProjectIdentityIndex({
      jobs: [awarded, bid, removed],
    });
    expect(projectTokenUniqueness(index, "sat")).toBe("unique");
    expect(index.jobCount).toBe(1);

    const afterAward = buildWorkspaceProjectIdentityIndex({
      jobs: [
        awarded,
        job("sat-struct", "SAT Structural", { status: "ACTIVE" }),
        bid,
        removed,
      ],
    });
    expect(projectTokenUniqueness(afterAward, "sat")).toBe("shared");
    expect(afterAward.jobCount).toBe(2);
  });

  it("10 — tenant isolation: jobs are filtered per caller-supplied workspace set", () => {
    const wsA = job("a", "SAT Stairs", { customerId: "a" });
    const wsB = job("b", "SAT Stairs", { customerId: "b" });
    const onlyA = filterJobsEligibleForMatching([wsA]);
    expect(onlyA.map((j) => j.id)).toEqual(["a"]);
    expect(filterJobsEligibleForMatching([wsA, wsB]).map((j) => j.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("11 — V2 and V2.2 both respect eligibility for unique SAT", () => {
    const awarded = job("sat", "SAT - 15 Ext Stairs", { status: "ACTIVE" });
    const bid = job("bid", "SAT Structural", { status: "BIDDING" });
    for (const policy of [
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2,
    ] as const) {
      const r = runJobNameMarker({
        subject: "SAT testing complete",
        cleanBody: "",
        jobs: [awarded, bid],
        identityPolicy: policy,
      });
      if (policy === JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_2) {
        expect(r.status).toBe("MATCH");
        expect(r.selectedJobId).toBe("sat");
      } else {
        // V2 may abstain on weak unique acronym; must not select the bid.
        expect(r.selectedJobId).not.toBe("bid");
      }
      expect(r.eligibleJobCount).toBe(1);
    }
  });

  it("12 — filtering does not mutate the input Job array", () => {
    const jobs = [
      job("a", "A", { status: "ACTIVE" }),
      job("b", "B", { status: "BIDDING" }),
    ];
    const copy = [...jobs];
    filterJobsEligibleForMatching(jobs);
    expect(jobs).toEqual(copy);
  });
});
