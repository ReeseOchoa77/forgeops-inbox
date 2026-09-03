import { describe, expect, it } from "vitest";
import {
  isManualJobAssignment,
  isProtectedJobAssignment,
  resolveVerifiedFolderJobAssignment,
  VERIFIED_PROJECT_FOLDER_SOURCE,
} from "../project-folders/verified-folder-job-assignment.js";
import { isVerifiedProjectFolder } from "../project-folders/match-folder-to-job.js";

describe("verified folder email analyze eligibility", () => {
  it("only APPROVED folders are verified", () => {
    expect(isVerifiedProjectFolder("APPROVED")).toBe(true);
    expect(isVerifiedProjectFolder("MATCHED")).toBe(false);
    expect(isVerifiedProjectFolder("DISCOVERED")).toBe(false);
  });
});

describe("verified folder job assignment conflict policy", () => {
  it("assigns when no existing job", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: null,
        existingIsManual: false,
        existingSource: null,
        folderJobId: "job-x",
      })
    ).toBe("assigned");
  });

  it("overrides AI assignment", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "job-ai",
        existingIsManual: false,
        existingSource: "AI_AUTO_ASSIGNED",
        folderJobId: "job-x",
      })
    ).toBe("assigned");
  });

  it("protects manual USER_ASSIGNED when different job", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "job-manual",
        existingIsManual: true,
        existingSource: "USER_ASSIGNED",
        folderJobId: "job-x",
      })
    ).toBe("conflict");
    expect(
      isManualJobAssignment({
        jobAssignmentIsManual: true,
        jobAssignmentSource: "USER_ASSIGNED",
      })
    ).toBe(true);
  });

  it("unchanged when already on folder job", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "job-x",
        existingIsManual: false,
        existingSource: VERIFIED_PROJECT_FOLDER_SOURCE,
        folderJobId: "job-x",
      })
    ).toBe("unchanged");
  });

  it("protects verified folder provenance from JobMatcher overwrite", () => {
    expect(
      isProtectedJobAssignment({
        jobAssignmentIsManual: false,
        jobAssignmentSource: VERIFIED_PROJECT_FOLDER_SOURCE,
      })
    ).toBe(true);
  });
});
