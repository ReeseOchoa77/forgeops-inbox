import { describe, expect, it, vi } from "vitest";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;

describe("clearBiddingAnalysisStaging", () => {
  it("source never deletes EmailMessage, Attachment, Job, or Customer", () => {
    const src = readFileSync(
      join(here, "../application/services/clear-bidding-analysis.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/emailMessage\.delete/);
    expect(src).not.toMatch(/emailAttachment\.delete/);
    expect(src).not.toMatch(/\.job\.delete/);
    expect(src).not.toMatch(/customer\.delete/);
  });

  it("clears mailbox staging including Inbox-fallback candidate links", async () => {
    const openCandidateIds = ["c-open", "c-inbox"];
    const tx = {
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => [
          { emailMessageId: "em-quote" },
          { emailMessageId: "em-invite" },
        ]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidQuoteStaging: {
        findMany: vi.fn(async () => [
          { bidCandidateId: "c-open", emailMessageId: "em-quote" },
          { bidCandidateId: "c-inbox", emailMessageId: "em-quote-2" },
        ]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => [
          { bidCandidateId: "c-open" },
          { bidCandidateId: "c-inbox" },
        ]),
        deleteMany: vi.fn(async () => ({ count: 4 })),
      },
      bidCandidate: {
        findMany: vi.fn(async () =>
          openCandidateIds.map((id) => ({ id }))
        ),
        count: vi.fn(async () => 1),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidAnalysisRun: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      emailMessage: { deleteMany: vi.fn() },
      emailAttachment: { deleteMany: vi.fn() },
      job: { deleteMany: vi.fn() },
      customer: { deleteMany: vi.fn() },
    };

    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await clearBiddingAnalysisStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn-a",
    });

    expect(result.discoveryDeleted).toBe(2);
    expect(result.quotesDeleted).toBe(2);
    expect(result.candidateEmailsUnlinked).toBe(4);
    expect(result.candidatesDeleted).toBe(2);
    expect(result.runsDeleted).toBe(1);
    expect(result.confirmedRetained).toBe(1);

    // All links on open candidates removed (not only discovery email ids).
    expect(tx.bidCandidateEmail.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws",
        bidCandidateId: { in: openCandidateIds },
      },
    });

    expect(tx.bidFolderDiscoveryEmail.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws", inboxConnectionId: "conn-a" },
    });
    expect(tx.bidQuoteStaging.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws", inboxConnectionId: "conn-a" },
    });
    expect(tx.bidAnalysisRun.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws", inboxConnectionId: "conn-a" },
    });

    expect(tx.emailMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.emailAttachment.deleteMany).not.toHaveBeenCalled();
    expect(tx.job.deleteMany).not.toHaveBeenCalled();
    expect(tx.customer.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent when already empty", async () => {
    const tx = {
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bidQuoteStaging: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      bidCandidate: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(),
      },
      bidAnalysisRun: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await clearBiddingAnalysisStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn-a",
    });

    expect(result).toEqual({
      discoveryDeleted: 0,
      quotesDeleted: 0,
      candidateEmailsUnlinked: 0,
      candidatesDeleted: 0,
      runsDeleted: 0,
      confirmedRetained: 0,
    });
    expect(tx.bidCandidateEmail.deleteMany).not.toHaveBeenCalled();
    expect(tx.bidCandidate.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes deletes to the requested mailbox connectionId", async () => {
    const seenConnectionIds: string[] = [];
    const track = async (args: { where?: { inboxConnectionId?: string } }) => {
      if (args.where?.inboxConnectionId) {
        seenConnectionIds.push(args.where.inboxConnectionId);
      }
      return { count: 0 };
    };
    const tx = {
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async (args: { where?: { inboxConnectionId?: string } }) => {
          if (args.where?.inboxConnectionId) {
            seenConnectionIds.push(args.where.inboxConnectionId);
          }
          return [];
        }),
        deleteMany: vi.fn(track),
      },
      bidQuoteStaging: {
        findMany: vi.fn(async (args: { where?: { inboxConnectionId?: string } }) => {
          if (args.where?.inboxConnectionId) {
            seenConnectionIds.push(args.where.inboxConnectionId);
          }
          return [];
        }),
        deleteMany: vi.fn(track),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(),
      },
      bidCandidate: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(),
      },
      bidAnalysisRun: {
        deleteMany: vi.fn(track),
      },
    };
    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    await clearBiddingAnalysisStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "mailbox-a",
    });

    expect(seenConnectionIds.length).toBeGreaterThan(0);
    expect(seenConnectionIds.every((id) => id === "mailbox-a")).toBe(true);
    expect(seenConnectionIds).not.toContain("mailbox-b");
  });

  it("requires connectionId", async () => {
    await expect(
      clearBiddingAnalysisStaging({
        prisma: { $transaction: vi.fn() } as never,
        workspaceId: "ws",
        connectionId: "  ",
      })
    ).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
  });
});
