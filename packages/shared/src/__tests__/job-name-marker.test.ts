import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isJobMatcherAutoAssignEnabled } from "../ai-automation-gates.js";
import { JobMatcherService, type JobMatchDataLoader } from "../jobs/job-matcher-service.js";
import { evaluateJobMatchCases } from "../jobs/job-match-eval.js";
import {
  JOB_MATCH_PIPELINE_VERSION,
  narrowJobMatchCandidates,
  runJobMatchPipeline,
} from "../jobs/job-match-pipeline.js";
import { JOB_NAME_MARKER_VERSION, runJobNameMarker } from "../jobs/job-name-marker.js";
import {
  canonicalizeJobNameTokens,
  canonicalJobNamePhrase,
  isDistinguishingJobNameToken,
} from "../jobs/job-name-normalize.js";
import type {
  JobMatchAssignmentSource,
  JobRecordForMatch,
} from "../jobs/job-matcher.js";

const here = import.meta.dirname;

const alleghany: JobRecordForMatch = {
  id: "job-2191",
  jobNumber: "2191",
  name: "Alleghany Apartments",
  normalizedName: "alleghany apartments",
  customerId: "cust-1",
  externalRef: null,
  status: "ACTIVE",
};

const belt1: JobRecordForMatch = {
  id: "job-2192",
  jobNumber: "2192",
  name: "Beltline Building #1",
  normalizedName: "beltline building #1",
  customerId: "cust-2",
  externalRef: null,
  status: "ACTIVE",
};

const belt2: JobRecordForMatch = {
  id: "job-2193",
  jobNumber: "2193",
  name: "Beltline Building #2",
  normalizedName: "beltline building #2",
  customerId: "cust-2",
  externalRef: null,
  status: "ACTIVE",
};

const mercy: JobRecordForMatch = {
  id: "job-2194",
  jobNumber: "2194",
  name: "Mercy Hospital Addition",
  normalizedName: "mercy hospital addition",
  customerId: "cust-3",
  externalRef: null,
  status: "ACTIVE",
};

const pool = [alleghany, belt1, belt2, mercy];

describe("canonicalizeJobNameTokens", () => {
  it("equates Bldg with Building and keeps #1", () => {
    expect(canonicalJobNamePhrase(canonicalizeJobNameTokens("Beltline Bldg #1"))).toBe(
      "beltline building 1"
    );
    expect(
      canonicalJobNamePhrase(canonicalizeJobNameTokens("Beltline Building #1"))
    ).toBe("beltline building 1");
  });

  it("equates Apts with Apartments", () => {
    expect(canonicalJobNamePhrase(canonicalizeJobNameTokens("Alleghany Apts"))).toBe(
      "alleghany apartments"
    );
    expect(
      canonicalJobNamePhrase(canonicalizeJobNameTokens("Alleghany Apartments"))
    ).toBe("alleghany apartments");
  });

  it("does not collapse #1 and #2", () => {
    expect(canonicalizeJobNameTokens("Beltline Building #1")).toEqual([
      "beltline",
      "building",
      "1",
    ]);
    expect(canonicalizeJobNameTokens("Beltline Building #2")).toEqual([
      "beltline",
      "building",
      "2",
    ]);
  });

  it("keeps Building/Phase/North as tokens and treats numbers and compass as distinguishing", () => {
    expect(canonicalizeJobNameTokens("Phase 2 North")).toEqual([
      "phase",
      "2",
      "north",
    ]);
    expect(isDistinguishingJobNameToken("2")).toBe(true);
    expect(isDistinguishingJobNameToken("north")).toBe(true);
    expect(isDistinguishingJobNameToken("south")).toBe(true);
  });
});

