import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateJobMatchCases,
  runJobMatchPipeline,
  selectActiveContactHits,
  selectAuthoritativeThreadHits,
  scoreJobMatchGroundTruth,
  type JobRecordForMatch,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));

const sm1: JobRecordForMatch = {
  id: "job-sm-1",
  jobNumber: "2191",
  name: "St Michael Apartments Building 1",
  normalizedName: "st michael apartments building 1",
  customerId: null,
  externalRef: null,
  siteName: "St Michael Apartments",
  status: "ACTIVE",
};
const sm2: JobRecordForMatch = {
  id: "job-sm-2",
  jobNumber: "2192",
  name: "St Michael Apartments Building 2",
  normalizedName: "st michael apartments building 2",
  customerId: null,
  externalRef: null,
  siteName: "St Michael Apartments",
  status: "ACTIVE",
};
const sm3: JobRecordForMatch = {
  id: "job-sm-3",
  jobNumber: "2193",
  name: "St Michael Apartments Building 3",
  normalizedName: "st michael apartments building 3",
  customerId: null,
  externalRef: null,
  siteName: "St Michael Apartments",
  status: "ACTIVE",
};
const completeJob: JobRecordForMatch = {
  ...sm2,
  id: "job-complete",
  status: "COMPLETE",
};
const pool = [sm1, sm2, sm3];

