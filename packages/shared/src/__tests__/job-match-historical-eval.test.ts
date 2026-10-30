import { describe, expect, it } from "vitest";
import { JobMatcherService } from "../jobs/job-matcher-service.js";
import { createJobMatchEvalLoaderFromSnapshot } from "../jobs/job-match-eval-snapshot-loader.js";
import {
  aggregateHistoricalEvalResults,
  assertReadOnlyPrismaOperation,
  buildWrongMatchDetails,
  classifyHistoricalEvalOutcome,
  formatHistoricalEvalReport,
  isHistoricalEvalGroundTruth,
  matcherUsedInternalJobNumber,
  parseHistoricalEvalCliArgs,
  shadowReadinessRecommendation,
  type HistoricalEvalEmail,
} from "../jobs/job-match-historical-eval.js";
import type { JobMatchResult, JobRecordForMatch } from "../jobs/job-matcher.js";
import { isJobMatcherEligibleStatus } from "../jobs/job-name-marker.js";

const jobActive: JobRecordForMatch = {
  id: "job-active",
  jobNumber: "1001",
  name: "Alleghany Apartments",
  normalizedName: "alleghany apartments",
  customerId: "cust-1",
  externalRef: null,
  status: "ACTIVE",
};
const jobComplete: JobRecordForMatch = {
  id: "job-complete",
  jobNumber: "1002",
  name: "Beltline Tower",
  normalizedName: "beltline tower",
  customerId: "cust-1",
  externalRef: null,
  status: "COMPLETE",
};
const jobOther: JobRecordForMatch = {
  id: "job-other",
  jobNumber: "1003",
  name: "Horizon School",
  normalizedName: "horizon school",
  customerId: "cust-2",
  externalRef: null,
  status: "ACTIVE",
};

function matchResult(partial: Partial<JobMatchResult>): JobMatchResult {
  return {
    selectedJobId: null,
    confidence: 0,
    evidence: [],
    ambiguousCandidateIds: [],
    candidateJobIds: [],
    decision: "NO_MATCH",
    markerTrace: [],
    requiresReview: true,
    assignmentSource: null,
    candidateCount: 0,
    matcherVersion: "job-match-pipeline-v3",
    ...partial,
  };
}

function evalEmail(
  partial: Partial<HistoricalEvalEmail> & Pick<HistoricalEvalEmail, "id" | "trueJobId" | "result">
): HistoricalEvalEmail {
  return {
    subject: "RFI",
    direction: "RECEIVED",
    ...partial,
  };
}

describe("historical eval CLI args", () => {
  it("requires --workspace", () => {
    expect(() => parseHistoricalEvalCliArgs([])).toThrow(/--workspace/);
  });

  it("parses workspace, limit, job, and diagnostic cap", () => {
    const args = parseHistoricalEvalCliArgs([
      "--workspace",
      "ws-1",
      "--limit",
      "25",
      "--job",
      "job-1",
      "--max-wrong-details",
      "3",
      "--concurrency",
      "2",
    ]);
    expect(args).toEqual({
      workspace: "ws-1",
      limit: 25,
      jobId: "job-1",
      maxWrongDetails: 3,
      concurrency: 2,
    });
  });
});

describe("ground truth filtering", () => {
  it("includes USER_ASSIGNED, manual, and VERIFIED_PROJECT_FOLDER", () => {
    expect(
      isHistoricalEvalGroundTruth({
        jobId: "job-1",
        jobAssignmentSource: "USER_ASSIGNED",
      })
    ).toBe(true);
    expect(
      isHistoricalEvalGroundTruth({
        jobId: "job-1",
        jobAssignmentIsManual: true,
        jobAssignmentSource: "AI_AUTO_ASSIGNED",
      })
    ).toBe(true);
    expect(
      isHistoricalEvalGroundTruth({
        jobId: "job-1",
        jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
      })
    ).toBe(true);
  });

  it("excludes jobId-only, AI sources, and JOB_NUMBER_MATCH", () => {
    expect(isHistoricalEvalGroundTruth({ jobId: "job-1" })).toBe(false);
    expect(
      isHistoricalEvalGroundTruth({
        jobId: "job-1",
        jobAssignmentSource: "AI_SUGGESTED",
      })
    ).toBe(false);
    expect(
      isHistoricalEvalGroundTruth({
        jobId: "job-1",
        jobAssignmentSource: "AI_AUTO_ASSIGNED",
      })
    ).toBe(false);
    expect(
      isHistoricalEvalGroundTruth({
        jobId: "job-1",
        jobAssignmentSource: "JOB_NUMBER_MATCH",
      })
    ).toBe(false);
  });
});

