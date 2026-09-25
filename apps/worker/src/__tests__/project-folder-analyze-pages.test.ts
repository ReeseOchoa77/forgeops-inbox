import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlookMessageSnapshot } from "../infrastructure/providers/outlook/outlook-client.js";
import {
  failOpenProjectFolderEmailAnalyzeRun,
  processProjectFolderEmailAnalyze,
} from "../application/processors/project-folder-email-analyze.processor.js";

vi.mock("../application/services/enqueue-attachment-ingest-from-sync.js", () => ({
  enqueueAttachmentIngestFromSync: vi.fn(async () => ({ enqueuedCount: 1, failedCount: 0 })),
}));

vi.mock("../application/services/import-provider-mailbox.js", () => ({
  importProviderMailbox: vi.fn(async (input: {
    mailbox: { threads: Array<{ messages: Array<{ providerMessageId: string }> }> };
  }) => {
    const ids = input.mailbox.threads.flatMap((thread) =>
      thread.messages.map((message) => message.providerMessageId)
    );
    return {
      createdMessageIds: ids,
      updatedMessageIds: [],
      duplicateMessageIds: [],
      attachmentIngestCandidates: ids.map((id) => ({
        emailMessageId: id,
        providerMessageId: id,
      })),
    };
  }),
}));

function message(id: string): OutlookMessageSnapshot {
  return {
    outlookMessageId: id,
    conversationId: `thread-${id}`,
    internetMessageId: null,
    subject: "Subject",
    senderName: "Sender",
    senderEmail: "sender@example.com",
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    replyToAddresses: [],
    snippet: null,
    bodyText: "body",
    bodyHtml: null,
    hasAttachments: false,
    attachmentMetadata: [],
    folderLabels: [],
    sentAt: new Date("2026-09-24T00:00:00.000Z"),
    receivedAt: new Date("2026-09-24T00:00:00.000Z"),
    isRead: true,
    importance: null,
  };
}

function pagesOf(total: number, pageSize: number) {
  const calls: Array<string | null> = [];
  const list = async (input: { pageCursor: string | null; pageSize: number }) => {
    calls.push(input.pageCursor);
    const page = input.pageCursor ? Number(input.pageCursor) : 0;
    const start = page * pageSize;
    const items = Array.from({ length: Math.min(pageSize, Math.max(0, total - start)) }, (_, index) =>
      message(`m-${start + index}`)
    );
    const next = start + items.length < total ? String(page + 1) : null;
    return { items, nextPageCursor: next, refreshedRefreshToken: null };
  };
  return { calls, list };
}

function harness(list: ReturnType<typeof pagesOf>["list"], failMessageId?: string) {
  const updates: Array<Record<string, unknown>> = [];
  const classifyAdds: string[] = [];
  const prisma = {
    projectFolderEmailAnalyzeRun: {
      findFirst: async () => ({
        id: "run-1",
        folderIds: ["folder-1"],
        workspaceId: "ws",
        inboxConnectionId: "cx",
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return data;
      },
      updateMany: async () => ({ count: 1 }),
    },
    inboxConnection: {
      findFirst: async () => ({
        id: "cx",
        provider: "OUTLOOK",
        email: "ops@example.com",
        encryptedRefreshToken: "enc",
        status: "ACTIVE",
      }),
    },
    discoveredFolder: {
      findFirst: async () => ({
        id: "folder-1",
        providerFolderId: "graph-folder",
        rawFolderName: "Nova Academy",
        matchedJobId: "job-1",
        inboxConnectionId: "cx",
        matchedJob: { id: "job-1", workspaceId: "ws", name: "Nova", jobNumber: "1" },
      }),
    },
    emailMessage: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (failMessageId && where.id === failMessageId) {
          throw new Error("message read failed");
        }
        return {
          id: where.id,
          jobId: null,
          jobAssignmentIsManual: false,
          jobAssignmentSource: null,
          classifications: [],
        };
      },
      update: async () => ({}),
    },
    classification: { updateMany: async () => ({ count: 0 }) },
  };
  const deps = {
    prisma: prisma as never,
    tokenCipher: { decrypt: () => "refresh" } as never,
    outlookConfig: { clientId: "id", clientSecret: "secret" },
    classifyQueue: {
      getJob: async () => null,
      add: async (_name: string, data: { emailMessageId: string }) => {
        classifyAdds.push(data.emailMessageId);
        return {};
      },
    } as never,
    attachmentIngestQueue: {} as never,
    listFolderMessages: list,
    finalAttempt: true,
  };
  return { deps, updates, classifyAdds };
}

