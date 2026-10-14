import { describe, expect, it, vi } from "vitest";
import {
  canConvertBidCandidateToJob,
  CONVERTED_JOB_STATUS,
  convertBidCandidateToJob,
  ConvertBidCandidateError,
  previewConvertBidCandidateToJob,
} from "../application/services/convert-bid-candidate-to-job.js";

describe("canConvertBidCandidateToJob", () => {
  it("AF) matches Job create authority (workspaceRole OWNER/EDITOR)", () => {
    expect(canConvertBidCandidateToJob("OWNER")).toBe(true);
    expect(canConvertBidCandidateToJob("EDITOR")).toBe(true);
    expect(canConvertBidCandidateToJob("VIEWER")).toBe(false);
  });
});

function baseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cand-1",
    workspaceId: "ws",
    status: "READY",
    lifecycle: "OPEN",
    proposedProjectName: "Project Falcon",
    proposedCustomerName: "Mortenson",
    customerId: "cust-1",
    proposedBidDueAt: new Date("2026-10-22T00:00:00.000Z"),
    anticipatedStartAt: new Date("2027-01-15T00:00:00.000Z"),
    proposedJobNumber: "EXT-99",
    proposedEstimatorUserId: "est-1",
    proposedScope: "Beams, Columns, Stairs",
    proposedScopeDetail: null,
    proposedNotes: "Business note only",
    reviewNotes: "debug analysis — should not carry",
    canonicalJobId: null,
    emails: [
      { emailMessageId: "em-invite", role: "BID_INVITE" },
      { emailMessageId: "em-quote", role: "QUOTE" },
      { emailMessageId: "em-support", role: "SUPPORTING" },
    ],
    customer: { id: "cust-1", name: "Mortenson" },
    ...overrides,
  };
}

