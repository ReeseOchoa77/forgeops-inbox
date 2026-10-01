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
    const deleteService = readFileSync(
      resolve(here, "../application/services/delete-workspace-job.ts"),
      "utf8",
    );
    expect(deleteService).toContain("releaseFoldersForDeletedJob(tx, workspaceId, jobId)");
    expect(deleteService).toContain("emailMessage.updateMany");

    const referenceRoute = readFileSync(
      resolve(here, "../interfaces/http/routes/reference-data.route.ts"),
      "utf8",
    );
    expect(referenceRoute).toContain("deleteWorkspaceJob");
    expect(referenceRoute).toContain('auth.role !== "OWNER"');

    const jobsRoute = readFileSync(
      resolve(here, "../interfaces/http/routes/jobs.route.ts"),
      "utf8",
    );
    expect(jobsRoute).toContain("deleteWorkspaceJob");
    expect(jobsRoute).toContain('app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId"');

    const listRoute = readFileSync(
      resolve(here, "../interfaces/http/routes/folder-discovery.route.ts"),
      "utf8",
    );
    expect(listRoute).toContain("releaseOrphanedFolderMatches(app.services.prisma, workspaceId)");

    const hereService = readFileSync(
      resolve(here, "../application/services/release-folder-job-match.ts"),
      "utf8",
    );
    expect(hereService).toContain("NOT EXISTS");
    expect(hereService).toContain('FROM "Job" j');
    expect(hereService).toContain('f."matchedJobId" IS NOT NULL');
  });
});