function lastProgress(updates: Array<Record<string, unknown>>) {
  const withProgress = updates.filter((row) => row.progress && typeof row.progress === "object");
  return withProgress[withProgress.length - 1]?.progress as {
    processed: number;
    foldersDone: number;
    foldersTotal: number;
    classifyQueued: number;
  };
}

describe("project folder analysis pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes a folder smaller than one page", async () => {
    const { list } = pagesOf(40, 50);
    const { deps, updates } = harness(list);
    const result = await processProjectFolderEmailAnalyze(
      { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
      deps
    );
    expect(result.status).toBe("COMPLETED");
    expect(lastProgress(updates)).toMatchObject({ processed: 40, foldersDone: 1, foldersTotal: 1 });
  });

  it("completes a folder that ends exactly on a 50-message page", async () => {
    const { calls, list } = pagesOf(50, 50);
    const { deps, updates } = harness(list);
    await processProjectFolderEmailAnalyze(
      { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
      deps
    );
    expect(calls).toEqual([null]);
    expect(lastProgress(updates)).toMatchObject({ processed: 50, foldersDone: 1 });
  });

  it("walks four pages of 50 and then marks the folder complete", async () => {
    const { calls, list } = pagesOf(200, 50);
    const { deps, updates, classifyAdds } = harness(list);
    await processProjectFolderEmailAnalyze(
      { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
      deps
    );
    expect(calls).toEqual([null, "1", "2", "3"]);
    expect(lastProgress(updates)).toMatchObject({
      processed: 200,
      foldersDone: 1,
      classifyQueued: 200,
    });
    expect(classifyAdds).toHaveLength(200);
  });

  it("requests a fifth page when the folder has more than 200 messages", async () => {
    const { calls, list } = pagesOf(201, 50);
    const { deps, updates } = harness(list);
    await processProjectFolderEmailAnalyze(
      { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
      deps
    );
    expect(calls).toEqual([null, "1", "2", "3", "4"]);
    expect(lastProgress(updates)).toMatchObject({ processed: 201, foldersDone: 1 });
  });

  it("fails the run when the next page errors and does not increment foldersDone", async () => {
    const { list } = pagesOf(250, 50);
    let seen = 0;
    const { deps, updates } = harness(async (input) => {
      seen += 1;
      if (seen === 5) throw new Error("Outlook Graph request timed out after 4 attempts");
      return list(input);
    });
    await expect(
      processProjectFolderEmailAnalyze(
        { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
        deps
      )
    ).rejects.toThrow(/timed out/);
    const failed = updates.find((row) => row.status === "FAILED");
    expect(failed?.errorMessage).toContain("timed out");
    const progress = failed?.progress as { processed: number; foldersDone: number };
    expect(progress.processed).toBe(200);
    expect(progress.foldersDone).toBe(0);
  });

  it("leaves the run RUNNING when a non-final attempt fails", async () => {
    const { deps, updates } = harness(async () => {
      throw new Error("Outlook Graph request timed out after 4 attempts");
    });
    deps.finalAttempt = false;
    await expect(
      processProjectFolderEmailAnalyze(
        { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
        deps
      )
    ).rejects.toThrow(/timed out/);
    expect(updates.some((row) => row.status === "FAILED")).toBe(false);
    expect(updates.some((row) => row.status === "RUNNING")).toBe(true);
  });

  it("continues the folder when one message fails", async () => {
    const { list } = pagesOf(3, 50);
    const { deps, updates } = harness(list, "m-1");
    const result = await processProjectFolderEmailAnalyze(
      { workspaceId: "ws", inboxConnectionId: "cx", runId: "run-1" },
      deps
    );
    expect(result.status).toBe("COMPLETED");
    const progress = lastProgress(updates) as { failed: number; foldersDone: number; processed: number };
    expect(progress.foldersDone).toBe(1);
    expect(progress.processed).toBe(3);
    expect(progress.failed).toBe(1);
  });
});

describe("failOpenProjectFolderEmailAnalyzeRun", () => {
  it("only closes a run that is still open", async () => {
    const calls: unknown[] = [];
    const prisma = {
      projectFolderEmailAnalyzeRun: {
        updateMany: async (args: unknown) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };
    await failOpenProjectFolderEmailAnalyzeRun(prisma as never, "run-1", "job stalled");
    expect(calls[0]).toMatchObject({
      where: { id: "run-1", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "FAILED", errorMessage: "job stalled" },
    });
  });
});
