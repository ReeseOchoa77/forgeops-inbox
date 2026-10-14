import { describe, expect, it, vi } from "vitest";
import {
  canPromoteBidCandidate,
  promoteBidCandidate,
  PromoteBidCandidateError,
} from "../application/services/promote-bid-candidate.js";

describe("canPromoteBidCandidate", () => {
  it("allows OWNER/ADMIN only (legacy staging gate)", () => {
    expect(canPromoteBidCandidate("OWNER")).toBe(true);
    expect(canPromoteBidCandidate("ADMIN")).toBe(true);
    expect(canPromoteBidCandidate("MANAGER")).toBe(false);
    expect(canPromoteBidCandidate("MEMBER")).toBe(false);
  });
});

describe("promoteBidCandidate → Convert to Job", () => {
  it("never auto-promotes — creates ACTIVE Job (not BIDDING)", async () => {
    const emailIds = ["em1", "em2"];
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "cand-1" }]),
      customer: {
        findFirst: vi.fn(async () => ({ id: "cust-1", name: "Mortenson" })),
        findMany: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "cust-1" })),
        findUnique: vi.fn(),
      },
      job: {
        create: vi.fn(async () => ({
          id: "job-new",
          jobNumber: "26010",
          name: "Project Falcon",
          status: "ACTIVE",
        })),
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        update: vi.fn(),
      },
      entityAlias: {
        findMany: vi.fn(async () => []),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () =>
          emailIds.map((emailMessageId) => ({
            emailMessageId,
            role: "BID_INVITE",
          }))
        ),
      },
      bidQuoteStaging: {
        findMany: vi.fn(async () => []),
      },
      emailMessage: {
        findMany: vi.fn(async () =>
          emailIds.map((id) => ({
            id,
            jobId: null,
            jobAssignmentIsManual: false,
            jobAssignmentSource: null,
          }))
        ),
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      jobActivityLog: {
        create: vi.fn(async () => ({})),
      },
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          lifecycle: "OPEN",
          canonicalJobId: null,
          status: "READY",
        })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          workspaceId: "ws",
          status: "READY",
          lifecycle: "OPEN",
          proposedProjectName: "Project Falcon",
          proposedCustomerName: "Mortenson",
          customerId: null,
          proposedBidDueAt: new Date("2026-10-22T00:00:00.000Z"),
          anticipatedStartAt: null,
          proposedJobNumber: "25104",
          proposedEstimatorUserId: null,
          proposedScope: null,
          proposedScopeDetail: null,
          proposedNotes: null,
          canonicalJobId: null,
          emails: emailIds.map((emailMessageId) => ({
            emailMessageId,
            role: "BID_INVITE",
          })),
          customer: null,
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
      jobNumber: "26010",
    });

    expect(result.created).toBe(true);
    expect(result.jobId).toBe("job-new");
    expect(result.emailConflicts).toEqual([]);
    expect(tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACTIVE",
          name: "Project Falcon",
          jobNumber: "26010",
          // proposedJobNumber is external, not ForgeOps Job #
          externalRef: "25104",
        }),
      })
    );
    expect(tx.emailMessage.updateMany).toHaveBeenCalled();
    expect(tx.bidCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONFIRMED",
          lifecycle: "CONVERTED",
          canonicalJobId: "job-new",
        }),
      })
    );
  });

  it("idempotent: converted candidate returns existing Job without create", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          workspaceId: "ws",
          status: "CONFIRMED",
          lifecycle: "CONVERTED",
          canonicalJobId: "job-existing",
          emails: [{ emailMessageId: "em1", role: "BID_INVITE" }],
          customer: null,
        })),
      },
      job: {
        findFirst: vi.fn(async () => ({
          id: "job-existing",
          jobNumber: "26001",
          name: "Project Falcon",
          status: "ACTIVE",
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
      jobNumber: "26099",
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
          lifecycle: "OPEN",
          proposedProjectName: "Project Falcon",
          proposedCustomerName: null,
          customerId: null,
          proposedBidDueAt: null,
          anticipatedStartAt: null,
          proposedJobNumber: null,
          proposedEstimatorUserId: null,
          proposedScope: null,
          proposedScopeDetail: null,
          proposedNotes: null,
          canonicalJobId: null,
          emails: [],
          customer: null,
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
        jobNumber: "25104",
      })
    ).rejects.toMatchObject({
      code: "EXISTING_JOB",
    } satisfies Partial<PromoteBidCandidateError>);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
