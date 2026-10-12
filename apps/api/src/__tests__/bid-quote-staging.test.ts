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
          userEditedFields: null,
        })),
        update: vi.fn(async () => ({})),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      $transaction: vi.fn(),
      emailMessage: { update: vi.fn() },
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
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
  });

  it("rejects quote without deleting EmailMessage", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({
          id: "q1",
          emailMessageId: "em1",
          bidCandidateId: "c1",
          matchStatus: "MATCHED",
          userEditedFields: null,
        })),
        update: vi.fn(async () => ({})),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      emailMessage: { delete: vi.fn(), update: vi.fn() },
    };

    await updateBidQuoteStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      quoteId: "q1",
      reject: true,
    });
    expect(prisma.bidQuoteStaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          matchStatus: "REJECTED",
          bidCandidateId: null,
        }),
      })
    );
    expect(prisma.emailMessage.delete).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
  });

  it("edits amount as number and locks displayName without touching EmailMessage", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({
          id: "q1",
          emailMessageId: "em1",
          bidCandidateId: null,
          matchStatus: "UNMATCHED",
          userEditedFields: null,
        })),
        update: vi.fn(async () => ({})),
      },
      emailMessage: { update: vi.fn() },
    };

    await updateBidQuoteStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      quoteId: "q1",
      displayName: "Maple Grove Quote",
      extractedAmount: 184500,
      extractedScope: "Structural Steel",
    });
    expect(prisma.bidQuoteStaging.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayName: "Maple Grove Quote",
          extractedAmount: 184500,
          extractedScope: "Structural Steel",
          userEditedFields: expect.arrayContaining([
            "displayName",
            "extractedAmount",
            "extractedScope",
          ]),
        }),
      })
    );
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
  });

  it("reassigns to another open candidate", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({
          id: "q1",
          emailMessageId: "em1",
          bidCandidateId: "c-old",
          matchStatus: "MATCHED",
          userEditedFields: null,
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

  it("rejects non-finite amount", async () => {
    const prisma = {
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({
          id: "q1",
          emailMessageId: "em1",
          bidCandidateId: null,
          matchStatus: "UNMATCHED",
          userEditedFields: null,
        })),
      },
    };
    await expect(
      updateBidQuoteStaging({
        prisma: prisma as never,
        workspaceId: "ws",
        quoteId: "q1",
        extractedAmount: Number.NaN,
      })
    ).rejects.toMatchObject({ code: "INVALID" });
  });
});
