/**
 * Synthetic V2 vs V2.3 comparison for Beltline normalized-subject cases.
 * Local forgeops_dev has no job-linked historical emails for a live run.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import { computeJobMatcherPerformanceScore } from "../jobs/job-match-performance-score.js";
import type { HistoricalEvalOutcome } from "../jobs/job-match-historical-eval.js";

function job(id: string, name: string): JobRecordForMatch {
  return {
    id,
    jobNumber: "1",
    name,
    normalizedName: name.toLowerCase(),
    customerId: "cust-belt",
    externalRef: null,
    status: "ACTIVE",
  };
}

const pool = [
  job("job-ramp", "Beltline Parking Ramp"),
  job("job-b1", "Beltline Bldg #1"),
  job("job-b2", "Beltline Bldg #2"),
];

function classify(status: string, selected: string | null, truth: string): HistoricalEvalOutcome {
  if (status === "MATCH") {
    return selected === truth ? "CORRECT_MATCH" : "WRONG_MATCH";
  }
  if (status === "AMBIGUOUS") return "AMBIGUOUS";
  if (status === "CONFLICT") return "CONFLICT";
  return "NO_MATCH";
}

describe("V2 vs V2.3 Beltline fixture comparison", () => {
  it("reports no newly-wrong V2.3 assignments on fixture set", () => {
    const fixtures = [
      {
        id: "hyphen-ramp",
        subject: "Belt-line parking ramp",
        body: "",
        truth: "job-ramp",
      },
      {
        id: "building-1",
        subject: "Beltline Building 1- Structural steel shops",
        body: "Parking ramp drawings will be issued separately.",
        truth: "job-b1",
      },
      {
        id: "generic-beltline",
        subject: "Beltline drawing revisions",
        body: "",
        truth: "job-b1",
      },
      {
        id: "explicit-contradiction",
        subject: "Beltline Building 1 - Structural steel shops",
        body: "Correction: these drawings are actually for the parking ramp, not Building 1.",
        truth: "job-b1",
      },
    ] as const;

    const rows = fixtures.map((f) => {
      const v2 = runJobNameMarker({
        subject: f.subject,
        cleanBody: f.body,
        jobs: pool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      });
      const v23 = runJobNameMarker({
        subject: f.subject,
        cleanBody: f.body,
        jobs: pool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_3,
      });
      return {
        id: f.id,
        v2: classify(v2.status, v2.selectedJobId, f.truth),
        v23: classify(v23.status, v23.selectedJobId, f.truth),
        v23Job: v23.selectedJobId,
        v23Reason: v23.identityDiagnostics.reason,
      };
    });

    const tally = (key: "v2" | "v23") => {
      const outcomes = rows.map((r) => r[key]);
      const counts = {
        totalEvaluated: outcomes.length,
        correctMatches: outcomes.filter((o) => o === "CORRECT_MATCH").length,
        wrongMatches: outcomes.filter((o) => o === "WRONG_MATCH").length,
        ambiguous: outcomes.filter((o) => o === "AMBIGUOUS").length,
        conflict: outcomes.filter((o) => o === "CONFLICT").length,
        noMatch: outcomes.filter((o) => o === "NO_MATCH").length,
      };
      return { ...counts, jmps: computeJobMatcherPerformanceScore(counts) };
    };

    const v2m = tally("v2");
    const v23m = tally("v23");
    const ambToCorrect = rows.filter(
      (r) => r.v2 === "AMBIGUOUS" && r.v23 === "CORRECT_MATCH"
    );
    const newlyWrong = rows.filter((r) => r.v23 === "WRONG_MATCH");
    const correctRegressed = rows.filter(
      (r) => r.v2 === "CORRECT_MATCH" && r.v23 !== "CORRECT_MATCH"
    );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          note: "Synthetic Beltline fixtures (local DB has 0 job-linked emails)",
          v2: {
            correct: v2m.correctMatches,
            wrong: v2m.wrongMatches,
            ambiguous: v2m.ambiguous,
            jmps: v2m.jmps.display,
          },
          v23: {
            correct: v23m.correctMatches,
            wrong: v23m.wrongMatches,
            ambiguous: v23m.ambiguous,
            jmps: v23m.jmps.display,
          },
          ambiguousToCorrect: ambToCorrect.map((r) => r.id),
          newlyWrong: newlyWrong.map((r) => r.id),
          correctRegressed: correctRegressed.map((r) => r.id),
          rows,
        },
        null,
        2
      )
    );

    expect(newlyWrong).toHaveLength(0);
    expect(correctRegressed).toHaveLength(0);
    expect(ambToCorrect.map((r) => r.id)).toEqual(
      expect.arrayContaining(["hyphen-ramp", "building-1"])
    );
    expect(v23m.correctMatches).toBeGreaterThan(v2m.correctMatches);
  });
});
