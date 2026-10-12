import { describe, expect, it, vi } from "vitest";
import {
  canPromoteBidCandidate,
  promoteBidCandidate,
  PromoteBidCandidateError,
} from "../application/services/promote-bid-candidate.js";

describe("canPromoteBidCandidate", () => {
  it("allows OWNER/ADMIN only", () => {
    expect(canPromoteBidCandidate("OWNER")).toBe(true);
    expect(canPromoteBidCandidate("ADMIN")).toBe(true);
    expect(canPromoteBidCandidate("MANAGER")).toBe(false);
    expect(canPromoteBidCandidate("MEMBER")).toBe(false);
  });
});

describe("promoteBidCandidate", () => {
  it("never auto-promotes — requires explicit call and creates BIDDING Job", async () => {
    const emailIds = ["em1", "em2"];
    const tx = {
      customer: {
        findFirst: vi.fn(),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "cust-1" })),
        findUnique: vi.fn(),
      },
      job: {
        create: vi.fn(async () => ({ id: "job-new" })),
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        update: vi.fn(),
      },
      entityAlias: {
        findMany: vi.fn(async () => []),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      emailMessage: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      jobActivityLog: {
        create: vi.fn(async () => ({})),
      },
      bidCandidate: {
        update: vi.fn(async () => ({})),
      },
    };

    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          workspaceId: "ws",
          status: "READY",
          proposedProjectName: "Project Falcon",
          proposedCustomerName: "Mortenson",
          proposedBidDueAt: new Date("2026-10-22T00:00:00.000Z"),
          proposedJobNumber: "25104",
          proposedEstimatorUserId: null,
          canonicalJobId: null,
          emails: emailIds.map((emailMessageId) => ({
            emailMessageId,
            role: "BID_INVITE",
          })),
        })),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await promoteBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      userId: "user-1",
      mode: "create",
    });

    expect(result.created).toBe(true);
    expect(result.jobId).toBe("job-new");
    expect(tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "BIDDING",
          name: "Project Falcon",
          jobNumber: "25104",
        }),
      })
    );
    expect(tx.emailMessage.updateMany).toHaveBeenCalled();
    expect(tx.bidCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          canonicalJobId: "job-new",
        }),
      })
    );
  });

  it("idempotent: confirmed candidate returns existing Job without create", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          workspaceId: "ws",
          status: "CONFIRMED",
          canonicalJobId: "job-existing",
          emails: [{ emailMessageId: "em1", role: "BID_INVITE" }],
        })),
      },
      $transaction: vi.fn(),
    };

    const result = await promoteBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      userId: "user-1",
      mode: "create",
    });

    expect(result.jobId).toBe("job-existing");
    expect(result.created).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("warns on existing Job instead of silent duplicate", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          workspaceId: "ws",
          status: "READY",
          proposedProjectName: "Project Falcon",
          proposedCustomerName: null,
          proposedBidDueAt: null,
          proposedJobNumber: "25104",
          proposedEstimatorUserId: null,
          canonicalJobId: null,
          emails: [],
        })),
      },
      job: {
        findMany: vi.fn(async () => [
          {
            id: "job-1",
            name: "Project Falcon",
            jobNumber: "25104",
            status: "ACTIVE",
          },
        ]),
        findFirst: vi.fn(async () => null),
      },
      $transaction: vi.fn(),
    };

    await expect(
      promoteBidCandidate({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        userId: "user-1",
        mode: "create",
      })
    ).rejects.toMatchObject({
      code: "EXISTING_JOB",
    } satisfies Partial<PromoteBidCandidateError>);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
