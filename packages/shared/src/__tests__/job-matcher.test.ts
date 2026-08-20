import { describe, expect, it } from "vitest";
import {
  JOB_MATCHER_VERSION,
  JobMatcherService,
  matchJobsDeterministic,
  type JobAliasForMatch,
  type JobMatchDataLoader,
  type JobRecordForMatch,
} from "../index.js";

const jobA: JobRecordForMatch = {
  id: "job-a",
  jobNumber: "2198",
  name: "Integer",
  normalizedName: "integer",
  customerId: "cust-1",
  externalRef: null,
};

const jobB: JobRecordForMatch = {
  id: "job-b",
  jobNumber: "3301",
  name: "Horizon Tower",
  normalizedName: "horizon tower",
  customerId: "cust-1",
  externalRef: null,
};

const jobC: JobRecordForMatch = {
  id: "job-c",
  jobNumber: "4402",
  name: "Horizon Plaza",
  normalizedName: "horizon plaza",
  customerId: "cust-2",
  externalRef: null,
};

const aliases: JobAliasForMatch[] = [
  { jobId: "job-a", alias: "INT-2198", normalizedAlias: "int 2198" },
];

describe("matchJobsDeterministic", () => {
  it("1. exact job number in subject → auto-link", () => {
    const result = matchJobsDeterministic({
      subject: "RE: Integer #2198",
      cleanBody: "Please review.",
      jobs: [jobA, jobB],
      aliases: [],
    });
    expect(result.selectedJobId).toBe("job-a");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.requiresReview).toBe(false);
    expect(result.assignmentSource).toBe("JOB_NUMBER_MATCH");
    expect(result.evidence.some((e) => e.type === "SUBJECT_JOB_NUMBER")).toBe(
      true
    );
    expect(result.matcherVersion).toBe(JOB_MATCHER_VERSION);
  });

  it("2. unique job name in subject → strong match", () => {
    const result = matchJobsDeterministic({
      subject: "Update on Integer project",
      cleanBody: "Status?",
      jobs: [jobA, jobB],
      aliases: [],
    });
    expect(result.selectedJobId).toBe("job-a");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.evidence.some((e) => e.type === "SUBJECT_JOB_NAME")).toBe(
      true
    );
  });

  it("3. alias in subject", () => {
    const result = matchJobsDeterministic({
      subject: "Re: INT-2198 drawings",
      cleanBody: "Attached.",
      jobs: [jobA, jobB],
      aliases,
    });
    expect(result.selectedJobId).toBe("job-a");
    expect(result.evidence.some((e) => e.type === "SUBJECT_JOB_ALIAS")).toBe(
      true
    );
  });

  it("4. job number only in body → content match, may suggest", () => {
    const result = matchJobsDeterministic({
      subject: "Quick question",
      cleanBody: "Can you check job #2198 status?",
      jobs: [jobA, jobB],
      aliases: [],
    });
    expect(result.evidence.some((e) => e.type === "CONTENT_JOB_NUMBER")).toBe(
      true
    );
    // Content-only score is weighted; should not silently exceed subject strength.
    if (result.selectedJobId) {
      expect(result.selectedJobId).toBe("job-a");
      expect(result.confidence).toBeLessThan(0.96);
    }
  });

  it("5. sender-only association does not overmatch", () => {
    const result = matchJobsDeterministic({
      subject: "Hello",
      cleanBody: "Just checking in.",
      senderDomain: "acme.com",
      jobs: [jobA, jobB],
      aliases: [],
      senderCustomerJobIds: new Set(["job-a"]),
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("6. sender associated with multiple jobs → no forced link", () => {
    const result = matchJobsDeterministic({
      subject: "Hello",
      cleanBody: "Checking in.",
      jobs: [jobA, jobB],
      aliases: [],
      senderCustomerJobIds: new Set(["job-a", "job-b"]),
    });
    expect(result.selectedJobId).toBeNull();
  });

  it("7. ambiguous similar jobs", () => {
    const result = matchJobsDeterministic({
      subject: "Horizon update",
      cleanBody: "Please advise.",
      jobs: [jobB, jobC],
      aliases: [],
    });
    // "horizon" may match both names → ambiguous or review
    if (result.selectedJobId) {
      expect(result.requiresReview || result.ambiguousCandidateIds.length > 0).toBe(
        true
      );
    } else {
      expect(result.confidence).toBeLessThan(0.9);
    }
  });

  it("8. no matching job", () => {
    const result = matchJobsDeterministic({
      subject: "Lunch plans",
      cleanBody: "See you at noon",
      jobs: [jobA, jobB],
      aliases: [],
    });
    expect(result.selectedJobId).toBeNull();
  });

  it("9. forwarded email with old quoted job reference prefers current content", () => {
    const result = matchJobsDeterministic({
      subject: "FW: follow up",
      cleanBody: [
        "Please see below.",
        "",
        "On Mon, Jane wrote:",
        "> Regarding job #2198 we need drawings",
      ].join("\n"),
      jobs: [jobA, jobB],
      aliases: [],
    });
    // Quoted history stripped — should not auto-link solely from quote.
    expect(result.selectedJobId).toBeNull();
  });

  it("10. subject Job A vs quoted body Job B → Job A preferred", () => {
    const result = matchJobsDeterministic({
      subject: "RE: Integer #2198",
      cleanBody: [
        "Latest update for this job.",
        "",
        "-----Original Message-----",
        "From: old",
        "Subject: Horizon #3301",
        "Please ignore old thread about #3301",
      ].join("\n"),
      jobs: [jobA, jobB],
      aliases: [],
    });
    expect(result.selectedJobId).toBe("job-a");
    expect(result.evidence.some((e) => e.type === "SUBJECT_JOB_NUMBER")).toBe(
      true
    );
  });

  it("14. archived jobs excluded by caller (not in jobs list)", () => {
    const result = matchJobsDeterministic({
      subject: "RE: Integer #2198",
      cleanBody: "",
      jobs: [], // loader already filtered archived
      aliases: [],
    });
    expect(result.selectedJobId).toBeNull();
  });

  it("16. deterministic matcher works without AI (OpenAI unavailable)", () => {
    const result = matchJobsDeterministic({
      subject: "Job #2198",
      cleanBody: "Confirm",
      jobs: [jobA],
      aliases: [],
    });
    expect(result.selectedJobId).toBe("job-a");
    expect(result.assignmentSource).toBe("JOB_NUMBER_MATCH");
  });
});

describe("JobMatcherService", () => {
  it("11/12. service uses deterministic matcher via loader (n8n + native path)", async () => {
    const loader: JobMatchDataLoader = {
      loadActiveJobs: async () => [jobA, jobB],
      loadJobAliases: async () => [],
      loadSenderCustomerJobIds: async () => new Set(),
      loadThreadJobHint: async () => null,
    };
    const service = new JobMatcherService(loader, null);
    const result = await service.match({
      workspaceId: "ws-1",
      emailMessageId: "msg-1",
      subject: "RE: Integer #2198",
      cleanBody: "Please review",
      senderEmail: "a@b.com",
      n8nSelectedJobIdHint: "job-b", // weak hint — subject wins
    });
    expect(result.selectedJobId).toBe("job-a");
  });

  it("AI resolver failure still returns deterministic result", async () => {
    const loader: JobMatchDataLoader = {
      loadActiveJobs: async () => [jobB, jobC],
      loadJobAliases: async () => [],
      loadSenderCustomerJobIds: async () => new Set(),
      loadThreadJobHint: async () => null,
    };
    const service = new JobMatcherService(loader, async () => {
      throw new Error("OpenAI unavailable");
    });
    const result = await service.match({
      workspaceId: "ws-1",
      subject: "Horizon",
      cleanBody: "update",
    });
    expect(result.matcherVersion).toBe(JOB_MATCHER_VERSION);
  });
});
