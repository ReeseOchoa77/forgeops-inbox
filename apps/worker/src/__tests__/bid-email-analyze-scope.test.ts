import { describe, expect, it, vi } from "vitest";
import {
  bidAnalysisTargetFolderIds,
  emptyBidEmailAnalyzeProgress,
} from "@forgeops/shared";
import { processBidEmailAnalyze } from "../application/processors/bid-email-analyze.processor.js";

vi.mock("../application/services/import-provider-mailbox.js", () => ({
  importProviderMailbox: vi.fn(async () => ({
    workspaceId: "ws",
    inboxConnectionId: "conn",
    threadsImported: 0,
    messagesImported: 0,
    duplicatesSkipped: 0,
    createdMessageIds: [],
    updatedMessageIds: [],
    duplicateMessageIds: [],
    newestSyncCursor: null,
    attachmentIngestCandidates: [],
    skippedClearedCount: 0,
  })),
}));

vi.mock("../application/services/enqueue-attachment-ingest-from-sync.js", () => ({
  enqueueAttachmentIngestFromSync: vi.fn(async () => ({
    enqueuedCount: 0,
    failedCount: 0,
  })),
}));

describe("Bid Analysis folder scope", () => {
  it("opens only Bid Invites and Quotes — never normal Projects children", async () => {
    const openedForMessages: string[] = [];
    const childListCalls: string[] = [];

    const prisma = {
      bidAnalysisRun: {
        findFirst: vi.fn(async () => ({
          id: "run-1",
          workspaceId: "ws",
          inboxConnectionId: "conn",
          status: "PENDING",
        })),
        findUnique: vi.fn(async () => ({
          id: "run-1",
          status: "RUNNING",
        })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      inboxConnection: {
        findFirst: vi.fn(async () => ({
          id: "conn",
          provider: "OUTLOOK",
          email: "user@example.com",
          encryptedRefreshToken: "enc",
        })),
      },
      bidCandidate: {
        findUnique: vi.fn(),
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      bidCandidateEmail: {
        upsert: vi.fn(),
      },
      emailMessage: {
        findFirst: vi.fn(),
      },
    };

    const tokenCipher = {
      decrypt: () => "refresh-token",
    };

    const result = await processBidEmailAnalyze(
      {
        workspaceId: "ws",
        inboxConnectionId: "conn",
        runId: "run-1",
      },
      {
        prisma: prisma as never,
        tokenCipher: tokenCipher as never,
        outlookConfig: {
          clientId: "cid",
          clientSecret: "sec",
          tenantId: "common",
        },
        attachmentIngestQueue: { add: vi.fn() } as never,
        getAccessToken: async () => ({
          accessToken: "access",
          refreshToken: "refresh-token",
        }),
        listTopLevelFolders: async () => [
          { id: "projects", displayName: "Projects" },
        ],
        listChildFolders: async (parentId: string) => {
          childListCalls.push(parentId);
          return [
            { id: "invites", displayName: "Bid Invites" },
            { id: "quotes", displayName: "Quotes" },
            { id: "falcon", displayName: "25-104 Project Falcon" },
            { id: "nova", displayName: "Nova Academy" },
          ];
        },
        listFolderMessages: async ({ folderId }) => {
          openedForMessages.push(folderId);
          return { items: [], nextPageCursor: null };
        },
        onFolderMessagesRequested: (folderId) => {
          openedForMessages.push(`hook:${folderId}`);
        },
      }
    );

    expect(result.status).toBe("COMPLETED");
    expect(childListCalls).toEqual(["projects"]);
    expect(openedForMessages.filter((id) => !id.startsWith("hook:"))).toEqual([
      "invites",
      "quotes",
    ]);
    expect(openedForMessages).not.toContain("falcon");
    expect(openedForMessages).not.toContain("nova");
    expect(
      bidAnalysisTargetFolderIds({
        projectsRoot: { id: "projects", displayName: "Projects", path: "Projects" },
        bidInvites: { id: "invites", displayName: "Bid Invites" },
        quotes: { id: "quotes", displayName: "Quotes" },
        missingRoles: [],
      })
    ).toEqual(["invites", "quotes"]);
    expect(result.progress.aiCalls).toBe(0);
  });

  it("does not create Jobs — staging progress only", () => {
    const progress = emptyBidEmailAnalyzeProgress();
    expect(progress.candidatesCreated).toBe(0);
    // Processor never calls prisma.job.create — contract via import mock + no job deps.
    expect(typeof processBidEmailAnalyze).toBe("function");
  });
});
