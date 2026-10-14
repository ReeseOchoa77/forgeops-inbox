/**
 * Job number suggestion + current-only uniqueness (archived reuse).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  suggestNextJobNumberFromList,
  workspaceCurrentJobNumberCollisionWhere,
  workspaceJobNumbersForSuggestionWhere,
} from "@forgeops/shared";

const here = import.meta.dirname;

describe("Job number — archived reuse rule", () => {
  it("A/B/C) suggestion ignores archived gaps", () => {
    // Only current numbers are passed to the pure helper.
    expect(suggestNextJobNumberFromList(["1001", "1002", "1003"])).toBe("1004");
  });

  it("collision predicate is current-only (archivedAt null)", () => {
    expect(
      workspaceCurrentJobNumberCollisionWhere({
        workspaceId: "ws",
        jobNumber: "1004",
      })
    ).toEqual({
      workspaceId: "ws",
      jobNumber: "1004",
      archivedAt: null,
    });
    expect(workspaceJobNumbersForSuggestionWhere("ws").archivedAt).toBeNull();
  });

  it("D/E/G/H) jobs route uses current-only collision + restore guard", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/routes/jobs.route.ts"),
      "utf8"
    );
    expect(src).toContain("workspaceCurrentJobNumberCollisionWhere");
    expect(src).toContain('code: "JOB_NUMBER_TAKEN"');
    expect(src).toContain("Cannot restore: Job number");
    expect(src).toContain("excludeJobId: jobId");
  });

  it("convert + bidding routes use current-only collision", () => {
    const convert = readFileSync(
      join(here, "../application/services/convert-bid-candidate-to-job.ts"),
      "utf8"
    );
    const bidding = readFileSync(
      join(here, "../interfaces/http/routes/bidding.route.ts"),
      "utf8"
    );
    const intake = readFileSync(
      join(here, "../application/services/bidding-intake-suggestions.ts"),
      "utf8"
    );
    expect(convert).toContain("workspaceCurrentJobNumberCollisionWhere");
    expect(bidding).toContain("workspaceCurrentJobNumberCollisionWhere");
    expect(intake).not.toContain("advanceJobNumberPastTaken");
    expect(intake).not.toContain("workspaceJobNumbersTakenWhere");
  });

  it("no DB unique on jobNumber in schema (app-level only)", () => {
    const schema = readFileSync(
      join(here, "../../../../packages/db/prisma/schema.prisma"),
      "utf8"
    );
    const jobBlock = schema.slice(
      schema.indexOf("model Job {"),
      schema.indexOf("model JobParticipant")
    );
    expect(jobBlock).not.toMatch(/@@unique\(\[workspaceId,\s*jobNumber\]\)/);
    expect(jobBlock).toContain("@@index([workspaceId, jobNumber])");
  });
});