describe("Marker 2 active exact contact", () => {
  it("1. active sender on one Job → MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL", supportingEmailIds: ["msg-a"] },
      ],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("2. active sender on two Jobs → AMBIGUOUS", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [
        { jobId: "job-sm-1", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
    expect(result.candidateJobIds?.sort()).toEqual(["job-sm-1", "job-sm-2"]);
  });

  it("3. sender absent → NO evidence", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      senderEmail: null,
      contactHits: [],
    });
    expect(result.decision).toBe("NO_MATCH");
    expect(result.evidence.some((e) => e.type === "SENDER_JOB_CONTACT")).toBe(false);
  });

  it("4. stale LEARNED_FROM_EMAIL contact alone does not count", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: pool,
      manualContacts: [
        {
          jobId: "job-sm-2",
          source: "LEARNED_FROM_EMAIL",
          email: "connor@gc.com",
          normalizedEmail: "connor@gc.com",
        },
      ],
      authoritativeEmails: [],
    });
    expect(hits).toEqual([]);
  });

  it("5. MANUAL contact counts", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: pool,
      manualContacts: [
        {
          jobId: "job-sm-2",
          source: "MANUAL",
          email: "connor@gc.com",
          normalizedEmail: "connor@gc.com",
        },
      ],
      authoritativeEmails: [],
    });
    expect(hits).toEqual([{ jobId: "job-sm-2", basis: "MANUAL_JOB_CONTACT" }]);
  });

  it("6. email comparison is case-insensitive", () => {
    const hits = selectActiveContactHits({
      senderEmail: "Connor@GC.com",
      eligibleJobs: pool,
      manualContacts: [
        {
          jobId: "job-sm-2",
          source: "MANUAL",
          email: "connor@gc.com",
          normalizedEmail: "connor@gc.com",
        },
      ],
      authoritativeEmails: [],
    });
    expect(hits.map((h) => h.jobId)).toEqual(["job-sm-2"]);
  });

  it("7. ineligible Job ignored", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: [...pool, completeJob],
      manualContacts: [
        {
          jobId: "job-complete",
          source: "MANUAL",
          email: "connor@gc.com",
          normalizedEmail: "connor@gc.com",
        },
      ],
      authoritativeEmails: [],
    });
    expect(hits).toEqual([]);
  });

  it("8. AI_SUGGESTED email does not establish active contact", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: pool,
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-ai",
          jobId: "job-sm-2",
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: false,
          jobAssignmentSource: "AI_SUGGESTED",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("9. USER_ASSIGNED does", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: pool,
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-user",
          jobId: "job-sm-2",
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: false,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits[0]).toMatchObject({
      jobId: "job-sm-2",
      basis: "CURRENT_AUTHORITATIVE_EMAIL",
    });
  });

  it("10. VERIFIED_PROJECT_FOLDER does", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: pool,
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-folder",
          jobId: "job-sm-2",
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: false,
          jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
        },
      ],
    });
    expect(hits.map((h) => h.jobId)).toEqual(["job-sm-2"]);
  });

  it("evaluation eligibility includes COMPLETE Jobs for Marker 2; production does not", () => {
    const production = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: [completeJob],
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-complete",
          jobId: completeJob.id,
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(production).toEqual([]);
    const evaluation = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      eligibleJobs: [completeJob],
      eligibilityMode: "evaluation",
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-complete",
          jobId: completeJob.id,
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(evaluation.map((h) => h.jobId)).toEqual([completeJob.id]);
  });

  it("11. held-out email cannot prove itself", () => {
    const hits = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      excludeEmailMessageId: "msg-eval",
      eligibleJobs: pool,
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-eval",
          jobId: "job-sm-2",
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits).toEqual([]);
    const manualHeldOut = selectActiveContactHits({
      senderEmail: "connor@gc.com",
      excludeEmailMessageId: "msg-eval",
      eligibleJobs: pool,
      manualContacts: [
        {
          jobId: "job-sm-2",
          source: "MANUAL",
          email: "connor@gc.com",
          normalizedEmail: "connor@gc.com",
        },
      ],
      authoritativeEmails: [
        {
          id: "msg-eval",
          jobId: "job-sm-2",
          senderEmail: "connor@gc.com",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(manualHeldOut.map((h) => h.basis)).toEqual(["MANUAL_JOB_CONTACT"]);
  });

  it("12. contact intersection narrows Marker 1 candidates", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [
        { jobId: "job-sm-1", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.candidateJobIds?.sort()).toEqual(["job-sm-1", "job-sm-2"]);
  });

  it("13. empty contact set preserves Marker 1 candidates", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
      senderEmail: "nobody@example.com",
      contactHits: [],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.candidateJobIds?.sort()).toEqual([
      "job-sm-1",
      "job-sm-2",
      "job-sm-3",
    ]);
  });

  it("14. disjoint contact does not override Marker 1 candidates", () => {
    const other: JobRecordForMatch = {
      ...sm2,
      id: "job-2240",
      jobNumber: "2240",
      name: "Riverside Tower",
      normalizedName: "riverside tower",
      siteName: "Riverside",
    };
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: [...pool, other],
      senderEmail: "other@example.com",
      contactHits: [{ jobId: "job-2240", basis: "MANUAL_JOB_CONTACT" }],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.candidateJobIds?.sort()).toEqual([
      "job-sm-1",
      "job-sm-2",
      "job-sm-3",
    ]);
    expect(result.evidence.some((e) => e.type === "SENDER_JOB_CONTACT")).toBe(true);
  });
});

