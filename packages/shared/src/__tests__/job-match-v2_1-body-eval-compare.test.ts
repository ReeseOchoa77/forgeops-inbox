/**
 * Synthetic V2 vs V2.1 evaluation comparison for body disambiguation.
 * Local forgeops_dev currently has no job-linked emails for a live historical run.
 */
import { describe, expect, it } from "vitest";
import {
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
  JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
  runJobNameMarker,
} from "../jobs/job-name-marker.js";
import type { JobRecordForMatch } from "../jobs/job-matcher.js";
import { computeJobMatcherPerformanceScore } from "../jobs/job-match-performance-score.js";
import type { HistoricalEvalOutcome } from "../jobs/job-match-historical-eval.js";

function classifyMarkerOutcome(input: {
  status: string;
  selectedJobId: string | null;
  trueJobId: string | null;
}): HistoricalEvalOutcome {
  if (input.status === "MATCH") {
    if (input.trueJobId && input.selectedJobId === input.trueJobId) {
      return "CORRECT_MATCH";
    }
    return "WRONG_MATCH";
  }
  if (input.status === "AMBIGUOUS") return "AMBIGUOUS";
  if (input.status === "CONFLICT") return "CONFLICT";
  return "NO_MATCH";
}

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
    customerId: "cust-sat",
    externalRef: null,
    status: "ACTIVE",
    ...extras,
  };
}

const satStairs = job("job-sat-stairs", "SAT - Exterior Stairs");
const satConc = job("job-sat-conc", "SAT - Concessions");
const satSteel = job("job-sat-steel", "SAT - Structural Steel");
const satPool = [satStairs, satConc, satSteel];

type Fixture = {
  id: string;
  subject: string;
  cleanBody: string;
  truthJobId: string | null;
  /** Expected when body disambiguation should resolve uniquely. */
  expectV21JobId?: string | null;
};

const fixtures: Fixture[] = [
  {
    id: "body-conc",
    subject: "SAT - Updated Drawings",
    cleanBody: "Please review the revised concessions drawings.",
    truthJobId: "job-sat-conc",
    expectV21JobId: "job-sat-conc",
  },
  {
    id: "body-stairs",
    subject: "SAT - Updated Drawings",
    cleanBody: "Please review the revised stairs drawings.",
    truthJobId: "job-sat-stairs",
    expectV21JobId: "job-sat-stairs",
  },
  {
    id: "no-evidence",
    subject: "SAT - Updated Drawings",
    cleanBody: "Please see the attached revised drawings.",
    truthJobId: "job-sat-conc",
    expectV21JobId: null,
  },
  {
    id: "generic-vocab",
    subject: "SAT - Updated Drawings",
    cleanBody: "Steel fabrication status update for the project delivery.",
    truthJobId: "job-sat-steel",
    expectV21JobId: null,
  },
  {
    id: "competing",
    subject: "SAT - Updated Drawings",
    cleanBody: "Please review the stairs and concessions changes.",
    truthJobId: "job-sat-stairs",
    expectV21JobId: null,
  },
  {
    id: "quoted-only",
    subject: "SAT - Updated Drawings",
    cleanBody: [
      "Please see the attached revised drawings.",
      "",
      "On Mon, someone wrote:",
      "> Please review the revised concessions drawings.",
    ].join("\n"),
    truthJobId: "job-sat-conc",
    expectV21JobId: null,
  },
  {
    id: "negation-stairs",
    subject: "SAT - Updated Drawings",
    cleanBody:
      "These drawings are not for concessions. They are for the exterior stairs.",
    truthJobId: "job-sat-stairs",
    expectV21JobId: "job-sat-stairs",
  },
  {
    id: "subject-already-clear",
    subject: "SAT - Concessions shop drawings",
    cleanBody: "",
    truthJobId: "job-sat-conc",
    expectV21JobId: "job-sat-conc",
  },
  {
    id: "case-insensitive",
    subject: "SAT - Updated Drawings",
    cleanBody: "Please review the revised CONCESSIONS drawings.",
    truthJobId: "job-sat-conc",
    expectV21JobId: "job-sat-conc",
  },
];

function tally(outcomes: HistoricalEvalOutcome[]) {
  const counts = {
    totalEvaluated: outcomes.length,
    correctMatches: 0,
    wrongMatches: 0,
    ambiguous: 0,
    conflict: 0,
    noMatch: 0,
  };
  for (const o of outcomes) {
    if (o === "CORRECT_MATCH") counts.correctMatches += 1;
    else if (o === "WRONG_MATCH") counts.wrongMatches += 1;
    else if (o === "AMBIGUOUS") counts.ambiguous += 1;
    else if (o === "CONFLICT") counts.conflict += 1;
    else counts.noMatch += 1;
  }
  const decided = counts.correctMatches + counts.wrongMatches;
  return {
    ...counts,
    precision: decided === 0 ? null : counts.correctMatches / decided,
    coverage: counts.totalEvaluated === 0 ? 0 : counts.correctMatches / counts.totalEvaluated,
    jmps: computeJobMatcherPerformanceScore(counts),
  };
}

