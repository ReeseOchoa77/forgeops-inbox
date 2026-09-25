import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clearedFolderMatchData,
  foldersMatchedToJobWhere,
  orphanedFolderMatchWhere,
  shouldPreserveFolderMatch,
} from "../application/services/release-folder-job-match.js";

describe("release folder matches when a job is deleted", () => {
  it("returns a verified folder to unmatched and clears the approval", () => {
    expect(clearedFolderMatchData).toEqual({
      matchedJobId: null,
      status: "DISCOVERED",
      matchConfidence: null,
      matchReason: null,
      approvedAt: null,
      approvedByUserId: null,
    });
  });

  it("only keeps a verified or suggested match while the job id is present", () => {
    expect(shouldPreserveFolderMatch("APPROVED", "job-1")).toBe(true);
    expect(shouldPreserveFolderMatch("MATCHED", "job-1")).toBe(true);
    expect(shouldPreserveFolderMatch("APPROVED", null)).toBe(false);
    expect(shouldPreserveFolderMatch("MATCHED", null)).toBe(false);
    expect(shouldPreserveFolderMatch("IGNORED", null)).toBe(true);
    expect(shouldPreserveFolderMatch("DISCOVERED", null)).toBe(false);
  });

  it("scopes the delete cleanup to this workspace and job", () => {
    expect(foldersMatchedToJobWhere("ws-1", "job-1")).toMatchObject({
      workspaceId: "ws-1",
      matchedJobId: "job-1",
    });
    expect(orphanedFolderMatchWhere("ws-1")).toEqual({
      workspaceId: "ws-1",
      matchedJobId: null,
      status: { in: ["APPROVED", "MATCHED"] },
    });
  });

  it("clears matches on job delete and repairs already-orphaned folders when the list loads", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const deleteRoute = readFileSync(
      resolve(here, "../interfaces/http/routes/reference-data.route.ts"),
      "utf8",
    );
    expect(deleteRoute).toContain("releaseFoldersForDeletedJob(tx, params.workspaceId, params.jobId)");
    expect(deleteRoute).not.toContain("data: { matchedJobId: null }");

    const listRoute = readFileSync(
      resolve(here, "../interfaces/http/routes/folder-discovery.route.ts"),
      "utf8",
    );
    expect(listRoute).toContain("releaseOrphanedFolderMatches(app.services.prisma, workspaceId)");
  });
});
