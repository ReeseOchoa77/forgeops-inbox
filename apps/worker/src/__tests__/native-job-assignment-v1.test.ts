import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  isAuthoritativeEmailJobAssignment,
  isJobMatcherAutoAssignEnabled,
} from "@forgeops/shared";
import type { JobMatchResult } from "@forgeops/shared";
import { buildJobMatchPersistence } from "../application/services/persist-job-match.js";

const here = dirname(fileURLToPath(import.meta.url));
const persistNative = readFileSync(
  join(here, "../application/services/persist-native-classification.ts"),
  "utf8"
);
const classifyNative = readFileSync(
  join(here, "../application/services/classify-email-message-native.ts"),
  "utf8"
);

const strongMatch: JobMatchResult = {
  selectedJobId: "job-2148",
  confidence: 0.99,
  evidence: [{ type: "SUBJECT_JOB_NUMBER", value: "2148", confidence: 1 }],
  ambiguousCandidateIds: [],
  requiresReview: false,
  assignmentSource: "JOB_NUMBER_MATCH",
  candidateCount: 1,
  matcherVersion: "job-matcher-v1",
};

describe("native classification V1 job assignment freeze", () => {
  const prev = process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    else process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = prev;
  });

  it("D: classifier still persists category fields; jobId only via gated matcher", () => {
    expect(persistNative).toContain("mailboxCategory");
    expect(persistNative).toContain("businessTypeKey");
    expect(persistNative).toContain("persistJobMatchResult");
    expect(persistNative).toMatch(/jobId:\s*null/);
    expect(persistNative).toContain("matcherWouldPersist");
    expect(persistNative).toContain("isJobMatcherAutoAssignEnabled");
  });

  it("D/F: high-confidence matcher candidate does not persist when flag off", () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    expect(isJobMatcherAutoAssignEnabled()).toBe(false);
    expect(
      buildJobMatchPersistence(strongMatch, {
        jobId: null,
        jobAssignmentIsManual: false,
        jobAssignmentSource: null,
      })
    ).toBeNull();
  });

  it("G: USER_ASSIGNED remains authoritative confirmed association", () => {
    expect(classifyNative).toContain("isAuthoritativeEmailJobAssignment");
    expect(
      isAuthoritativeEmailJobAssignment({
        jobAssignmentIsManual: true,
        jobAssignmentSource: "USER_ASSIGNED",
      })
    ).toBe(true);
  });

  it("H: VERIFIED_PROJECT_FOLDER remains authoritative confirmed association", () => {
    expect(
      isAuthoritativeEmailJobAssignment({
        jobAssignmentIsManual: false,
        jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
      })
    ).toBe(true);
  });

  it("probabilistic matcher cannot become confirmed BUSINESS evidence when frozen", () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    // Escape-hatch gate must wrap job_matcher → BUSINESS override
    expect(persistNative).toContain("matcherWouldPersist");
    expect(persistNative).toContain("buildJobMatchPersistence");
  });
});
