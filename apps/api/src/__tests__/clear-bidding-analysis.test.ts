import { describe, expect, it, vi } from "vitest";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";

describe("clearBiddingAnalysisStaging", () => {
  it("clears staging/discovery for mailbox without deleting EmailMessage or Jobs", async () => {
    const tx = {
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => [
          { emailMessageId: "em1" },
          { emailMessageId: "em2" },
        ]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidQuoteStaging: {
        deleteMany: vi.fn(async () => ({ count: 3 })),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => [{ id: "link1" }, { id: "link2" }]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidCandidate: {
        findMany: vi.fn(async () => [{ id: "c1" }, { id: "c2" }]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
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
      connectionId: "conn-1",
    });

    expect(result.discoveryDeleted).toBe(2);
    expect(result.quotesDeleted).toBe(3);
    expect(result.candidateEmailsUnlinked).toBe(2);
    expect(result.candidatesDeleted).toBe(2);
    expect(result.runsDeleted).toBe(1);
    expect(tx.emailMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.job.deleteMany).not.toHaveBeenCalled();
  });
});