describe("V2 vs V2.1 body-disambiguation fixture comparison", () => {
  it("reports metric deltas and transition examples", () => {
    const rows = fixtures.map((f) => {
      const v2 = runJobNameMarker({
        subject: f.subject,
        cleanBody: f.cleanBody,
        jobs: satPool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2,
      });
      const v21 = runJobNameMarker({
        subject: f.subject,
        cleanBody: f.cleanBody,
        jobs: satPool,
        identityPolicy: JOB_MATCH_IDENTITY_POLICY_CONTEXT_AWARE_V2_1,
      });
      const v2Outcome = classifyMarkerOutcome({
        status: v2.status,
        selectedJobId: v2.selectedJobId,
        trueJobId: f.truthJobId,
      });
      const v21Outcome = classifyMarkerOutcome({
        status: v21.status,
        selectedJobId: v21.selectedJobId,
        trueJobId: f.truthJobId,
      });
      if (f.expectV21JobId === null) {
        expect(v21.selectedJobId).toBeNull();
      } else if (f.expectV21JobId) {
        expect(v21.selectedJobId).toBe(f.expectV21JobId);
      }
      return {
        id: f.id,
        truth: f.truthJobId,
        v2: {
          status: v2.status,
          job: v2.selectedJobId,
          reason: v2.identityDiagnostics.reason,
          outcome: v2Outcome,
        },
        v21: {
          status: v21.status,
          job: v21.selectedJobId,
          reason: v21.identityDiagnostics.reason,
          outcome: v21Outcome,
          evidenceField: v21.identityDiagnostics.evidenceField ?? null,
          distinguishing: v21.identityDiagnostics.distinguishingIdentityTerms,
        },
      };
    });

    const v2Metrics = tally(rows.map((r) => r.v2.outcome));
    const v21Metrics = tally(rows.map((r) => r.v21.outcome));

    const previouslyAmbiguousNowCorrect = rows.filter(
      (r) =>
        r.v2.outcome === "AMBIGUOUS" && r.v21.outcome === "CORRECT_MATCH"
    );
    const previouslyAmbiguousNowWrong = rows.filter(
      (r) => r.v2.outcome === "AMBIGUOUS" && r.v21.outcome === "WRONG_MATCH"
    );
    const previouslyWrongNowCorrect = rows.filter(
      (r) =>
        r.v2.outcome === "WRONG_MATCH" && r.v21.outcome === "CORRECT_MATCH"
    );
    const previouslyCorrectNowRegressed = rows.filter(
      (r) =>
        r.v2.outcome === "CORRECT_MATCH" && r.v21.outcome !== "CORRECT_MATCH"
    );
    const bodyDisambiguationExamples = rows.filter(
      (r) => r.v21.reason === "UNIQUE_BODY_DISAMBIGUATION"
    );

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          note: "Synthetic fixture set (local DB has 0 job-linked emails)",
          v2: {
            correct: v2Metrics.correctMatches,
            wrong: v2Metrics.wrongMatches,
            ambiguous: v2Metrics.ambiguous,
            conflict: v2Metrics.conflict,
            noMatch: v2Metrics.noMatch,
            precision: v2Metrics.precision,
            coverage: v2Metrics.coverage,
            jmps: v2Metrics.jmps.display,
          },
          v21: {
            correct: v21Metrics.correctMatches,
            wrong: v21Metrics.wrongMatches,
            ambiguous: v21Metrics.ambiguous,
            conflict: v21Metrics.conflict,
            noMatch: v21Metrics.noMatch,
            precision: v21Metrics.precision,
            coverage: v21Metrics.coverage,
            jmps: v21Metrics.jmps.display,
          },
          previouslyAmbiguousNowCorrect: previouslyAmbiguousNowCorrect.map(
            (r) => r.id
          ),
          previouslyAmbiguousNowWrong: previouslyAmbiguousNowWrong.map(
            (r) => r.id
          ),
          previouslyWrongNowCorrect: previouslyWrongNowCorrect.map((r) => r.id),
          previouslyCorrectNowRegressed: previouslyCorrectNowRegressed.map(
            (r) => r.id
          ),
          bodyDisambiguationExamples: bodyDisambiguationExamples.map((r) => ({
            id: r.id,
            job: r.v21.job,
            distinguishing: r.v21.distinguishing,
            evidenceField: r.v21.evidenceField,
          })),
        },
        null,
        2
      )
    );

    expect(previouslyAmbiguousNowWrong).toHaveLength(0);
    expect(previouslyCorrectNowRegressed).toHaveLength(0);
    expect(previouslyAmbiguousNowCorrect.length).toBeGreaterThanOrEqual(3);
    expect(bodyDisambiguationExamples.length).toBeGreaterThanOrEqual(3);
    expect(v21Metrics.correctMatches).toBeGreaterThan(v2Metrics.correctMatches);
    expect(v21Metrics.jmps.score ?? 0).toBeGreaterThan(v2Metrics.jmps.score ?? 0);
  });
});
