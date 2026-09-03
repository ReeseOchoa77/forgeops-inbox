import { describe, expect, it } from "vitest";
import {
  detectJobInfo,
  folderStatusToMatchUi,
  isVerifiedProjectFolder,
  matchFolderToExistingJobs,
} from "../project-folders/match-folder-to-job.js";

describe("folder match status mapping", () => {
  it("maps DB statuses to UNMATCHED / SUGGESTED / VERIFIED", () => {
    expect(folderStatusToMatchUi("DISCOVERED")).toBe("UNMATCHED");
    expect(folderStatusToMatchUi("MATCHED")).toBe("SUGGESTED");
    expect(folderStatusToMatchUi("APPROVED")).toBe("VERIFIED");
    expect(isVerifiedProjectFolder("APPROVED")).toBe(true);
    expect(isVerifiedProjectFolder("MATCHED")).toBe(false);
  });
});

describe("detectJobInfo", () => {
  it("parses job number + name patterns", () => {
    expect(detectJobInfo("2209 BSC BLDG 3 Patio Rail")).toEqual({
      jobNumber: "2209",
      jobName: "BSC BLDG 3 Patio Rail",
    });
    expect(detectJobInfo("2209 - BSC BLDG. 3 Patio Rail")).toEqual({
      jobNumber: "2209",
      jobName: "BSC BLDG. 3 Patio Rail",
    });
    expect(detectJobInfo("Old Project XYZ").jobNumber).toBeNull();
  });
});

describe("matchFolderToExistingJobs", () => {
  const jobs = [
    {
      id: "j2209",
      jobNumber: "2209",
      name: "BSC BLDG. 3 Patio Rail",
      normalizedName: "bsc bldg 3 patio rail",
    },
    {
      id: "j2184",
      jobNumber: "2184",
      name: "ABC Warehouse",
      normalizedName: "abc warehouse",
    },
    {
      id: "jDup",
      jobNumber: null,
      name: "BSC BLDG 3",
      normalizedName: "bsc bldg 3",
    },
    {
      id: "jDup2",
      jobNumber: null,
      name: "BSC BLDG 3 Patio",
      normalizedName: "bsc bldg 3",
    },
  ];

  it("auto-verifies unique exact job number match", () => {
    const r = matchFolderToExistingJobs({
      folderName: "2209 BSC BLDG 3 Patio Rail",
      jobs,
    });
    expect(r).toMatchObject({
      matchedJobId: "j2209",
      status: "APPROVED",
      reason: "exact_job_number",
      confidence: 1,
    });
  });

  it("suggests unique exact job name without auto-verify", () => {
    const r = matchFolderToExistingJobs({
      folderName: "ABC Warehouse",
      jobs,
    });
    expect(r).toMatchObject({
      matchedJobId: "j2184",
      status: "MATCHED",
      reason: "exact_job_name",
    });
  });

  it("does not auto-verify ambiguous short names", () => {
    const r = matchFolderToExistingJobs({
      folderName: "BSC BLDG 3",
      jobs,
    });
    expect(r.matchedJobId).toBeNull();
    expect(r.status).toBe("DISCOVERED");
    expect(r.reason).toBe("ambiguous_job_name");
  });

  it("leaves unmatched folders unmatched", () => {
    const r = matchFolderToExistingJobs({
      folderName: "Old Project XYZ",
      jobs,
    });
    expect(r).toMatchObject({
      matchedJobId: null,
      status: "DISCOVERED",
      reason: null,
    });
  });

  it("uses non-OUTLOOK_FOLDER aliases for suggestion", () => {
    const r = matchFolderToExistingJobs({
      folderName: "Patio Rail Alias",
      jobs,
      aliases: [
        {
          jobId: "j2209",
          normalizedAlias: "patio rail alias",
          source: "IMPORT",
        },
      ],
    });
    expect(r).toMatchObject({
      matchedJobId: "j2209",
      status: "MATCHED",
      reason: "alias",
    });
  });

  it("ignores OUTLOOK_FOLDER aliases to avoid circular matching", () => {
    const r = matchFolderToExistingJobs({
      folderName: "Patio Rail Alias",
      jobs,
      aliases: [
        {
          jobId: "j2209",
          normalizedAlias: "patio rail alias",
          source: "OUTLOOK_FOLDER",
        },
      ],
    });
    expect(r.matchedJobId).toBeNull();
  });
});