describe("eligibility modes", () => {
  it("production excludes COMPLETE; evaluation includes historical Jobs", () => {
    expect(isJobMatcherEligibleStatus("COMPLETE")).toBe(false);
    expect(isJobMatcherEligibleStatus("ARCHIVED")).toBe(false);
    expect(isJobMatcherEligibleStatus("ACTIVE")).toBe(true);
    expect(isJobMatcherEligibleStatus("COMPLETE", "evaluation")).toBe(true);
    expect(isJobMatcherEligibleStatus("ARCHIVED", "evaluation")).toBe(true);
    expect(isJobMatcherEligibleStatus("CANCELLED", "evaluation")).toBe(true);
  });
});

describe("historical eval metrics", () => {
  it("classifies outcomes without lumping non-matches into wrong", () => {
    expect(
      classifyHistoricalEvalOutcome({
        trueJobId: "job-active",
        result: matchResult({
          decision: "MATCH",
          selectedJobId: "job-active",
        }),
      })
    ).toBe("CORRECT_MATCH");
    expect(
      classifyHistoricalEvalOutcome({
        trueJobId: "job-active",
        result: matchResult({
          decision: "MATCH",
          selectedJobId: "job-other",
        }),
      })
    ).toBe("WRONG_MATCH");
    expect(
      classifyHistoricalEvalOutcome({
        trueJobId: "job-active",
        result: matchResult({ decision: "AMBIGUOUS" }),
      })
    ).toBe("AMBIGUOUS");
    expect(
      classifyHistoricalEvalOutcome({
        trueJobId: "job-active",
        result: matchResult({ decision: "CONFLICT" }),
      })
    ).toBe("CONFLICT");
    expect(
      classifyHistoricalEvalOutcome({
        trueJobId: "job-active",
        result: matchResult({ decision: "NO_MATCH" }),
      })
    ).toBe("NO_MATCH");
  });

  it("computes precision, coverage, and zero-MATCH precision as n/a", () => {
    const mixed = aggregateHistoricalEvalResults([
      evalEmail({
        id: "a",
        trueJobId: "job-active",
        result: matchResult({
          decision: "MATCH",
          selectedJobId: "job-active",
          markerTrace: [
            {
              marker: "NAME",
              status: "MATCH",
              selectedJobId: "job-active",
              candidateJobIds: ["job-active"],
            },
          ],
        }),
      }),
      evalEmail({
        id: "b",
        trueJobId: "job-active",
        result: matchResult({
          decision: "MATCH",
          selectedJobId: "job-other",
        }),
      }),
      evalEmail({
        id: "c",
        trueJobId: "job-active",
        result: matchResult({ decision: "AMBIGUOUS" }),
      }),
      evalEmail({
        id: "d",
        trueJobId: "job-active",
        result: matchResult({ decision: "CONFLICT" }),
      }),
      evalEmail({
        id: "e",
        trueJobId: "job-active",
        result: matchResult({ decision: "NO_MATCH" }),
      }),
    ]);
    expect(mixed.totalEvaluated).toBe(5);
    expect(mixed.correctMatches).toBe(1);
    expect(mixed.wrongMatches).toBe(1);
    expect(mixed.ambiguous).toBe(1);
    expect(mixed.conflict).toBe(1);
    expect(mixed.noMatch).toBe(1);
    expect(mixed.precision).toBe(0.5);
    expect(mixed.correctCoverage).toBe(0.2);
    expect(mixed.wrongMatchRate).toBe(0.2);
    expect(mixed.marker1Resolutions).toBe(1);

    const none = aggregateHistoricalEvalResults([]);
    expect(none.precision).toBeNull();
    expect(none.correctCoverage).toBe(0);
    expect(shadowReadinessRecommendation(none)).toMatch(/No authoritative emails/);

    const noMatchOnly = aggregateHistoricalEvalResults([
      evalEmail({
        id: "z",
        trueJobId: "job-active",
        result: matchResult({ decision: "NO_MATCH" }),
      }),
    ]);
    expect(noMatchOnly.precision).toBeNull();
    expect(shadowReadinessRecommendation(noMatchOnly)).toMatch(/NOT ready/);
  });

  it("truncates wrong-match diagnostics but keeps the aggregate count", () => {
    const rows = [1, 2, 3].map((n) =>
      evalEmail({
        id: `msg-${n}`,
        subject: `Subject ${n}`,
        trueJobId: "job-active",
        result: matchResult({
          decision: "MATCH",
          selectedJobId: "job-other",
          markerTrace: [
            {
              marker: "NAME",
              status: "MATCH",
              selectedJobId: "job-other",
              candidateJobIds: ["job-other"],
            },
          ],
        }),
      })
    );
    const jobsById = new Map([
      [jobActive.id, jobActive],
      [jobOther.id, jobOther],
    ]);
    const wrong = buildWrongMatchDetails({
      rows,
      jobsById,
      maxWrongDetails: 1,
    });
    expect(wrong.totalWrong).toBe(3);
    expect(wrong.details).toHaveLength(1);
    expect(wrong.truncated).toBe(2);
    const report = formatHistoricalEvalReport({
      dataset: {
        workspaceId: "ws-1",
        workspaceName: "Acme",
        totalEmails: 10,
        jobLinkedEmails: 8,
        authoritativeEmails: 5,
        nonAuthoritativeJobLinkedEmails: 3,
        distinctAuthoritativeJobs: 2,
        countsByJobStatus: { ACTIVE: 2 },
        countsByAssignmentSource: { USER_ASSIGNED: 5 },
        manualAssignmentCount: 4,
        verifiedProjectFolderCount: 1,
        sentCount: 1,
        receivedCount: 4,
        unknownDirectionCount: 0,
        distinctInboxConnections: 1,
      },
      metrics: aggregateHistoricalEvalResults(rows),
      wrong,
      autoAssignEnabled: false,
      databaseWrites: "NONE",
    });
    expect(report).toContain("Wrong-match count: 3");
    expect(report).toContain("truncated 2 additional wrong-match details");
    expect(report).toContain("Internal Job number evidence: DISABLED");
    expect(report).toContain("JOB_NUMBER_MATCH ground truth: EXCLUDED");
    expect(report).toContain("Database writes: NONE");
    expect(report).toContain("Auto-assignment: OFF");
    expect(report).not.toMatch(/bodyText|BEGIN EMAIL/);
  });
});

