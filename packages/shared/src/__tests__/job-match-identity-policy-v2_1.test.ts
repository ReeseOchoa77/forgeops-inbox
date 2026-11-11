import { describe, expect, it } from "vitest";
import { runJobMatchPipeline } from "../jobs/job-match-pipeline.js";
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

const riseUp = job("job-rise", "RISE UP");
const bldg14 = job("job-bldg14", "BSC - BLDG 14", { customerId: "cust-bsc" });
const bsc = job("job-bsc", "Boston Scientific", { customerId: "cust-bsc" });
const satConc = job("job-sat-conc", "SAT - Concessions", { customerId: "cust-sat" });
const satStairs = job("job-sat-stairs", "SAT - 15 Ext Stairs", {
  customerId: "cust-sat",
});

describe("CONTEXT_AWARE_V2_1 policy", () => {
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

  it("preserves weak candidates (V2 clears them)", () => {
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
    expect(v21.candidateJobIds).toEqual(["job-rise"]);
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

  it("multi-job contact still cannot unique-resolve", () => {
    const result = runJobMatchPipeline({
      subject: "Status update",
      cleanBody: "",
      jobs: [bsc, bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      senderEmail: "vendor@example.com",
      contactHits: [
        { jobId: "job-bsc", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-bldg14", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
  });

  it("verified single-Job AUTH contact can resolve when independent of thread", () => {
    const v2 = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: [bldg14, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      senderEmail: "pm@example.com",
      contactHits: [
        {
          jobId: "job-bldg14",
          basis: "CURRENT_AUTHORITATIVE_EMAIL",
          supportingEmailIds: ["auth-email-1"],
        },
      ],
    });
    const v21 = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: [bldg14, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      senderEmail: "pm@example.com",
      contactHits: [
        {
          jobId: "job-bldg14",
          basis: "CURRENT_AUTHORITATIVE_EMAIL",
          supportingEmailIds: ["auth-email-1"],
        },
      ],
    });
    expect(v2.decision).toBe("AMBIGUOUS");
    expect(v21.decision).toBe("MATCH");
    expect(v21.selectedJobId).toBe("job-bldg14");
    expect(v21.contactDiagnostics?.reason).toBe(
      "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT"
    );
  });

  it("does not authorize AUTH contact when evidence shares thread origin", () => {
    const result = runJobMatchPipeline({
      subject: "Hello",
      cleanBody: "",
      jobs: [bldg14],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
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
    // Shared origin → evidenceIndependentFromThread false → AUTH recovery blocked.
    // Thread may still resolve independently.
    expect(result.contactDiagnostics?.evidenceIndependentFromThread).toBe(false);
    if (result.contactDiagnostics?.reason === "VERIFIED_AUTHORITATIVE_SINGLE_JOB_CONTACT") {
      throw new Error("AUTH recovery must not fire on shared-origin contact");
    }
  });

  it("authoritative thread still resolves with weak name under V2.1", () => {
    const result = runJobMatchPipeline({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs, riseUp],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits: [
        { jobId: "job-sat-stairs", supportingEmailIds: ["other-email"] },
      ],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sat-stairs");
  });

  it("holdout isolation: empty threadHits means no self-evidence", () => {
    const result = runJobMatchPipeline({
      subject: "Stairs need revisions",
      cleanBody: "",
      jobs: [satStairs],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      threadHits: [],
    });
    expect(result.selectedJobId).toBeNull();
  });

  it("conflicting strong identity does not silently take thread Job", () => {
    const result = runJobMatchPipeline({
      subject: "SAT - Concessions shop drawings",
      cleanBody: "",
      jobs: [satConc, satStairs, bsc],
      identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      threadHits: [{ jobId: "job-bsc", supportingEmailIds: ["e2"] }],
    });
    expect(result.selectedJobId).not.toBe("job-bsc");
  });
});
