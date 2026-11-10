import { describe, expect, it } from "vitest";
import {
  JOB_MATCHER_EVAL_MAX_SYNC,
  buildJobMatcherEvalJobBreakdown,
  selectEvalEmailIds,
  validateJobMatcherEvalDatasetSpec,
  type EligibleEmailIndexRow,
} from "../jobs/job-match-eval-dataset.js";
import type { HistoricalEvalEmail } from "../jobs/job-match-historical-eval.js";
import type { JobMatchResult, JobRecordForMatch } from "../jobs/job-matcher.js";

function email(id: string, jobId: string): EligibleEmailIndexRow {
  return { id, jobId };
}

function matchResult(selectedJobId: string | null, decision: JobMatchResult["decision"]): JobMatchResult {
  return {
    selectedJobId,
    confidence: selectedJobId ? 1 : 0,
    evidence: [],
    ambiguousCandidateIds: [],
    candidateJobIds: selectedJobId ? [selectedJobId] : [],
    decision,
    markerTrace: [],
    requiresReview: false,
    assignmentSource: null,
    candidateCount: selectedJobId ? 1 : 0,
    matcherVersion: "test",
  };
}

describe("validateJobMatcherEvalDatasetSpec", () => {
  it("requires one job for SPECIFIC and at least one for SELECTED", () => {
    expect(
      validateJobMatcherEvalDatasetSpec({
        jobsMode: "SPECIFIC",
        jobIds: [],
        sampling: "TOTAL",
        count: 25,
        jobLifecycle: "ALL",
      })
    ).toMatch(/exactly one/);
    expect(
      validateJobMatcherEvalDatasetSpec({
        jobsMode: "SELECTED",
        jobIds: [],
        sampling: "PER_JOB",
        count: 10,
        jobLifecycle: "ALL",
      })
    ).toMatch(/at least one/);
  });

  it("rejects ALL with jobIds", () => {
    expect(
      validateJobMatcherEvalDatasetSpec({
        jobsMode: "ALL",
        jobIds: ["j1"],
        sampling: "TOTAL",
        count: 50,
        jobLifecycle: "ALL",
      })
    ).toMatch(/must not include jobIds/);
  });
});