describe("convertBidCandidateToJob", () => {
  it("A/F/G/H/I/J) OPEN convert creates one ACTIVE Job with selected number", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "cand-1" }]),
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          lifecycle: "OPEN",
          canonicalJobId: null,
          status: "READY",
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      customer: {
        findFirst: vi.fn(async () => ({ id: "cust-1", name: "Mortenson" })),
        findMany: vi.fn(async () => []),
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      job: {
        create: vi.fn(async () => ({
          id: "job-new",
          jobNumber: "26010",
          name: "Project Falcon",
          status: CONVERTED_JOB_STATUS,
        })),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      entityAlias: { createMany: vi.fn(async () => ({ count: 1 })) },
      bidCandidateEmail: {
        findMany: vi.fn(async () => [
          { emailMessageId: "em-invite", role: "BID_INVITE" },
          { emailMessageId: "em-quote", role: "QUOTE" },
          { emailMessageId: "em-support", role: "SUPPORTING" },
        ]),
      },
      bidQuoteStaging: {
        findMany: vi.fn(async () => [{ emailMessageId: "em-quote" }]),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "em-invite",
            jobId: null,
            jobAssignmentIsManual: false,
            jobAssignmentSource: null,
          },
          {
            id: "em-quote",
            jobId: null,
            jobAssignmentIsManual: false,
            jobAssignmentSource: null,
          },
          {
            id: "em-support",
            jobId: null,
            jobAssignmentIsManual: false,
            jobAssignmentSource: null,
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 3 })),
      },
      jobActivityLog: { create: vi.fn(async () => ({})) },
    };

    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => baseCandidate()),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await convertBidCandidateToJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      userId: "user-1",
      jobNumber: "26010",
    });

    expect(result.created).toBe(true);
    expect(result.reused).toBe(false);
    expect(result.jobId).toBe("job-new");
    expect(result.jobNumber).toBe("26010");
    expect(result.jobStatus).toBe("ACTIVE");
    expect(tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "ACTIVE",
          jobNumber: "26010",
          name: "Project Falcon",
          customerId: "cust-1",
          startDate: new Date("2027-01-15T00:00:00.000Z"),
          bidDueAt: new Date("2026-10-22T00:00:00.000Z"),
          description: "Beams, Columns, Stairs",
          notes: "Business note only",
          externalRef: "EXT-99",
          estimatorUserId: "est-1",
        }),
      })
    );
    // O) bid due is not used as startDate
    expect(tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startDate: new Date("2027-01-15T00:00:00.000Z"),
          bidDueAt: new Date("2026-10-22T00:00:00.000Z"),
        }),
      })
    );
    expect(tx.bidCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lifecycle: "CONVERTED",
          canonicalJobId: "job-new",
        }),
      })
    );
    expect(tx.jobActivityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "JOB_CREATED",
          newValue: expect.objectContaining({
            source: "bid_candidate_convert",
          }),
        }),
      })
    );
  });

  it("B) QUOTED Candidate can convert", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "cand-1" }]),
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          lifecycle: "QUOTED",
          canonicalJobId: null,
          status: "READY",
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      customer: {
        findFirst: vi.fn(async () => ({ id: "cust-1", name: "Mortenson" })),
        findMany: vi.fn(async () => []),
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      job: {
        create: vi.fn(async () => ({
          id: "job-q",
          jobNumber: "26011",
          name: "Project Falcon",
          status: "ACTIVE",
        })),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      entityAlias: { createMany: vi.fn(async () => ({ count: 0 })) },
      bidCandidateEmail: { findMany: vi.fn(async () => []) },
      bidQuoteStaging: { findMany: vi.fn(async () => []) },
      emailMessage: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      jobActivityLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => baseCandidate({ lifecycle: "QUOTED" })),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await convertBidCandidateToJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      userId: "u",
      jobNumber: "26011",
    });
    expect(result.created).toBe(true);
    expect(result.jobStatus).toBe("ACTIVE");
  });

  it("AB/Z) already converted is idempotent — no second Job", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () =>
          baseCandidate({
            lifecycle: "CONVERTED",
            canonicalJobId: "job-existing",
          })
        ),
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

    const result = await convertBidCandidateToJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      userId: "u",
      jobNumber: "99999",
    });
    expect(result.reused).toBe(true);
    expect(result.created).toBe(false);
    expect(result.jobId).toBe("job-existing");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("AG) LOST Candidate cannot convert", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () =>
          baseCandidate({ lifecycle: "LOST", canonicalJobId: null })
        ),
      },
      $transaction: vi.fn(),
    };
    await expect(
      convertBidCandidateToJob({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        userId: "u",
        jobNumber: "26012",
      })
    ).rejects.toMatchObject({ code: "NOT_CONVERTIBLE" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("AC) Job number collision returns JOB_NUMBER_TAKEN (not EXISTING_JOB)", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => baseCandidate()),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => ({
          id: "other",
          name: "Other Project",
          jobNumber: "26010",
        })),
      },
      $transaction: vi.fn(),
    };
    await expect(
      convertBidCandidateToJob({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        userId: "u",
        jobNumber: "26010",
      })
    ).rejects.toMatchObject({ code: "JOB_NUMBER_TAKEN" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Name-similarity path must not run first for pure number collisions.
    expect(prisma.job.findMany).not.toHaveBeenCalled();
  });

  it("C) proposedJobNumber is externalRef, not ForgeOps Job number", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "cand-1" }]),
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          lifecycle: "OPEN",
          canonicalJobId: null,
          status: "READY",
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      customer: {
        findFirst: vi.fn(async () => ({ id: "cust-1", name: "Mortenson" })),
        findMany: vi.fn(async () => []),
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      job: {
        create: vi.fn(async () => ({
          id: "job-new",
          jobNumber: "26020",
          name: "Project Falcon",
          status: "ACTIVE",
        })),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      entityAlias: { createMany: vi.fn(async () => ({ count: 1 })) },
      bidCandidateEmail: { findMany: vi.fn(async () => []) },
      bidQuoteStaging: { findMany: vi.fn(async () => []) },
      emailMessage: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      jobActivityLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () =>
          baseCandidate({ proposedJobNumber: "EXT-99" })
        ),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    await convertBidCandidateToJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      userId: "u",
      jobNumber: "26020",
    });
    expect(tx.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobNumber: "26020",
          externalRef: "EXT-99",
        }),
      })
    );
  });

  it("AA) concurrent claim failure does not leave Candidate CONVERTED", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => [{ id: "cand-1" }]),
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-1",
          lifecycle: "OPEN",
          canonicalJobId: null,
          status: "READY",
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      customer: {
        findFirst: vi.fn(async () => ({ id: "cust-1", name: "Mortenson" })),
        findMany: vi.fn(async () => []),
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      job: {
        create: vi.fn(async () => ({
          id: "job-orphan-would-rollback",
          jobNumber: "26030",
          name: "Project Falcon",
          status: "ACTIVE",
        })),
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      entityAlias: { createMany: vi.fn(async () => ({ count: 0 })) },
      bidCandidateEmail: { findMany: vi.fn(async () => []) },
      bidQuoteStaging: { findMany: vi.fn(async () => []) },
      emailMessage: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      jobActivityLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => baseCandidate()),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    await expect(
      convertBidCandidateToJob({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        userId: "u",
        jobNumber: "26030",
      })
    ).rejects.toMatchObject({ code: "CONCURRENT_CONVERSION" });
  });
});

describe("previewConvertBidCandidateToJob", () => {
  it("D) preview suggests number without creating Job", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          ...baseCandidate(),
          emails: [{ id: "l1" }],
          quoteStagings: [{ id: "q1" }],
          customer: { id: "cust-1", name: "Mortenson" },
        })),
      },
      job: {
        findMany: vi.fn(async () => [{ jobNumber: "26009" }]),
      },
    };

    const preview = await previewConvertBidCandidateToJob({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
    });
    expect(preview.convertible).toBe(true);
    expect(preview.suggestedJobNumber).toBeTruthy();
    expect(preview.projectName).toBe("Project Falcon");
    expect(preview.startDate).toContain("2027-01-15");
    expect(preview.bidDueAt).toContain("2026-10-22");
    expect(preview.externalProjectNumber).toBe("EXT-99");
    // No job.create in preview path
    expect((prisma as { job: { create?: unknown } }).job.create).toBeUndefined();
  });
});

describe("ConvertBidCandidateError codes", () => {
  it("exposes JOB_NUMBER_REQUIRED when missing", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => baseCandidate()),
      },
      job: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      $transaction: vi.fn(),
    };
    await expect(
      convertBidCandidateToJob({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        userId: "u",
        jobNumber: "  ",
      })
    ).rejects.toBeInstanceOf(ConvertBidCandidateError);
  });
});
