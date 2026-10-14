import { describe, expect, it, vi } from "vitest";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeBidCandidatesForMailboxWhere,
  clearableBidCandidatesForMailboxWhere,
} from "../application/services/bid-candidate-mailbox-scope.js";

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

  it("uses shared mailbox ownership to find clearable candidates", async () => {
    const openCandidateIds = ["c-legacy", "c-modern"];
    const tx = {
      bidCandidate: {
        findMany: vi.fn(async () => openCandidateIds.map((id) => ({ id }))),
        count: vi.fn(async () => 1),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidQuoteStaging: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(async () => ({ count: 3 })),
      },
      bidFolderDiscoveryEmail: {
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

    expect(result.candidatesDeleted).toBe(2);
    expect(result.confirmedRetained).toBe(1);
    expect(tx.bidCandidate.findMany).toHaveBeenCalledWith({
      where: clearableBidCandidatesForMailboxWhere({
        workspaceId: "ws",
        connectionId: "conn-a",
      }),
      select: { id: true },
    });
    expect(tx.bidCandidateEmail.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws",
        bidCandidateId: { in: openCandidateIds },
      },
    });
    expect(tx.emailMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.job.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent when already empty", async () => {
    const tx = {
      bidCandidate: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(),
      },
      bidQuoteStaging: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(),
      },
      bidFolderDiscoveryEmail: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
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

describe("bidCandidate mailbox scope (Clear ↔ GET agreement)", () => {
  it("active GET excludes CONFIRMED/REJECTED; clearable includes REJECTED", () => {
    const active = activeBidCandidatesForMailboxWhere({
      workspaceId: "ws",
      connectionId: "conn",
    });
    const clearable = clearableBidCandidatesForMailboxWhere({
      workspaceId: "ws",
      connectionId: "conn",
    });
    expect(JSON.stringify(active)).toContain("CONFIRMED");
    expect(JSON.stringify(active)).toContain("REJECTED");
    expect(JSON.stringify(clearable)).toContain('not":"CONFIRMED"');
  });

  it("ownership includes EmailMessage.inboxConnectionId (legacy remnant shape)", () => {
    const where = clearableBidCandidatesForMailboxWhere({
      workspaceId: "ws",
      connectionId: "conn-a",
    });
    const s = JSON.stringify(where);
    expect(s).toContain("inboxConnectionId");
    expect(s).toContain("quoteStagings");
    expect(s).toContain("bidFolderDiscoveries");
  });
});
