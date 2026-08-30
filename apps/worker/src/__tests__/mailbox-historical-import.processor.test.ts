import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HISTORICAL_IMPORT_PAGE_SIZE,
  HISTORICAL_IMPORT_UNLIMITED,
} from "@forgeops/shared";

const importProviderMailbox = vi.fn();
const enqueueAttachmentIngestFromSync = vi.fn();
const ensureMailboxClassifyJob = vi.fn();

vi.mock("../application/services/import-provider-mailbox.js", () => ({
  importProviderMailbox: (...args: unknown[]) => importProviderMailbox(...args),
}));

vi.mock("../application/services/enqueue-attachment-ingest-from-sync.js", () => ({
  enqueueAttachmentIngestFromSync: (...args: unknown[]) =>
    enqueueAttachmentIngestFromSync(...args),
}));

vi.mock("@forgeops/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@forgeops/shared")>();
  return {
    ...actual,
    ensureMailboxClassifyJob: (...args: unknown[]) =>
      ensureMailboxClassifyJob(...args),
  };
});

import { processMailboxHistoricalImport } from "../application/processors/mailbox-historical-import.processor.js";

function makeMessage(id: string, receivedAt: Date) {
  return {
    providerMessageId: id,
    providerThreadId: `t-${id}`,
    historyId: null,
    subject: `Subject ${id}`,
    senderName: null,
    senderEmail: "a@example.com",
    toAddresses: [],
    ccAddresses: [],
    bccAddresses: [],
    replyToAddresses: [],
    snippet: null,
    bodyText: null,
    bodyHtml: null,
    hasAttachments: false,
    attachmentMetadata: [],
    providerLabels: ["INBOX"],
    sentAt: receivedAt,
    receivedAt,
    sizeEstimate: null,
  };
}

function makeThread(id: string, receivedAt: Date) {
  const message = makeMessage(id, receivedAt);
  return {
    providerThreadId: `t-${id}`,
    historyId: null,
    subject: message.subject,
    normalizedSubject: message.subject,
    snippet: null,
    participants: [{ email: message.senderEmail, name: null, raw: message.senderEmail }],
    firstMessageAt: receivedAt,
    lastMessageAt: receivedAt,
    messageCount: 1,
    unreadCount: 1,
    messages: [message],
  };
}

