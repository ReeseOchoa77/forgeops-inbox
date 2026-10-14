import { describe, expect, it, vi } from "vitest";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;

describe("clearBiddingAnalysisStaging", () => {
  it("O) Clear Analysis never deletes BidCandidates and is separate from Clear All Emails", () => {
    const src = readFileSync(
      join(here, "../application/services/clear-bidding-analysis.ts"),
      "utf8"
    );
    expect(src).toContain("Never deletes:");
    expect(src).toContain("BidCandidate (permanent operational opportunities)");
    expect(src).not.toContain("includeBidCandidates");
    expect(src).not.toMatch(/bidCandidate\.deleteMany/);
  });

  it("source never deletes EmailMessage, Attachment, Job, Customer, or BidCandidate", () => {
    const src = readFileSync(
      join(here, "../application/services/clear-bidding-analysis.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/emailMessage\.delete/);
    expect(src).not.toMatch(/emailAttachment\.delete/);
    expect(src).not.toMatch(/\.job\.delete/);
    expect(src).not.toMatch(/customer\.delete/);
    expect(src).not.toMatch(/bidCandidate\.delete/);
    expect(src).not.toMatch(/bidCandidateEmail\.delete/);
  });

  it("deletes only discovery, runs, and ephemeral quotes — never Candidates", async () => {
    const tx = {
      bidCandidate: {
        count: vi.fn(async () => 5),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
      },
      bidQuoteStaging: {
        count: vi.fn(async () => 3),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(),
      },
      bidFolderDiscoveryEmail: {
        deleteMany: vi.fn(async () => ({ count: 4 })),
      },
      bidAnalysisRun: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      emailMessage: { deleteMany: vi.fn() },
      job: { deleteMany: vi.fn() },
    };

    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await clearBiddingAnalysisStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn-a",
    });

    expect(result.candidatesDeleted).toBe(0);
    expect(result.candidateEmailsUnlinked).toBe(0);
    expect(result.quotesDeleted).toBe(2);
    expect(result.discoveryDeleted).toBe(4);
    expect(result.runsDeleted).toBe(1);
    expect(result.candidatesRetained).toBe(5);
    expect(result.durableQuotesRetained).toBe(3);
    expect(tx.bidCandidate.deleteMany).not.toHaveBeenCalled();
    expect(tx.bidCandidateEmail.deleteMany).not.toHaveBeenCalled();
    expect(tx.bidQuoteStaging.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws",
        inboxConnectionId: "conn-a",
        isDurable: false,
        bidCandidateId: null,
        userConfirmedMatch: false,
      },
    });
    expect(tx.emailMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.job.deleteMany).not.toHaveBeenCalled();
  });

  it("is idempotent when already empty", async () => {
    const tx = {
      bidCandidate: {
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(),
      },
      bidQuoteStaging: {
        count: vi.fn(async () => 0),
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
      candidatesRetained: 0,
      durableQuotesRetained: 0,
    });
    expect(tx.bidCandidateEmail.deleteMany).not.toHaveBeenCalled();
    expect(tx.bidCandidate.deleteMany).not.toHaveBeenCalled();
  });
});
