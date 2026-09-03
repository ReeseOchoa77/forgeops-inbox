import { describe, expect, it, vi } from "vitest";
import {
  enqueueProjectFolderEmailAnalyze,
  ProjectFolderEmailAnalyzeError,
} from "../application/services/enqueue-project-folder-email-analyze.js";

describe("enqueueProjectFolderEmailAnalyze", () => {
  it("rejects unmatched / suggested folders", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@b.com",
          encryptedRefreshToken: "enc",
        }),
      },
      discoveredFolder: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      projectFolderEmailAnalyzeRun: {
        create: vi.fn(),
      },
    };
    const queue = { add: vi.fn() };

    await expect(
      enqueueProjectFolderEmailAnalyze({
        prisma: prisma as never,
        queue: queue as never,
        workspaceId: "ws1",
        connectionId: "conn1",
        folderIds: ["suggested-folder"],
      })
    ).rejects.toMatchObject({
      code: "NO_VERIFIED_FOLDERS",
    } satisfies Partial<ProjectFolderEmailAnalyzeError>);

    expect(prisma.projectFolderEmailAnalyzeRun.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace / missing connection", async () => {
    const prisma = {
      inboxConnection: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      enqueueProjectFolderEmailAnalyze({
        prisma: prisma as never,
        queue: { add: vi.fn() } as never,
        workspaceId: "ws1",
        connectionId: "other",
      })
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" });
  });

  it("enqueues only VERIFIED folders and creates a run", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          provider: "OUTLOOK",
          email: "a@b.com",
          encryptedRefreshToken: "enc",
        }),
      },
      discoveredFolder: {
        findMany: vi.fn().mockResolvedValue([
          { id: "f1", status: "APPROVED", matchedJobId: "j1" },
        ]),
      },
      projectFolderEmailAnalyzeRun: {
        create: vi.fn().mockResolvedValue({ id: "run1" }),
        update: vi.fn(),
      },
    };
    const queue = { add: vi.fn().mockResolvedValue({}) };

    const result = await enqueueProjectFolderEmailAnalyze({
      prisma: prisma as never,
      queue: queue as never,
      workspaceId: "ws1",
      connectionId: "conn1",
      folderIds: ["f1"],
      initiatedByUserId: "u1",
    });

    expect(result.runId).toBe("run1");
    expect(queue.add).toHaveBeenCalledOnce();
    expect(prisma.projectFolderEmailAnalyzeRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          folderIds: ["f1"],
          status: "PENDING",
        }),
      })
    );
  });
});
