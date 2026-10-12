import { describe, expect, it, vi } from "vitest";
import {
  PromoteBidCandidateError,
  resolveBidCandidateExistingJob,
} from "../application/services/promote-bid-candidate.js";

describe("resolveBidCandidateExistingJob", () => {
  it("SAME links proposedExistingJobId and clears import block", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "c1",
          status: "NEEDS_REVIEW",
          proposedProjectName: "Falcon",
          proposedBidDueAt: new Date("2026-11-01T00:00:00.000Z"),
          proposedExistingJobId: "job-1",
        })),
        update: vi.fn(async () => ({})),
      },
      job: {
        findFirst: vi.fn(async () => ({ id: "job-1" })),
      },
    };

    const result = await resolveBidCandidateExistingJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "c1",
      resolution: "SAME",
    });
    expect(result.existingJobMatchStatus).toBe("RESOLVED_SAME");
    expect(prisma.bidCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          existingJobMatchStatus: "RESOLVED_SAME",
          status: "READY",
          importBlockedReason: null,
        }),
      })
    );
  });

  it("DIFFERENT marks RESOLVED_DIFFERENT", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "c1",
          status: "NEEDS_REVIEW",
          proposedProjectName: "Falcon",
          proposedBidDueAt: new Date("2026-11-01T00:00:00.000Z"),
          proposedExistingJobId: "job-1",
        })),
        update: vi.fn(async () => ({})),
      },
      job: { findFirst: vi.fn() },
    };

    const result = await resolveBidCandidateExistingJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "c1",
      resolution: "DIFFERENT",
    });
    expect(result.existingJobMatchStatus).toBe("RESOLVED_DIFFERENT");
  });

  it("rejects confirmed candidates", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "c1",
          status: "CONFIRMED",
          proposedProjectName: "X",
          proposedBidDueAt: null,
          proposedExistingJobId: null,
        })),
      },
    };
    await expect(
      resolveBidCandidateExistingJob({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "c1",
        resolution: "DIFFERENT",
      })
    ).rejects.toBeInstanceOf(PromoteBidCandidateError);
  });
});
