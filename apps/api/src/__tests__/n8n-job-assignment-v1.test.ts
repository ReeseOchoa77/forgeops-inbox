import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobMatchResult } from "@forgeops/shared";
import {
  buildJobMatchPersistence,
  persistJobMatchResult,
} from "../application/services/persist-job-match.js";

const here = dirname(fileURLToPath(import.meta.url));
const n8nRoute = readFileSync(
  join(here, "../interfaces/http/routes/n8n-ingest.route.ts"),
  "utf8"
);

const candidateMatch: JobMatchResult = {
  selectedJobId: "job-from-n8n-hint",
  confidence: 0.98,
  evidence: [{ type: "SUBJECT_JOB_NUMBER", value: "2148", confidence: 1 }],
  ambiguousCandidateIds: [],
  requiresReview: false,
  assignmentSource: "JOB_NUMBER_MATCH",
  candidateCount: 1,
  matcherVersion: "job-matcher-v1",
};

describe("n8n ingest V1 job assignment freeze", () => {
  const prev = process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    else process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = prev;
  });

  it("E: n8n selectedJobId is not authoritative; JobMatcher persist is gated", () => {
    expect(n8nRoute).toContain("persistJobMatchResult");
    expect(n8nRoute).toContain("n8nSelectedJobIdHint");
    expect(n8nRoute).toMatch(/Job fields set by JobMatcherService/);
    expect(n8nRoute).toMatch(/jobId:\s*null/);
  });

  it("E: Job candidate from n8n/matcher does not persist jobId when flag off", async () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    expect(buildJobMatchPersistence(candidateMatch, null)).toBeNull();

    const emailUpdate = vi.fn();
    const result = await persistJobMatchResult(
      {
        classification: { update: vi.fn() },
        emailMessage: { update: emailUpdate },
        task: { updateMany: vi.fn() },
      },
      {
        workspaceId: "ws",
        classificationId: "cls",
        emailMessageId: "msg",
        match: candidateMatch,
        existing: { jobId: null, jobAssignmentIsManual: false, jobAssignmentSource: null },
      }
    );
    expect(result.applied).toBe(false);
    expect(result.jobId).toBeNull();
    expect(emailUpdate).not.toHaveBeenCalled();
  });
});
