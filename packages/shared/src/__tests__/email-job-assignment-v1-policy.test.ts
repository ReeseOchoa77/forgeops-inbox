import { afterEach, describe, expect, it } from "vitest";
import { isJobMatcherAutoAssignEnabled } from "../ai-automation-gates.js";
import {
  isAuthoritativeEmailJobAssignment,
  isProtectedJobAssignment,
  resolveVerifiedFolderJobAssignment,
  VERIFIED_PROJECT_FOLDER_SOURCE,
} from "../project-folders/verified-folder-job-assignment.js";

/**
 * Email Agent V1 — automatic Email → Job assignment freeze.
 * Documents the policy contract for classification / matcher / folder / manual paths.
 */
describe("Email Agent V1 job assignment policy", () => {
  const prev = process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    else process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = prev;
  });

  it("L/M: feature flag absent or false → auto-assign disabled", () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    expect(isJobMatcherAutoAssignEnabled()).toBe(false);
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "false";
    expect(isJobMatcherAutoAssignEnabled()).toBe(false);
  });

  it("N: feature flag true is intentional admin escape hatch only", () => {
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "true";
    expect(isJobMatcherAutoAssignEnabled()).toBe(true);
  });

  it("G/J: USER_ASSIGNED is protected and authoritative", () => {
    const existing = {
      jobAssignmentIsManual: true,
      jobAssignmentSource: "USER_ASSIGNED",
    };
    expect(isProtectedJobAssignment(existing)).toBe(true);
    expect(isAuthoritativeEmailJobAssignment(existing)).toBe(true);
  });

  it("H/K: VERIFIED_PROJECT_FOLDER is protected and authoritative", () => {
    const existing = {
      jobAssignmentIsManual: false,
      jobAssignmentSource: VERIFIED_PROJECT_FOLDER_SOURCE,
    };
    expect(isProtectedJobAssignment(existing)).toBe(true);
    expect(isAuthoritativeEmailJobAssignment(existing)).toBe(true);
  });

  it("I: verified Project Folder may assign when not conflicting with USER_ASSIGNED", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: null,
        existingIsManual: false,
        existingSource: null,
        folderJobId: "job-2148",
      })
    ).toBe("assigned");
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "job-other",
        existingIsManual: true,
        existingSource: "USER_ASSIGNED",
        folderJobId: "job-2148",
      })
    ).toBe("conflict");
  });

  it("probabilistic sources are never authoritative confirmed Job associations", () => {
    for (const source of ["AI_AUTO_ASSIGNED", "AI_SUGGESTED", "JOB_NUMBER_MATCH"] as const) {
      expect(
        isAuthoritativeEmailJobAssignment({
          jobAssignmentIsManual: false,
          jobAssignmentSource: source,
        })
      ).toBe(false);
    }
  });
});