describe("internal Job number safety", () => {
  it("flags SUBJECT_JOB_NUMBER / JOB_NUMBER_MATCH if the live matcher emitted them", () => {
    expect(
      matcherUsedInternalJobNumber(
        matchResult({
          evidence: [{ type: "SUBJECT_JOB_NAME", value: "Alleghany", confidence: 0.9 }],
        })
      )
    ).toBe(false);
    expect(
      matcherUsedInternalJobNumber(
        matchResult({
          evidence: [{ type: "SUBJECT_JOB_NUMBER", value: "1001", confidence: 1 }],
        })
      )
    ).toBe(true);
    const metrics = aggregateHistoricalEvalResults([
      evalEmail({
        id: "unsafe",
        trueJobId: "job-active",
        result: matchResult({
          decision: "MATCH",
          selectedJobId: "job-active",
          assignmentSource: "JOB_NUMBER_MATCH",
          evidence: [{ type: "CONTENT_JOB_NUMBER", value: "1001", confidence: 1 }],
        }),
      }),
    ]);
    expect(metrics.internalJobNumberEvidenceCount).toBe(1);
    expect(metrics.jobNumberMatchEmittedCount).toBe(1);
  });
});

describe("read-only prisma guard", () => {
  it("allows reads and blocks writes", () => {
    expect(() => assertReadOnlyPrismaOperation("findMany")).not.toThrow();
    expect(() => assertReadOnlyPrismaOperation("count")).not.toThrow();
    expect(() => assertReadOnlyPrismaOperation("groupBy")).not.toThrow();
    expect(() => assertReadOnlyPrismaOperation("create")).toThrow(/blocked write/);
    expect(() => assertReadOnlyPrismaOperation("updateMany")).toThrow(/blocked write/);
    expect(() => assertReadOnlyPrismaOperation("delete")).toThrow(/blocked write/);
    expect(() => assertReadOnlyPrismaOperation("$executeRaw")).toThrow(/blocked write/);
  });
});