describe("selectEvalEmailIds", () => {
  const emails = [
    email("a1", "j1"),
    email("a2", "j1"),
    email("a3", "j1"),
    email("b1", "j2"),
    email("b2", "j2"),
    email("c1", "j3"),
  ];
  const status = new Map<string, string>([
    ["j1", "ACTIVE"],
    ["j2", "ARCHIVED"],
    ["j3", "ACTIVE"],
  ]);

  it("ALL Jobs TOTAL sample round-robins without duplicates", () => {
    const r = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "ALL",
        jobIds: [],
        sampling: "TOTAL",
        count: 4,
        jobLifecycle: "ALL",
      },
    });
    expect(r.selectedIds).toHaveLength(4);
    expect(new Set(r.selectedIds).size).toBe(4);
    expect(r.eligibleCount).toBe(6);
    expect(r.jobsInScope).toBe(3);
  });

  it("ALL Jobs PER_JOB samples each Job", () => {
    const r = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "ALL",
        jobIds: [],
        sampling: "PER_JOB",
        count: 2,
        jobLifecycle: "ALL",
      },
    });
    expect(r.selectedIds).toEqual(["a1", "a2", "b1", "b2", "c1"]);
  });

  it("ALL Jobs ALL_ELIGIBLE returns all within sync max", () => {
    const r = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "ALL",
        jobIds: [],
        sampling: "ALL_ELIGIBLE",
        count: null,
        jobLifecycle: "ALL",
      },
    });
    expect(r.selectedIds).toHaveLength(6);
  });

  it("SPECIFIC Job sample and all-eligible", () => {
    const sample = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "SPECIFIC",
        jobIds: ["j1"],
        sampling: "TOTAL",
        count: 2,
        jobLifecycle: "ALL",
      },
    });
    expect(sample.selectedIds).toEqual(["a1", "a2"]);
    expect(sample.eligibleCount).toBe(3);

    const all = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "SPECIFIC",
        jobIds: ["j1"],
        sampling: "ALL_ELIGIBLE",
        count: null,
        jobLifecycle: "ALL",
      },
    });
    expect(all.selectedIds).toEqual(["a1", "a2", "a3"]);
  });

  it("SELECTED Jobs TOTAL and PER_JOB", () => {
    const total = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "SELECTED",
        jobIds: ["j1", "j2"],
        sampling: "TOTAL",
        count: 3,
        jobLifecycle: "ALL",
      },
    });
    expect(total.selectedIds).toHaveLength(3);
    expect(total.jobsInScope).toBe(2);

    const per = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "SELECTED",
        jobIds: ["j1", "j2"],
        sampling: "PER_JOB",
        count: 1,
        jobLifecycle: "ALL",
      },
    });
    expect(per.selectedIds).toEqual(["a1", "b1"]);
  });

  it("CURRENT lifecycle excludes archived Jobs", () => {
    const r = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "ALL",
        jobIds: [],
        sampling: "ALL_ELIGIBLE",
        count: null,
        jobLifecycle: "CURRENT",
      },
    });
    expect(r.selectedIds).toEqual(["a1", "a2", "a3", "c1"]);
    expect(r.jobsInScope).toBe(2);
  });

  it("requested count larger than available returns available without duplicates", () => {
    const r = selectEvalEmailIds({
      emails,
      jobStatusById: status,
      spec: {
        jobsMode: "SPECIFIC",
        jobIds: ["j3"],
        sampling: "TOTAL",
        count: 50,
        jobLifecycle: "ALL",
      },
    });
    expect(r.selectedIds).toEqual(["c1"]);
    expect(r.expectedMax).toBe(1);
  });

  it("caps ALL_ELIGIBLE at sync max", () => {
    const many = Array.from({ length: JOB_MATCHER_EVAL_MAX_SYNC + 5 }, (_, i) =>
      email(`e${String(i).padStart(4, "0")}`, "j1")
    );
    const r = selectEvalEmailIds({
      emails: many,
      jobStatusById: new Map([["j1", "ACTIVE"]]),
      spec: {
        jobsMode: "ALL",
        jobIds: [],
        sampling: "ALL_ELIGIBLE",
        count: null,
        jobLifecycle: "ALL",
      },
    });
    expect(r.selectedIds).toHaveLength(JOB_MATCHER_EVAL_MAX_SYNC);
    expect(r.capped).toBe(true);
  });
});

describe("buildJobMatcherEvalJobBreakdown", () => {
  it("aggregates per-Job outcomes and sums to total evaluated", () => {
    const jobsById = new Map<string, JobRecordForMatch>([
      [
        "j1",
        {
          id: "j1",
          jobNumber: "100",
          name: "Alpha",
          normalizedName: "alpha",
          customerId: null,
          externalRef: null,
          siteName: null,
          description: null,
          status: "ACTIVE",
        },
      ],
      [
        "j2",
        {
          id: "j2",
          jobNumber: "200",
          name: "Beta",
          normalizedName: "beta",
          customerId: null,
          externalRef: null,
          siteName: null,
          description: null,
          status: "ACTIVE",
        },
      ],
    ]);
    const rows: HistoricalEvalEmail[] = [
      {
        id: "1",
        subject: "a",
        direction: "RECEIVED",
        trueJobId: "j1",
        result: matchResult("j1", "MATCH"),
      },
      {
        id: "2",
        subject: "b",
        direction: "RECEIVED",
        trueJobId: "j1",
        result: matchResult("j2", "MATCH"),
      },
      {
        id: "3",
        subject: "c",
        direction: "RECEIVED",
        trueJobId: "j2",
        result: matchResult(null, "NO_MATCH"),
      },
      {
        id: "4",
        subject: "d",
        direction: "RECEIVED",
        trueJobId: "j2",
        result: matchResult(null, "AMBIGUOUS"),
      },
    ];
    const breakdown = buildJobMatcherEvalJobBreakdown(rows, jobsById);
    expect(breakdown).toHaveLength(2);
    const alpha = breakdown.find((b) => b.jobId === "j1")!;
    const beta = breakdown.find((b) => b.jobId === "j2")!;
    expect(alpha).toMatchObject({ evaluated: 2, correct: 1, wrong: 1 });
    expect(beta).toMatchObject({ evaluated: 2, noMatch: 1, ambiguous: 1 });
    expect(alpha.evaluated + beta.evaluated).toBe(rows.length);
  });
});
