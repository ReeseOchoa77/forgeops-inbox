import { describe, expect, it } from "vitest";
import {
  addProjectFolderMessageOutcomes,
  displayedProjectFolderAnalyzeProgress,
  emptyProjectFolderEmailAnalyzeProgress,
  resolveVerifiedFolderJobAssignment,
} from "../project-folders/verified-folder-job-assignment.js";

function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
}

describe("project folder email analysis counters", () => {
  it("counts a page of only new messages once", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    const created = ids("new", 100);
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: created,
      updatedMessageIds: [],
      duplicateMessageIds: [],
    });
    expect(progress).toMatchObject({ processed: 100, created: 100, existing: 0 });
  });

  it("counts a page of only existing messages once", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    const existing = ids("old", 100);
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: [],
      updatedMessageIds: existing,
      duplicateMessageIds: existing,
    });
    expect(progress).toMatchObject({ processed: 100, created: 0, existing: 100 });
  });

  it("does not count the same existing email as both updated and duplicate", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    const created = ids("new", 100);
    const existing = ids("old", 100);
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: created,
      updatedMessageIds: existing,
      duplicateMessageIds: existing,
    });
    expect(progress.processed).toBe(200);
    expect(progress.created).toBe(100);
    expect(progress.existing).toBe(100);
    expect(progress.created + progress.existing).toBe(progress.processed);
  });

  it("counts a provider message seen twice in one page as created", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: ["m1"],
      updatedMessageIds: ["m1"],
      duplicateMessageIds: ["m1"],
    });
    expect(progress).toMatchObject({ processed: 1, created: 1, existing: 0 });
  });

  it("adds each Graph page without replaying the previous page", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: ["a"],
      updatedMessageIds: [],
      duplicateMessageIds: [],
    });
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: [],
      updatedMessageIds: ["b"],
      duplicateMessageIds: ["b"],
    });
    expect(progress).toMatchObject({ processed: 2, created: 1, existing: 1 });
  });

  it("collapses a stored run that double-counted existing emails", () => {
    const shown = displayedProjectFolderAnalyzeProgress({
      processed: 300,
      created: 100,
      existing: 100,
    });
    expect(shown.processed).toBe(200);
  });

  it("leaves a coherent stored run unchanged", () => {
    const shown = displayedProjectFolderAnalyzeProgress({
      processed: 200,
      created: 100,
      existing: 100,
    });
    expect(shown.processed).toBe(200);
  });
});

describe("verified folder job assignment outcomes", () => {
  it("treats a user assignment to another job as a conflict", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "other-job",
        existingIsManual: true,
        existingSource: "USER_ASSIGNED",
        folderJobId: "nova",
      })
    ).toBe("conflict");
  });

  it("leaves an email already on the folder job unchanged", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "nova",
        existingIsManual: false,
        existingSource: "VERIFIED_PROJECT_FOLDER",
        folderJobId: "nova",
      })
    ).toBe("unchanged");
  });

  it("assigns when the email has no job", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: null,
        existingIsManual: false,
        existingSource: null,
        folderJobId: "nova",
      })
    ).toBe("assigned");
  });

  it("overrides a weaker AI assignment", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "ai-job",
        existingIsManual: false,
        existingSource: "AI_SUGGESTED",
        folderJobId: "nova",
      })
    ).toBe("assigned");
  });
});

describe("folder progress while a folder is still open", () => {
  it("keeps folders completed at 0 while the current folder has examined mail", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    progress.foldersTotal = 3;
    progress.foldersDone = 0;
    progress.currentFolderName = "Nova Academy";
    addProjectFolderMessageOutcomes(progress, {
      createdMessageIds: ids("new", 100),
      updatedMessageIds: ids("old", 100),
      duplicateMessageIds: ids("old", 100),
    });
    expect(progress.foldersDone).toBe(0);
    expect(progress.foldersTotal).toBe(3);
    expect(progress.currentFolderName).toBe("Nova Academy");
    expect(progress.processed).toBe(200);
  });

  it("counts a folder completed only when the caller marks it done", () => {
    const progress = emptyProjectFolderEmailAnalyzeProgress();
    progress.foldersTotal = 3;
    progress.foldersDone += 1;
    progress.currentFolderName = null;
    expect(progress.foldersDone).toBe(1);
    expect(progress.foldersTotal).toBe(3);
  });
});