describe("holdout snapshot loader", () => {
  it("excludes the held-out email from Marker 2 and Marker 3 but keeps sibling thread evidence", async () => {
    const loader = createJobMatchEvalLoaderFromSnapshot({
      workspaceId: "ws-1",
      jobs: [jobActive, jobComplete, jobOther],
      aliases: [],
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-a",
          jobId: jobComplete.id,
          senderEmail: "gc@example.com",
          inboxConnectionId: "conn-1",
          providerThreadId: "thread-1",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
        {
          id: "msg-b",
          jobId: jobComplete.id,
          senderEmail: "other@example.com",
          inboxConnectionId: "conn-1",
          providerThreadId: "thread-1",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
        {
          id: "msg-c",
          jobId: jobComplete.id,
          senderEmail: "gc@example.com",
          inboxConnectionId: "conn-1",
          providerThreadId: "thread-1",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    const service = new JobMatcherService(loader, null, { logCompletions: false });

    const heldOutContact = await loader.loadActiveExactContactJobs({
      workspaceId: "ws-1",
      senderEmail: "gc@example.com",
      excludeEmailMessageId: "msg-c",
      eligibleJobs: [jobComplete],
    });
    expect(heldOutContact.some((hit) => hit.supportingEmailIds?.includes("msg-c"))).toBe(
      false
    );
    expect(heldOutContact.some((hit) => hit.supportingEmailIds?.includes("msg-a"))).toBe(
      true
    );

    const heldOutThread = await loader.loadAuthoritativeThreadJobs({
      workspaceId: "ws-1",
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      excludeEmailMessageId: "msg-c",
      eligibleJobs: [jobComplete],
    });
    expect(heldOutThread[0]?.supportingEmailIds).not.toContain("msg-c");
    expect(heldOutThread[0]?.supportingEmailIds).toEqual(
      expect.arrayContaining(["msg-a", "msg-b"])
    );

    const isolated = await loader.loadActiveJobs("ws-other");
    expect(isolated).toEqual([]);

    const result = await service.match({
      workspaceId: "ws-1",
      emailMessageId: "msg-c",
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      subject: "drawings",
      cleanBody: "",
      senderEmail: "nobody@example.com",
      eligibilityMode: "evaluation",
    });
    expect(result.selectedJobId).toBe(jobComplete.id);
    expect(result.assignmentSource).not.toBe("JOB_NUMBER_MATCH");
    expect(matcherUsedInternalJobNumber(result)).toBe(false);

    const selfOnly = createJobMatchEvalLoaderFromSnapshot({
      workspaceId: "ws-1",
      jobs: [jobComplete],
      aliases: [],
      manualContacts: [],
      authoritativeEmails: [
        {
          id: "msg-c",
          jobId: jobComplete.id,
          senderEmail: "gc@example.com",
          inboxConnectionId: "conn-1",
          providerThreadId: "thread-1",
          jobAssignmentIsManual: true,
          jobAssignmentSource: "USER_ASSIGNED",
        },
      ],
    });
    const contactSelf = await selfOnly.loadActiveExactContactJobs({
      workspaceId: "ws-1",
      senderEmail: "gc@example.com",
      excludeEmailMessageId: "msg-c",
      eligibleJobs: [jobComplete],
    });
    expect(contactSelf).toEqual([]);
    const threadSelf = await selfOnly.loadAuthoritativeThreadJobs({
      workspaceId: "ws-1",
      inboxConnectionId: "conn-1",
      providerThreadId: "thread-1",
      excludeEmailMessageId: "msg-c",
      eligibleJobs: [jobComplete],
    });
    expect(threadSelf).toEqual([]);
  });

  it("does not match on internal Job.jobNumber", async () => {
    const loader = createJobMatchEvalLoaderFromSnapshot({
      workspaceId: "ws-1",
      jobs: [jobActive],
      aliases: [],
      manualContacts: [],
      authoritativeEmails: [],
    });
    const service = new JobMatcherService(loader, null, { logCompletions: false });
    const result = await service.match({
      workspaceId: "ws-1",
      emailMessageId: "msg-po",
      subject: "PO 1001",
      cleanBody: "Job #1001",
      eligibilityMode: "evaluation",
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.assignmentSource).not.toBe("JOB_NUMBER_MATCH");
    expect(matcherUsedInternalJobNumber(result)).toBe(false);
  });
});
