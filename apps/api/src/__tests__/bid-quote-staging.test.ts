import { describe, expect, it, vi } from "vitest";
import {
  BidQuoteStagingError,
  updateBidQuoteStaging,
} from "../application/services/bid-quote-staging.js";

describe("updateBidQuoteStaging", () => {
  it("unmatches and marks USER_UNMATCHED with userConfirmedMatch", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({
          id: "q1",
          emailMessageId: "em1",
          bidCandidateId: "c1",
          matchStatus: "MATCHED",
        })),
        update: vi.fn(async () => ({})),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      $transaction: vi.fn(),
    };

    const result = await updateBidQuoteStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      quoteId: "q1",
      unmatch: true,
    });
    expect(result.quoteId).toBe("q1");
    expect(prisma.bidCandidateEmail.deleteMany).toHaveBeenCalled();
    expect(prisma.bidQuoteStaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bidCandidateId: null,
          matchStatus: "USER_UNMATCHED",
          userConfirmedMatch: true,
        }),
      })
    );
  });

  it("reassigns to another open candidate", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({
          id: "q1",
          emailMessageId: "em1",
          bidCandidateId: "c-old",
          matchStatus: "MATCHED",
        })),
        update: vi.fn(async () => ({})),
      },
      bidCandidate: {
        findFirst: vi.fn(async () => ({ id: "c-new" })),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        upsert: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    };

    await updateBidQuoteStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      quoteId: "q1",
      bidCandidateId: "c-new",
    });
    expect(prisma.bidCandidate.findFirst).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("throws when quote missing", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => null),
      },
    };
    await expect(
      updateBidQuoteStaging({
        prisma: prisma as never,
        workspaceId: "ws",
        quoteId: "missing",
        unmatch: true,
      })
    ).rejects.toBeInstanceOf(BidQuoteStagingError);
  });
});