describe("processMailboxHistoricalImport pagination", () => {
  const since = new Date("2026-01-01T00:00:00.000Z");
  let importUpdates: Array<Record<string, unknown>>;
  let syncCalls: Array<{ maxThreads?: number; pageCursor?: string | null }>;

  beforeEach(() => {
    importUpdates = [];
    syncCalls = [];
    importProviderMailbox.mockReset();
    enqueueAttachmentIngestFromSync.mockReset();
    ensureMailboxClassifyJob.mockReset();

    importProviderMailbox.mockImplementation(
      async (input: {
        mailbox: { threads: Array<{ messages: Array<{ providerMessageId: string }> }> };
        bypassInboxClearedAt?: boolean;
      }) => {
        expect(input.bypassInboxClearedAt).toBe(true);
        const ids = input.mailbox.threads.flatMap((t) =>
          t.messages.map((m) => m.providerMessageId)
        );
        return {
          messagesImported: ids.length,
          duplicatesSkipped: 0,
          createdMessageIds: ids.map((id) => `db-${id}`),
          attachmentIngestCandidates: [],
          skippedClearedCount: 0,
        };
      }
    );
    ensureMailboxClassifyJob.mockResolvedValue({ enqueued: true });
    enqueueAttachmentIngestFromSync.mockResolvedValue({ enqueuedCount: 0 });
  });

  function buildDeps(totalMessages: number) {
    const all = Array.from({ length: totalMessages }, (_, i) =>
      makeThread(`m${i}`, new Date(since.getTime() + i * 60_000))
    );

    const prisma = {
      mailboxHistoricalImport: {
        findUnique: vi.fn(async () => ({
          id: "imp1",
          resumeCursor: null,
          startedAt: null,
          importedCount: 0,
          duplicateCount: 0,
          failedCount: 0,
          processedProviderMessageIds: [],
        })),
        update: vi.fn(async (_args: { data: Record<string, unknown> }) => {
          importUpdates.push(_args.data);
          return {};
        }),
      },
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn1",
          workspaceId: "ws1",
          provider: "OUTLOOK",
          encryptedRefreshToken: "enc-rt",
          encryptedAccessToken: null,
          accessTokenExpiresAt: null,
          excludeJunk: true,
          excludeTrash: true,
          listenIncoming: true,
          listenSent: false,
          ingestionSource: "NATIVE",
          nativeListeningEnabled: false,
          status: "ACTIVE",
        })),
        update: vi.fn(async () => ({})),
      },
      classification: {
        count: vi.fn(async (args: { where?: { messageId?: { in?: string[] } } }) => {
          return args.where?.messageId?.in?.length ?? 0;
        }),
      },
      emailMessage: {
        findMany: vi.fn(async () => []),
      },
    };

    const provider = {
      syncMailbox: vi.fn(async (input: {
        maxThreads?: number;
        pageCursor?: string | null;
        receivedAfter?: Date | null;
      }) => {
        syncCalls.push({
          maxThreads: input.maxThreads,
          pageCursor: input.pageCursor ?? null,
        });
        if (input.receivedAfter) {
          expect(input.receivedAfter.toISOString()).toBe(since.toISOString());
        }
        let start = 0;
        if (input.pageCursor?.startsWith("cursor:")) {
          start = Number(input.pageCursor.slice("cursor:".length));
        }
        const pageSize = input.maxThreads ?? HISTORICAL_IMPORT_PAGE_SIZE;
        const slice = all.slice(start, start + pageSize);
        const nextStart = start + slice.length;
        return {
          threads: slice,
          newestSyncCursor: null,
          nextPageCursor:
            nextStart < all.length ? `cursor:${nextStart}` : null,
          accessToken: null,
          accessTokenExpiresAt: null,
        };
      }),
    };

    const tokenCipher = {
      decrypt: vi.fn((v: string) => `decrypted:${v}`),
    };

    return {
      prisma: prisma as never,
      providerRegistry: {
        getSyncProvider: () => provider,
      } as never,
      tokenCipher: tokenCipher as never,
      analysisQueue: {} as never,
      classifyQueue: { add: vi.fn() } as never,
      attachmentIngestQueue: { add: vi.fn() } as never,
      provider,
    };
  }

  it("since-date follows pageCursor beyond 250 messages", async () => {
    const total = 273;
    const deps = buildDeps(total);

    const result = await processMailboxHistoricalImport(
      {
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
        importId: "imp1",
        requestedLimit: HISTORICAL_IMPORT_UNLIMITED,
        sinceDate: since.toISOString(),
      },
      deps
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.processedCount).toBe(total);
    expect(result.importedCount).toBe(total);
    expect(syncCalls.length).toBe(Math.ceil(total / HISTORICAL_IMPORT_PAGE_SIZE));
    expect(syncCalls[0]?.maxThreads).toBe(HISTORICAL_IMPORT_PAGE_SIZE);
    expect(syncCalls[0]?.pageCursor).toBeNull();
    expect(syncCalls[1]?.pageCursor).toBe("cursor:50");
    expect(syncCalls[syncCalls.length - 1]?.pageCursor).toBe(
      `cursor:${(Math.ceil(total / HISTORICAL_IMPORT_PAGE_SIZE) - 1) * HISTORICAL_IMPORT_PAGE_SIZE}`
    );
    // Last page smaller than page size
    expect(total % HISTORICAL_IMPORT_PAGE_SIZE).toBe(23);
    expect(ensureMailboxClassifyJob).toHaveBeenCalledTimes(total);
    const finalUpdate = importUpdates[importUpdates.length - 1];
    expect(finalUpdate?.status).toBe("COMPLETED");
    expect(finalUpdate?.resumeCursor).toBeNull();
  });

  it("persists resumeCursor between pages and resumes after transient failure", async () => {
    const total = 120;
    const deps = buildDeps(total);
    let calls = 0;
    deps.provider.syncMailbox.mockImplementation(
      async (input: {
        maxThreads?: number;
        pageCursor?: string | null;
        receivedAfter?: Date | null;
      }) => {
        calls += 1;
        syncCalls.push({
          maxThreads: input.maxThreads,
          pageCursor: input.pageCursor ?? null,
        });
        if (calls === 2) {
          throw new Error("Graph 503 temporary");
        }
        const all = Array.from({ length: total }, (_, i) =>
          makeThread(`m${i}`, new Date(since.getTime() + i * 60_000))
        );
        let start = 0;
        if (input.pageCursor?.startsWith("cursor:")) {
          start = Number(input.pageCursor.slice("cursor:".length));
        }
        const pageSize = input.maxThreads ?? HISTORICAL_IMPORT_PAGE_SIZE;
        const slice = all.slice(start, start + pageSize);
        const nextStart = start + slice.length;
        return {
          threads: slice,
          newestSyncCursor: null,
          nextPageCursor:
            nextStart < all.length ? `cursor:${nextStart}` : null,
          accessToken: null,
          accessTokenExpiresAt: null,
        };
      }
    );

    await expect(
      processMailboxHistoricalImport(
        {
          workspaceId: "ws1",
          inboxConnectionId: "conn1",
          importId: "imp1",
          requestedLimit: HISTORICAL_IMPORT_UNLIMITED,
          sinceDate: since.toISOString(),
        },
        deps
      )
    ).rejects.toThrow(/503/);

    const afterFail = importUpdates[importUpdates.length - 1];
    expect(afterFail?.status).toBe("RUNNING");
    expect(afterFail?.resumeCursor).toBe("cursor:50");
    expect(afterFail?.processedCount).toBe(50);

    // Resume from persisted cursor
    syncCalls = [];
    importUpdates = [];
    const resumeDeps = buildDeps(total);
    resumeDeps.prisma.mailboxHistoricalImport.findUnique = vi.fn(async () => ({
      id: "imp1",
      resumeCursor: "cursor:50",
      startedAt: new Date(),
      importedCount: 50,
      duplicateCount: 0,
      failedCount: 0,
      processedProviderMessageIds: Array.from({ length: 50 }, (_, i) => `m${i}`),
    }));

    const resumed = await processMailboxHistoricalImport(
      {
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
        importId: "imp1",
        requestedLimit: HISTORICAL_IMPORT_UNLIMITED,
        sinceDate: since.toISOString(),
      },
      resumeDeps
    );

    expect(resumed.status).toBe("COMPLETED");
    expect(resumed.processedCount).toBe(total);
    expect(resumed.importedCount).toBe(total); // 50 prior + 70 new
    expect(syncCalls[0]?.pageCursor).toBe("cursor:50");
  });

  it("by-count still respects requested limit (not unlimited)", async () => {
    const deps = buildDeps(400);
    const result = await processMailboxHistoricalImport(
      {
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
        importId: "imp1",
        requestedLimit: 100,
      },
      deps
    );
    expect(result.status).toBe("COMPLETED");
    expect(result.processedCount).toBe(100);
    expect(result.importedCount).toBe(100);
    expect(syncCalls.length).toBe(2); // 50 + 50
  });

  it("does not write resumeCursor into classify/audit-style side channels", async () => {
    const deps = buildDeps(60);
    await processMailboxHistoricalImport(
      {
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
        importId: "imp1",
        requestedLimit: HISTORICAL_IMPORT_UNLIMITED,
        sinceDate: since.toISOString(),
      },
      deps
    );
    for (const call of ensureMailboxClassifyJob.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/cursor:/);
    }
  });
});