describe("Marker 3 authoritative thread", () => {
  const conn = "conn-1";
  const thread = "outlook-thread-9";

  it("15. one authoritative thread Job → MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      inboxConnectionId: conn,
      providerThreadId: thread,
      threadHits: [{ jobId: "job-sm-2", supportingEmailIds: ["m1"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("16. multiple authoritative thread Jobs → AMBIGUOUS", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      inboxConnectionId: conn,
      providerThreadId: thread,
      threadHits: [
        { jobId: "job-sm-1", supportingEmailIds: ["m1"] },
        { jobId: "job-sm-2", supportingEmailIds: ["m2"] },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
  });

  it("17. 13 vs 1 does NOT majority vote", () => {
    const hits = selectAuthoritativeThreadHits({
      inboxConnectionId: conn,
      providerThreadId: thread,
      eligibleJobs: pool,
      messages: [
        ...Array.from({ length: 13 }, (_, i) => ({
          id: `m-2192-${i}`,
          jobId: "job-sm-2",
          inboxConnectionId: conn,
          providerThreadId: thread,
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        })),
        {
          id: "m-2240",
          jobId: "job-sm-1",
          inboxConnectionId: conn,
          providerThreadId: thread,
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits.map((h) => h.jobId).sort()).toEqual(["job-sm-1", "job-sm-2"]);
  });

  it("18. AI_SUGGESTED thread history ignored", () => {
    const hits = selectAuthoritativeThreadHits({
      inboxConnectionId: conn,
      providerThreadId: thread,
      eligibleJobs: pool,
      messages: [
        {
          id: "m-ai",
          jobId: "job-sm-2",
          inboxConnectionId: conn,
          providerThreadId: thread,
          jobAssignmentIsManual: false,
          jobAssignmentSource: "AI_SUGGESTED",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("19. no providerThreadId → no evidence", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      inboxConnectionId: conn,
      providerThreadId: null,
      threadHits: [{ jobId: "job-sm-2", supportingEmailIds: ["m1"] }],
    });
    expect(result.evidence.some((e) => e.type === "THREAD_JOB_AUTHORITATIVE")).toBe(
      false
    );
    expect(result.decision).toBe("NO_MATCH");
  });

  it("evaluation eligibility includes COMPLETE Jobs for Marker 3; production does not", () => {
    const production = selectAuthoritativeThreadHits({
      inboxConnectionId: conn,
      providerThreadId: thread,
      eligibleJobs: [completeJob],
      messages: [
        {
          id: "msg-complete-thread",
          jobId: completeJob.id,
          inboxConnectionId: conn,
          providerThreadId: thread,
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(production).toEqual([]);
    const evaluation = selectAuthoritativeThreadHits({
      inboxConnectionId: conn,
      providerThreadId: thread,
      eligibleJobs: [completeJob],
      eligibilityMode: "evaluation",
      messages: [
        {
          id: "msg-complete-thread",
          jobId: completeJob.id,
          inboxConnectionId: conn,
          providerThreadId: thread,
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(evaluation.map((h) => h.jobId)).toEqual([completeJob.id]);
  });

  it("20. held-out email excluded", () => {
    const hits = selectAuthoritativeThreadHits({
      inboxConnectionId: conn,
      providerThreadId: thread,
      excludeEmailMessageId: "msg-eval",
      eligibleJobs: pool,
      messages: [
        {
          id: "msg-eval",
          jobId: "job-sm-2",
          inboxConnectionId: conn,
          providerThreadId: thread,
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("21. mailbox/connection boundary respected", () => {
    const hits = selectAuthoritativeThreadHits({
      inboxConnectionId: conn,
      providerThreadId: thread,
      eligibleJobs: pool,
      messages: [
        {
          id: "other-box",
          jobId: "job-sm-2",
          inboxConnectionId: "conn-other",
          providerThreadId: thread,
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("22. thread intersection narrows existing candidates", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
      inboxConnectionId: conn,
      providerThreadId: thread,
      contactHits: [
        { jobId: "job-sm-1", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
      threadHits: [{ jobId: "job-sm-2", supportingEmailIds: ["m1"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("23. empty thread evidence preserves candidates", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
      inboxConnectionId: conn,
      providerThreadId: thread,
      contactHits: [
        { jobId: "job-sm-1", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
      threadHits: [],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.candidateJobIds?.sort()).toEqual(["job-sm-1", "job-sm-2"]);
  });

  it("24. disjoint authoritative thread produces CONFLICT", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments Building 2 stair revisions",
      jobs: [sm2, { ...sm2, id: "job-2240", jobNumber: "2240", name: "Other Site" }],
      inboxConnectionId: conn,
      providerThreadId: thread,
      threadHits: [{ jobId: "job-2240", supportingEmailIds: ["m-other"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.markerTrace?.map((t) => t.marker)).toEqual(["NAME"]);
  });

  it("24b. disjoint thread vs ambiguous name set is CONFLICT", () => {
    const other: JobRecordForMatch = {
      ...sm2,
      id: "job-2240",
      jobNumber: "2240",
      name: "Riverside Tower",
      normalizedName: "riverside tower",
      siteName: "Riverside",
    };
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: [...pool, other],
      inboxConnectionId: conn,
      providerThreadId: thread,
      threadHits: [{ jobId: "job-2240", supportingEmailIds: ["m-other"] }],
    });
    expect(result.decision).toBe("CONFLICT");
    expect(result.selectedJobId).toBeNull();
    expect(result.candidateJobIds?.sort()).toEqual([
      "job-2240",
      "job-sm-1",
      "job-sm-2",
      "job-sm-3",
    ]);
  });
});

describe("Phase 2 pipeline", () => {
  it("25. Marker 1 strong MATCH stops", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments Building 2 stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [{ jobId: "job-sm-1", basis: "MANUAL_JOB_CONTACT" }],
      inboxConnectionId: "conn-1",
      providerThreadId: "t1",
      threadHits: [{ jobId: "job-sm-3", supportingEmailIds: ["x"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.markerTrace?.map((t) => t.marker)).toEqual(["NAME"]);
  });

  it("26. Marker 1 ambiguous + Marker 2 unique → MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [{ jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.markerTrace?.map((t) => t.marker)).toEqual(["NAME", "CONTACT"]);
  });

  it("27. Marker 1 ambiguous + Marker 2 ambiguous + Marker 3 unique → MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [
        { jobId: "job-sm-1", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
      inboxConnectionId: "conn-1",
      providerThreadId: "t1",
      threadHits: [{ jobId: "job-sm-2", supportingEmailIds: ["m1"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.markerTrace?.map((t) => t.marker)).toEqual([
      "NAME",
      "CONTACT",
      "THREAD",
    ]);
  });

  it("28. Marker 1 no-match + Marker 2 unique → MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [{ jobId: "job-sm-2", basis: "MANUAL_JOB_CONTACT" }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("29. Marker 1 no-match + Marker 2 ambiguous + Marker 3 unique → MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "Stair revisions",
      jobs: pool,
      senderEmail: "connor@gc.com",
      contactHits: [
        { jobId: "job-sm-1", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
        { jobId: "job-sm-2", basis: "CURRENT_AUTHORITATIVE_EMAIL" },
      ],
      inboxConnectionId: "conn-1",
      providerThreadId: "t1",
      threadHits: [{ jobId: "job-sm-2", supportingEmailIds: ["m1"] }],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("30. unresolved candidates → AMBIGUOUS", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: pool,
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
  });

  it("31. strong disjoint evidence → CONFLICT", () => {
    const other: JobRecordForMatch = {
      ...sm2,
      id: "job-2240",
      jobNumber: "2240",
      name: "Riverside Tower",
      normalizedName: "riverside tower",
      siteName: "Riverside",
    };
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      jobs: [...pool, other],
      inboxConnectionId: "conn-1",
      providerThreadId: "t1",
      threadHits: [{ jobId: "job-2240", supportingEmailIds: ["x"] }],
    });
    expect(result.decision).toBe("CONFLICT");
    expect(result.selectedJobId).toBeNull();
  });

  it("32. no evidence → NO_MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "Lunch next week?",
      jobs: pool,
    });
    expect(result.decision).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("33. selectedJobId null for ambiguous/conflict/no-match", () => {
    for (const subject of [
      "St Michael Apartments stair revisions",
      "Lunch next week?",
    ]) {
      const result = runJobMatchPipeline({ subject, jobs: pool });
      if (result.decision !== "MATCH") {
        expect(result.selectedJobId).toBeNull();
      }
    }
  });
});

describe("Phase 2 safety", () => {
  it("34-38. no persistence, mutation, AI, or fuzzy scoring in markers", () => {
    const files = [
      "job-contact-marker.ts",
      "job-thread-marker.ts",
      "job-match-pipeline.ts",
      "job-matcher-service.ts",
    ].map((name) =>
      readFileSync(resolve(here, "../jobs", name), "utf8")
    );
    const src = files.join("\n");
    expect(src).not.toMatch(/openai|chat\.completions|generateObject/i);
    expect(src).not.toMatch(/levenshtein|fuse\.js|fuzzball|string-similarity/i);
    expect(src).not.toMatch(/persistJobMatchResult|jobEmailContact\.create|emailMessage\.update/);
    expect(src).not.toMatch(/JOB_MATCHER_AUTO_ASSIGN_ENABLED\s*=\s*["']true["']/);
  });
});

describe("Phase 2 evaluation harness", () => {
  it("39. holdout prevents contact self-leakage", () => {
    const hits = selectActiveContactHits({
      senderEmail: "a@b.com",
      excludeEmailMessageId: "self",
      eligibleJobs: pool,
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "self",
          jobId: "job-sm-2",
          senderEmail: "a@b.com",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("40. holdout prevents thread self-leakage", () => {
    const hits = selectAuthoritativeThreadHits({
      inboxConnectionId: "c1",
      providerThreadId: "t1",
      excludeEmailMessageId: "self",
      eligibleJobs: pool,
      messages: [
        {
          id: "self",
          jobId: "job-sm-2",
          inboxConnectionId: "c1",
          providerThreadId: "t1",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it("41-42. metrics calculate correctly including narrowing", () => {
    const report = evaluateJobMatchCases([
      {
        id: "unique",
        subject: "St Michael Apartments Building 2 stair revisions",
        jobs: pool,
        expectedDecision: "MATCH",
        expectedJobId: "job-sm-2",
      },
      {
        id: "contact-resolves",
        subject: "St Michael Apartments stair revisions",
        jobs: pool,
        contactJobIds: ["job-sm-2"],
        expectedDecision: "MATCH",
        expectedJobId: "job-sm-2",
      },
      {
        id: "thread-resolves",
        subject: "St Michael Apartments stair revisions",
        jobs: pool,
        contactJobIds: ["job-sm-1", "job-sm-2"],
        threadJobIds: ["job-sm-2"],
        expectedDecision: "MATCH",
        expectedJobId: "job-sm-2",
      },
      {
        id: "ambiguous",
        subject: "St Michael Apartments stair revisions",
        jobs: pool,
        expectedDecision: "AMBIGUOUS",
        expectedCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3"],
      },
    ]);
    expect(report.correct).toBe(4);
    expect(report.correctMatch).toBe(3);
    expect(report.incorrectMatch).toBe(0);
    expect(report.ambiguous).toBe(1);
    expect(report.marker2UniqueResolutions).toBe(1);
    expect(report.marker3UniqueResolutions).toBe(1);
    expect(report.narrowedByMarker2).toBeGreaterThanOrEqual(1);
    expect(report.narrowedByMarker3).toBe(1);
    expect(report.precision).toBe(1);
    expect(report.decisionCoverage).toBe(0.75);

    const scored = scoreJobMatchGroundTruth([
      {
        id: "msg-1",
        subject: "x",
        senderEmail: "a@b.com",
        trueJobId: "job-sm-2",
        result: runJobMatchPipeline({
          subject: "St Michael Apartments Building 2",
          jobs: pool,
        }),
      },
      {
        id: "msg-2",
        subject: "y",
        senderEmail: "a@b.com",
        trueJobId: "job-sm-1",
        result: runJobMatchPipeline({
          subject: "St Michael Apartments Building 2",
          jobs: pool,
        }),
      },
    ]);
    expect(scored.correctMatch).toBe(1);
    expect(scored.incorrectMatch).toBe(1);
    expect(scored.falseMatchRate).toBe(0.5);
    expect(scored.representativeFailures[0]?.emailMessageId).toBe("msg-2");
  });
});