describe("runJobNameMarker", () => {
  it("exact Job name in subject", () => {
    const result = runJobNameMarker({
      subject: "RE: Alleghany Apartments - Stair Rail RFI",
      cleanBody: "Please review.",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2191");
    expect(result.ambiguousCandidateIds).toEqual([]);
  });

  it("exact Job name in body", () => {
    const result = runJobNameMarker({
      subject: "Updated drawings",
      cleanBody: "Attached are the drawings for Alleghany Apartments.",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2191");
  });

  it("normalized capitalization", () => {
    const result = runJobNameMarker({
      subject: "alleghany apartments rfi",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2191");
  });

  it("Bldg vs Building", () => {
    const result = runJobNameMarker({
      subject: "Beltline Bldg #1 RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2192");
  });

  it("Apts vs Apartments", () => {
    const result = runJobNameMarker({
      subject: "Alleghany Apts RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2191");
  });

  it("distinguishes #1 vs #2", () => {
    const result = runJobNameMarker({
      subject: "Beltline Building #1 RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2192");
    expect(result.ambiguousCandidateIds).toEqual([]);
  });

  it("ambiguous common project prefix does not pick a Job", () => {
    const result = runJobNameMarker({
      subject: "Beltline RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
    expect(result.ambiguousCandidateIds.sort()).toEqual(["job-2192", "job-2193"]);
  });

  it("unrelated subject/body is NO_MATCH", () => {
    const result = runJobNameMarker({
      subject: "Stair Rail RFI",
      cleanBody: "Please send the latest shop drawings.",
      jobs: pool,
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
    expect(result.ambiguousCandidateIds).toEqual([]);
  });

  it("quoted historical project name does not dominate", () => {
    const result = runJobNameMarker({
      subject: "FW: follow up",
      cleanBody: [
        "Please see below.",
        "",
        "On Mon, Jane wrote:",
        "> Regarding Alleghany Apartments we need drawings",
      ].join("\n"),
      jobs: pool,
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("unique distinctive token Alleghany matches the one Job", () => {
    const result = runJobNameMarker({
      subject: "Alleghany project drawings",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2191");
  });

  it("unique token in body matches", () => {
    const result = runJobNameMarker({
      subject: "Drawings",
      cleanBody:
        "Attached are the updated drawings for the Alleghany project...",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2191");
  });

  it("multiple eligible Jobs still require distinction", () => {
    const result = runJobNameMarker({
      subject: "Beltline Building #2 shop drawings",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2193");
  });

  it("COMPLETE jobs are outside the Marker 1 pool", () => {
    const result = runJobNameMarker({
      subject: "Alleghany Apartments RFI",
      cleanBody: "",
      jobs: [{ ...alleghany, status: "COMPLETE" }, belt1],
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("evaluation eligibility includes COMPLETE historical Jobs without changing production", () => {
    const production = runJobNameMarker({
      subject: "Alleghany Apartments RFI",
      cleanBody: "",
      jobs: [{ ...alleghany, status: "COMPLETE" }],
    });
    expect(production.status).toBe("NO_MATCH");
    const evaluation = runJobNameMarker({
      subject: "Alleghany Apartments RFI",
      cleanBody: "",
      jobs: [{ ...alleghany, status: "COMPLETE" }],
      eligibilityMode: "evaluation",
    });
    expect(evaluation.status).toBe("MATCH");
    expect(evaluation.selectedJobId).toBe(alleghany.id);
  });

  it("workspace isolation: only supplied Jobs are considered", () => {
    const otherWorkspaceJob: JobRecordForMatch = {
      ...alleghany,
      id: "other-ws-job",
    };
    const result = runJobNameMarker({
      subject: "Alleghany Apartments RFI",
      cleanBody: "",
      jobs: [belt1, belt2],
    });
    expect(result.selectedJobId).not.toBe(otherWorkspaceJob.id);
    expect(result.status).toBe("NO_MATCH");
  });

  it("Addn vs Addition", () => {
    const result = runJobNameMarker({
      subject: "Mercy Hospital Addn RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2194");
  });

  it("job alias in subject can match", () => {
    const result = runJobNameMarker({
      subject: "Nova Academy drawings",
      cleanBody: "",
      jobs: [mercy],
      aliases: [
        { jobId: "job-2194", alias: "Nova Academy", normalizedAlias: "nova academy" },
      ],
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2194");
  });

  it("Saint vs St aligns when the following name token matches", () => {
    const saint: JobRecordForMatch = {
      id: "job-saint",
      jobNumber: "2200",
      name: "Saint Mary Hospital",
      normalizedName: "saint mary hospital",
      customerId: null,
      externalRef: null,
      status: "ACTIVE",
    };
    const result = runJobNameMarker({
      subject: "St Mary Hospital RFI",
      cleanBody: "",
      jobs: [saint, mercy],
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-saint");
  });

  const stMichael1: JobRecordForMatch = {
    id: "job-sm-1",
    jobNumber: "2191",
    name: "St Michael Apartments Building 1",
    normalizedName: "st michael apartments building 1",
    customerId: "cust-sm",
    externalRef: null,
    siteName: "St Michael Apartments",
    status: "ACTIVE",
  };
  const stMichael2: JobRecordForMatch = {
    id: "job-sm-2",
    jobNumber: "2192",
    name: "St Michael Apartments Building 2",
    normalizedName: "st michael apartments building 2",
    customerId: "cust-sm",
    externalRef: "GC-4721",
    siteName: "St Michael Apartments",
    status: "ACTIVE",
  };
  const stMichael3: JobRecordForMatch = {
    id: "job-sm-3",
    jobNumber: "2193",
    name: "St Michael Apartments Building 3",
    normalizedName: "st michael apartments building 3",
    customerId: "cust-sm",
    externalRef: null,
    siteName: "St Michael Apartments",
    status: "ACTIVE",
  };
  const stMichaelPool = [stMichael1, stMichael2, stMichael3];

  it("shared campus name is AMBIGUOUS with the plausible candidate set", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apartments stair revisions",
      cleanBody: "",
      jobs: stMichaelPool,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
    expect(result.candidateJobIds.sort()).toEqual([
      "job-sm-1",
      "job-sm-2",
      "job-sm-3",
    ]);
    expect(result.ambiguousCandidateIds.sort()).toEqual(result.candidateJobIds.sort());
  });

  it("unique strong identity MATCH for Building 2 and does not pick Building 1", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apartments Building 2 stair revisions",
      cleanBody: "",
      jobs: stMichaelPool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.candidateJobIds).toEqual(["job-sm-2"]);
    expect(result.ambiguousCandidateIds).toEqual([]);
  });

  it("Beltline #1 is unique among Beltline buildings even without the word Building", () => {
    const result = runJobNameMarker({
      subject: "Beltline #1 RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2192");
  });

  it("Job.description is not Marker 1 identity", () => {
    const result = runJobNameMarker({
      subject: "SecretCodename stair RFI",
      cleanBody: "",
      jobs: [{ ...mercy, description: "SecretCodename campus expansion" }],
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("siteName alone can generate a shared candidate set", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apartments RFI",
      cleanBody: "",
      jobs: stMichaelPool.map((j) => ({
        ...j,
        name: `Building ${j.jobNumber?.slice(-1)}`,
        normalizedName: `building ${j.jobNumber?.slice(-1)}`,
      })),
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidateJobIds.sort()).toEqual([
      "job-sm-1",
      "job-sm-2",
      "job-sm-3",
    ]);
  });

  it("externalRef uniquely identifies a Job", () => {
    const result = runJobNameMarker({
      subject: "GC-4721 stair package",
      cleanBody: "",
      jobs: stMichaelPool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("internal Job number in a PO does not identify a Job", () => {
    const result = runJobNameMarker({
      subject: "PO 2192 drawings",
      cleanBody: "",
      jobs: stMichaelPool,
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("Building 2 name is not overridden by a coincidental internal Job number", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apartments Building 2 PO 2191",
      cleanBody: "",
      jobs: stMichaelPool,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });

  it("North vs South remains a unique strong identity when the rest of the name is shared", () => {
    const north: JobRecordForMatch = {
      id: "job-north",
      jobNumber: "3001",
      name: "Riverside North",
      normalizedName: "riverside north",
      customerId: null,
      externalRef: null,
      status: "ACTIVE",
    };
    const south: JobRecordForMatch = {
      id: "job-south",
      jobNumber: "3002",
      name: "Riverside South",
      normalizedName: "riverside south",
      customerId: null,
      externalRef: null,
      status: "ACTIVE",
    };
    const unique = runJobNameMarker({
      subject: "Riverside North stair RFI",
      cleanBody: "",
      jobs: [north, south],
    });
    expect(unique.status).toBe("MATCH");
    expect(unique.selectedJobId).toBe("job-north");

    const shared = runJobNameMarker({
      subject: "Riverside stair RFI",
      cleanBody: "",
      jobs: [north, south],
    });
    expect(shared.status).toBe("AMBIGUOUS");
    expect(shared.candidateJobIds.sort()).toEqual(["job-north", "job-south"]);
  });

  it("alias is reused as identity and does not need a second name store", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apts Bldg 2 RFI",
      cleanBody: "",
      jobs: stMichaelPool,
      aliases: [
        {
          jobId: "job-sm-2",
          alias: "St Michael Apts Bldg 2",
          normalizedAlias: "st michael apts bldg 2",
        },
      ],
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });
});

describe("runJobMatchPipeline", () => {
  it("MATCH selects the Job and does not require review", () => {
    const result = runJobMatchPipeline({
      subject: "Alleghany Apartments RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.selectedJobId).toBe("job-2191");
    expect(result.requiresReview).toBe(false);
    expect(result.assignmentSource).toBe("AI_AUTO_ASSIGNED");
    expect(result.matcherVersion).toBe(JOB_MATCH_PIPELINE_VERSION);
  });

  it("AMBIGUOUS does not select the first Job", () => {
    const result = runJobMatchPipeline({
      subject: "Beltline RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.assignmentSource).toBeNull();
    expect(result.requiresReview).toBe(true);
    expect(result.ambiguousCandidateIds.sort()).toEqual(["job-2192", "job-2193"]);
  });

  it("NO_MATCH does not select a Job", () => {
    const result = runJobMatchPipeline({
      subject: "Stair Rail RFI",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.assignmentSource).toBeNull();
    expect(result.requiresReview).toBe(false);
  });

  it("internal Job number is not unique identity and never emits JOB_NUMBER_MATCH", () => {
    const result = runJobMatchPipeline({
      subject: "PO 2191",
      cleanBody: "",
      jobs: pool,
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.decision).toBe("NO_MATCH");
    expect(result.assignmentSource).toBeNull();
    expect(result.assignmentSource).not.toBe("JOB_NUMBER_MATCH");
  });

  it("unique strong Marker 1 MATCH stops the pipeline (Marker 2/3 are not consulted)", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments Building 2 stair revisions",
      cleanBody: "",
      jobs: [
        {
          id: "job-sm-1",
          jobNumber: "2191",
          name: "St Michael Apartments Building 1",
          normalizedName: "st michael apartments building 1",
          customerId: null,
          externalRef: null,
          status: "ACTIVE",
        },
        {
          id: "job-sm-2",
          jobNumber: "2192",
          name: "St Michael Apartments Building 2",
          normalizedName: "st michael apartments building 2",
          customerId: null,
          externalRef: null,
          status: "ACTIVE",
        },
      ],
    });
    expect(result.decision).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.markerTrace).toEqual([
      {
        marker: "NAME",
        status: "MATCH",
        selectedJobId: "job-sm-2",
        candidateJobIds: ["job-sm-2"],
      },
    ]);
  });

  it("AMBIGUOUS Marker 1 carries candidateJobIds for later markers", () => {
    const result = runJobMatchPipeline({
      subject: "St Michael Apartments stair revisions",
      cleanBody: "",
      jobs: [
        {
          id: "job-sm-1",
          jobNumber: "2191",
          name: "St Michael Apartments Building 1",
          normalizedName: "st michael apartments building 1",
          customerId: null,
          externalRef: null,
          siteName: "St Michael Apartments",
          status: "ACTIVE",
        },
        {
          id: "job-sm-2",
          jobNumber: "2192",
          name: "St Michael Apartments Building 2",
          normalizedName: "st michael apartments building 2",
          customerId: null,
          externalRef: null,
          siteName: "St Michael Apartments",
          status: "ACTIVE",
        },
        {
          id: "job-sm-3",
          jobNumber: "2193",
          name: "St Michael Apartments Building 3",
          normalizedName: "st michael apartments building 3",
          customerId: null,
          externalRef: null,
          siteName: "St Michael Apartments",
          status: "ACTIVE",
        },
      ],
    });
    expect(result.decision).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
    expect(result.candidateJobIds?.sort()).toEqual([
      "job-sm-1",
      "job-sm-2",
      "job-sm-3",
    ]);
  });
});

describe("narrowJobMatchCandidates", () => {
  it("unique strong name MATCH is not overridden by contacts on another Job", () => {
    const result = narrowJobMatchCandidates({
      priorStatus: "MATCH",
      priorSelectedJobId: "job-sm-2",
      priorCandidateJobIds: ["job-sm-2"],
      priorEvidence: [
        { type: "SUBJECT_JOB_NAME", value: "St Michael Apartments Building 2", confidence: 0.97 },
      ],
      laterJobIds: ["job-sm-1", "job-sm-2"],
      laterMarker: "CONTACT",
      laterStrength: "WEAK",
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.narrowed).toBe(false);
  });

  it("contact intersection of one Job within name candidates becomes MATCH", () => {
    const result = narrowJobMatchCandidates({
      priorStatus: "AMBIGUOUS",
      priorSelectedJobId: null,
      priorCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3"],
      priorEvidence: [],
      laterJobIds: ["job-sm-2", "job-other"],
      laterMarker: "CONTACT",
      laterStrength: "WEAK",
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
    expect(result.candidateJobIds).toEqual(["job-sm-2"]);
    expect(result.narrowed).toBe(true);
  });

  it("contact intersection of several Jobs stays AMBIGUOUS with the narrowed set", () => {
    const result = narrowJobMatchCandidates({
      priorStatus: "AMBIGUOUS",
      priorSelectedJobId: null,
      priorCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3"],
      priorEvidence: [],
      laterJobIds: ["job-sm-1", "job-sm-2"],
      laterMarker: "CONTACT",
      laterStrength: "WEAK",
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.candidateJobIds.sort()).toEqual(["job-sm-1", "job-sm-2"]);
  });

  it("absent or disjoint weak contacts keep the name candidate set", () => {
    const absent = narrowJobMatchCandidates({
      priorStatus: "AMBIGUOUS",
      priorSelectedJobId: null,
      priorCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3"],
      priorEvidence: [],
      laterJobIds: [],
      laterMarker: "CONTACT",
      laterStrength: "ABSENT",
    });
    expect(absent.status).toBe("AMBIGUOUS");
    expect(absent.candidateJobIds).toEqual(["job-sm-1", "job-sm-2", "job-sm-3"]);

    const disjoint = narrowJobMatchCandidates({
      priorStatus: "AMBIGUOUS",
      priorSelectedJobId: null,
      priorCandidateJobIds: ["job-sm-1", "job-sm-2"],
      priorEvidence: [],
      laterJobIds: ["job-other"],
      laterMarker: "CONTACT",
      laterStrength: "WEAK",
    });
    expect(disjoint.status).toBe("AMBIGUOUS");
    expect(disjoint.candidateJobIds).toEqual(["job-sm-1", "job-sm-2"]);
    expect(disjoint.conflict).toBe(false);
  });

  it("strong disjoint thread evidence is CONFLICT, not a silent override", () => {
    const result = narrowJobMatchCandidates({
      priorStatus: "AMBIGUOUS",
      priorSelectedJobId: null,
      priorCandidateJobIds: ["job-2192"],
      priorEvidence: [
        { type: "SUBJECT_JOB_NAME", value: "St Michael Apartments Building 2", confidence: 0.97 },
      ],
      laterJobIds: ["job-2240"],
      laterMarker: "THREAD",
      laterStrength: "STRONG",
    });
    expect(result.status).toBe("CONFLICT");
    expect(result.selectedJobId).toBeNull();
    expect(result.candidateJobIds.sort()).toEqual(["job-2192", "job-2240"]);
    expect(result.conflict).toBe(true);
  });

  it("when Marker 1 has no candidates, later evidence may search all eligible Jobs", () => {
    const result = narrowJobMatchCandidates({
      priorStatus: "NO_MATCH",
      priorSelectedJobId: null,
      priorCandidateJobIds: [],
      priorEvidence: [],
      laterJobIds: ["job-sm-2"],
      laterMarker: "CONTACT",
      laterStrength: "WEAK",
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-sm-2");
  });
});

describe("JobMatcherService uses Marker 1 pipeline", () => {
  const loader: JobMatchDataLoader = {
    loadActiveJobs: async () => pool,
    loadJobAliases: async () => [],
    loadSenderCustomerJobIds: async () => new Set(),
    loadThreadJobHint: async () => null,
    loadActiveExactContactJobs: async () => [],
    loadAuthoritativeThreadJobs: async () => [],
  };

  it("matches a unique Job name", async () => {
    const service = new JobMatcherService(loader, null);
    const result = await service.match({
      workspaceId: "ws-1",
      subject: "RE: Alleghany Apartments RFI",
      cleanBody: "Please review",
    });
    expect(result.selectedJobId).toBe("job-2191");
    expect(result.matcherVersion).toBe(JOB_MATCH_PIPELINE_VERSION);
  });

  it("does not pick a Job on Beltline prefix ambiguity", async () => {
    const service = new JobMatcherService(loader, null);
    const result = await service.match({
      workspaceId: "ws-1",
      subject: "Beltline RFI",
      cleanBody: "",
    });
    expect(result.selectedJobId).toBeNull();
    expect(result.ambiguousCandidateIds.sort()).toEqual(["job-2192", "job-2193"]);
    expect(result.candidateJobIds?.sort()).toEqual(["job-2192", "job-2193"]);
  });

  it("unique MATCH does not call contact or thread loaders", async () => {
    const loadActiveExactContactJobs = vi.fn(async () => []);
    const loadAuthoritativeThreadJobs = vi.fn(async () => []);
    const service = new JobMatcherService(
      {
        loadActiveJobs: async () => pool,
        loadJobAliases: async () => [],
        loadSenderCustomerJobIds: async () => new Set(),
        loadThreadJobHint: async () => null,
        loadActiveExactContactJobs,
        loadAuthoritativeThreadJobs,
      },
      null
    );
    const result = await service.match({
      workspaceId: "ws-1",
      subject: "Alleghany Apartments RFI",
      cleanBody: "",
      senderEmail: "connor@gc.com",
      threadId: "thread-1",
    });
    expect(result.selectedJobId).toBe("job-2191");
    expect(loadActiveExactContactJobs).not.toHaveBeenCalled();
    expect(loadAuthoritativeThreadJobs).not.toHaveBeenCalled();
  });
});

describe("job match evaluation harness", () => {
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

  it("measures unique MATCH, ambiguous sets, narrowing, and conflicts", () => {
    const report = evaluateJobMatchCases([
      {
        id: "unique-building-2",
        subject: "St Michael Apartments Building 2 stair revisions",
        jobs: [sm1, sm2, sm3],
        expectedDecision: "MATCH",
        expectedJobId: "job-sm-2",
      },
      {
        id: "shared-campus",
        subject: "St Michael Apartments stair revisions",
        jobs: [sm1, sm2, sm3],
        expectedDecision: "AMBIGUOUS",
        expectedCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3"],
      },
      {
        id: "contacts-narrow-to-two",
        subject: "St Michael Apartments stair revisions",
        jobs: [sm1, sm2, sm3],
        contactJobIds: ["job-sm-1", "job-sm-2"],
        expectedDecision: "AMBIGUOUS",
        expectedCandidateJobIds: ["job-sm-1", "job-sm-2"],
      },
      {
        id: "thread-resolves",
        subject: "St Michael Apartments stair revisions",
        jobs: [sm1, sm2, sm3],
        contactJobIds: ["job-sm-1", "job-sm-2"],
        threadJobIds: ["job-sm-2"],
        expectedDecision: "MATCH",
        expectedJobId: "job-sm-2",
        expectedCandidateJobIds: ["job-sm-2"],
      },
      {
        id: "unique-match-stops-before-thread",
        subject: "St Michael Apartments Building 2 stair revisions",
        jobs: [sm1, sm2, sm3],
        threadJobIds: ["job-2240"],
        expectedDecision: "MATCH",
        expectedJobId: "job-sm-2",
      },
      {
        id: "thread-conflicts-with-name-set",
        subject: "St Michael Apartments stair revisions",
        jobs: [
          sm1,
          sm2,
          sm3,
          {
            id: "job-2240",
            jobNumber: "2240",
            name: "Riverside Tower",
            normalizedName: "riverside tower",
            customerId: null,
            externalRef: null,
            status: "ACTIVE",
          },
        ],
        threadJobIds: ["job-2240"],
        expectedDecision: "CONFLICT",
        expectedCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3", "job-2240"],
      },
    ]);

    expect(report.total).toBe(6);
    expect(report.correct).toBe(6);
    expect(report.marker1UniqueStrongMatches).toBe(2);
    expect(report.marker1AmbiguousSets).toBe(4);
    expect(report.narrowedByMarker2).toBe(2);
    expect(report.narrowedByMarker3).toBe(1);
    expect(report.signalConflicts).toBe(1);
    expect(report.incorrectNarrowing).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.avgMarker1CandidateCount).toBeGreaterThan(1);
  });

  it("records Marker 1 → 2 → 3 candidate sets on a representative failure", () => {
    const report = evaluateJobMatchCases([
      {
        id: "wrong-expected",
        subject: "St Michael Apartments stair revisions",
        jobs: [sm1, sm2, sm3],
        contactJobIds: ["job-sm-1", "job-sm-2"],
        threadJobIds: ["job-sm-2"],
        expectedDecision: "AMBIGUOUS",
        expectedCandidateJobIds: ["job-sm-1", "job-sm-2", "job-sm-3"],
      },
    ]);
    expect(report.correct).toBe(0);
    expect(report.failures[0]).toMatchObject({
      id: "wrong-expected",
      marker1Candidates: expect.arrayContaining(["job-sm-1", "job-sm-2", "job-sm-3"]),
      afterMarker2: expect.arrayContaining(["job-sm-1", "job-sm-2"]),
      afterMarker3: ["job-sm-2"],
      finalDecision: "MATCH",
    });
  });
});

describe("internal Job.jobNumber is never matching evidence", () => {
  const stMichael: JobRecordForMatch = {
    id: "job-2417",
    jobNumber: "2417",
    name: "St Michael Apartments Building 2",
    normalizedName: "st michael apartments building 2",
    customerId: null,
    externalRef: null,
    status: "ACTIVE",
  };
  const riverside: JobRecordForMatch = {
    id: "job-2418",
    jobNumber: "2418",
    name: "Riverside Medical Center",
    normalizedName: "riverside medical center",
    customerId: null,
    externalRef: "GC-8801",
    status: "ACTIVE",
  };
  const numberedJobs = [stMichael, riverside];

  it("1. Job.jobNumber exact text alone does not match", () => {
    const result = runJobNameMarker({
      subject: "2417",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).toBeNull();
  });

  it("2. #<jobNumber> does not match", () => {
    const result = runJobNameMarker({
      subject: "#2417 revised stair detail",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
  });

  it("3. Job <jobNumber> does not match", () => {
    const result = runJobNameMarker({
      subject: "Job 2417 drawings",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
  });

  it("4. Job #<jobNumber> does not match", () => {
    const result = runJobNameMarker({
      subject: "Job #2417 drawings",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
  });

  it("5. Job number in subject does not match", () => {
    const result = runJobNameMarker({
      subject: "RFI 2417 - revised stair detail",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.selectedJobId).not.toBe("job-2417");
  });

  it("6. Job number in body does not match", () => {
    const result = runJobNameMarker({
      subject: "Updated drawings",
      cleanBody: "Please review job 2417 and send comments.",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
  });

  it("7. unrelated RFI number equal to Job.jobNumber does not match", () => {
    const result = runJobMatchPipeline({
      subject: "RFI 2417 - Riverside steel revisions",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.selectedJobId).toBe("job-2418");
    expect(result.decision).toBe("MATCH");
    expect(result.evidence.some((e) => e.type.includes("JOB_NUMBER"))).toBe(false);
  });

  it("8. unrelated PO number equal to Job.jobNumber does not match", () => {
    const result = runJobNameMarker({
      subject: "PO 2417 for millwork",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
  });

  it("9. arbitrary numeric text equal to Job.jobNumber does not match", () => {
    const result = runJobNameMarker({
      subject: "Sheet 2417 / spec 2417 / invoice 2417",
      cleanBody: "Address 2417 Main St",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("NO_MATCH");
  });

  it("10. externalRef exact match can still produce identity evidence", () => {
    const result = runJobNameMarker({
      subject: "GC-8801 steel package",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2418");
    expect(result.evidence.some((e) => e.type === "SUBJECT_JOB_EXTERNAL_REF")).toBe(
      true
    );
  });

  it("11. explicit project alias containing a meaningful number still works", () => {
    const result = runJobNameMarker({
      subject: "St Michael Building 2 RFI",
      cleanBody: "",
      jobs: numberedJobs,
      aliases: [
        {
          jobId: "job-2417",
          alias: "St Michael Building 2",
          normalizedAlias: "st michael building 2",
        },
      ],
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2417");
  });

  it("12. Building 1 vs Building 2 remains distinguishable", () => {
    const b1: JobRecordForMatch = {
      ...stMichael,
      id: "job-b1",
      jobNumber: "1001",
      name: "St Michael Apartments Building 1",
      normalizedName: "st michael apartments building 1",
    };
    const unique = runJobNameMarker({
      subject: "St Michael Apartments Building 2 stair RFI",
      cleanBody: "",
      jobs: [b1, stMichael],
    });
    expect(unique.status).toBe("MATCH");
    expect(unique.selectedJobId).toBe("job-2417");
  });

  it("13. Phase 1 vs Phase 2 remains distinguishable", () => {
    const p1: JobRecordForMatch = {
      id: "job-p1",
      jobNumber: "5001",
      name: "Harbor Phase 1",
      normalizedName: "harbor phase 1",
      customerId: null,
      externalRef: null,
      status: "ACTIVE",
    };
    const p2: JobRecordForMatch = {
      id: "job-p2",
      jobNumber: "5002",
      name: "Harbor Phase 2",
      normalizedName: "harbor phase 2",
      customerId: null,
      externalRef: null,
      status: "ACTIVE",
    };
    const unique = runJobNameMarker({
      subject: "Harbor Phase 2 roof RFI",
      cleanBody: "",
      jobs: [p1, p2],
    });
    expect(unique.status).toBe("MATCH");
    expect(unique.selectedJobId).toBe("job-p2");
  });

  it("14. Job.name containing a legitimate number still works as a NAME", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apartments Building 2 stair revisions",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("MATCH");
    expect(result.selectedJobId).toBe("job-2417");
  });

  it("15. internal Job number is not silently generated as an alias", () => {
    const result = runJobNameMarker({
      subject: "2417",
      cleanBody: "",
      jobs: numberedJobs,
      aliases: [],
    });
    expect(result.status).toBe("NO_MATCH");
    expect(result.evidence).toEqual([]);
    const src = readFileSync(resolve(here, "../jobs/job-name-marker.ts"), "utf8");
    expect(src).not.toMatch(/source:\s*"JOB_NUMBER"/);
    expect(src).not.toMatch(/jobNumberHits/);
  });

  it("16. legacy JOB_NUMBER_MATCH historical provenance remains readable", () => {
    const historical: JobMatchAssignmentSource = "JOB_NUMBER_MATCH";
    expect(historical).toBe("JOB_NUMBER_MATCH");
  });

  it("17. new matcher never emits JOB_NUMBER_MATCH", () => {
    const nameMatch = runJobMatchPipeline({
      subject: "Riverside Medical Center RFI",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(nameMatch.selectedJobId).toBe("job-2418");
    expect(nameMatch.assignmentSource).toBe("AI_AUTO_ASSIGNED");
    expect(nameMatch.assignmentSource).not.toBe("JOB_NUMBER_MATCH");

    const numberOnly = runJobMatchPipeline({
      subject: "Job #2417",
      cleanBody: "PO 2418",
      jobs: numberedJobs,
    });
    expect(numberOnly.assignmentSource).not.toBe("JOB_NUMBER_MATCH");
  });

  it("name vs disjoint externalRef remains AMBIGUOUS", () => {
    const result = runJobNameMarker({
      subject: "St Michael Apartments Building 2 GC-8801",
      cleanBody: "",
      jobs: numberedJobs,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.selectedJobId).toBeNull();
    expect(result.candidateJobIds.sort()).toEqual(["job-2417", "job-2418"]);
  });

  it("19. evaluation harness does not treat internal Job number as identity", () => {
    const report = evaluateJobMatchCases([
      {
        id: "number-is-not-identity",
        subject: "RFI 2417 - revised stair detail",
        jobs: numberedJobs,
        expectedDecision: "NO_MATCH",
      },
      {
        id: "riverside-name-wins-over-st-michael-number",
        subject: "RFI 2417 - Riverside steel revisions",
        jobs: numberedJobs,
        expectedDecision: "MATCH",
        expectedJobId: "job-2418",
      },
    ]);
    expect(report.correct).toBe(2);
    expect(report.failures).toEqual([]);
  });

  it("20. auto-assignment remains OFF", () => {
    expect(isJobMatcherAutoAssignEnabled()).toBe(false);
    expect(JOB_NAME_MARKER_VERSION).toBe("job-name-marker-v3");
  });
});

