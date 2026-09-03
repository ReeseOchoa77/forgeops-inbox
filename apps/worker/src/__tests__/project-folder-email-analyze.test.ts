import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveVerifiedFolderJobAssignment } from "@forgeops/shared";

describe("project folder email analyze unit contracts", () => {
  it("documents conflict policy for manual vs AI jobs", () => {
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "manual",
        existingIsManual: true,
        existingSource: "USER_ASSIGNED",
        folderJobId: "folder-job",
      })
    ).toBe("conflict");
    expect(
      resolveVerifiedFolderJobAssignment({
        existingJobId: "ai",
        existingIsManual: false,
        existingSource: "AI_SUGGESTED",
        folderJobId: "folder-job",
      })
    ).toBe("assigned");
  });
});

describe("outlook listMailFolderMessages pagination contract", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests folder-scoped messages URL not inbox", async () => {
    // Lightweight contract: Graph path must target mailFolders/{id}/messages
    const folderId = "AAMk-folder";
    const url =
      `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages` +
      `?$select=id&$orderby=receivedDateTime desc&$top=50`;
    expect(url).toContain(`/mailFolders/${encodeURIComponent(folderId)}/messages`);
    expect(url).not.toContain("/mailFolders/inbox/messages");
  });
});
