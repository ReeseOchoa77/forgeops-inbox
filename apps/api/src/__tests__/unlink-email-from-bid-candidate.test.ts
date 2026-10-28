import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unlinkEmailFromBidCandidate } from "../application/services/unlink-email-from-bid-candidate.js";
import { emailLinkedToActiveBidCandidateWhere } from "../application/services/active-bid-candidate-membership.js";

const here = import.meta.dirname;

describe("unlinkEmailFromBidCandidate", () => {
  it("8/9) unlinks BidCandidateEmail without deleting EmailMessage", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({ id: "cand-1" })),
      },
      emailMessage: {
        findFirst: vi.fn(async () => ({ id: "em-1" })),
        delete: vi.fn(),
        deleteMany: vi.fn(),
      },
      bidCandidateEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      bidQuoteStaging: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const result = await unlinkEmailFromBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      emailMessageId: "em-1",
    });

    expect(result).toEqual({
      candidateId: "cand-1",
      emailMessageId: "em-1",
      unlinked: true,
    });
    expect(prisma.bidCandidateEmail.deleteMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws",
        bidCandidateId: "cand-1",
        emailMessageId: "em-1",
      },
    });
    expect(prisma.emailMessage.delete).not.toHaveBeenCalled();
    expect(prisma.emailMessage.deleteMany).not.toHaveBeenCalled();
    expect(prisma.bidQuoteStaging.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bidCandidateId: null,
          matchStatus: "USER_UNMATCHED",
        }),
      })
    );
  });

  it("10) Inbox Active Bid membership is BidCandidateEmail on OPEN|QUOTED", () => {
    const pred = emailLinkedToActiveBidCandidateWhere("ws");
    expect(pred).toEqual({
      bidCandidateEmails: {
        some: {
          workspaceId: "ws",
          bidCandidate: {
            workspaceId: "ws",
            lifecycle: { in: ["OPEN", "QUOTED"] },
          },
        },
      },
    });
  });

  it("13) cross-workspace unlink fails", async () => {
    const prisma = {
      bidCandidate: { findFirst: vi.fn(async () => null) },
      emailMessage: { findFirst: vi.fn(), delete: vi.fn() },
      bidCandidateEmail: { deleteMany: vi.fn() },
      bidQuoteStaging: { updateMany: vi.fn() },
    };
    await expect(
      unlinkEmailFromBidCandidate({
        prisma: prisma as never,
        workspaceId: "other-ws",
        candidateId: "cand-1",
        emailMessageId: "em-1",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.bidCandidateEmail.deleteMany).not.toHaveBeenCalled();
  });

  it("route exposes DELETE unlink (relationship only)", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/routes/bid-candidates.route.ts"),
      "utf8"
    );
    expect(src).toContain("unlinkEmailFromBidCandidate");
    expect(src).toContain(
      "/api/v1/workspaces/:workspaceId/bid-candidates/:candidateId/emails/:emailMessageId"
    );
    expect(src).toContain("assign-email");
  });
});
