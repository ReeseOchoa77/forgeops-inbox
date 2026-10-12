import { beforeEach, describe, expect, it, vi } from "vitest";

const promoteBidCandidate = vi.fn();

vi.mock("../application/services/promote-bid-candidate.js", async () => {
  const actual = await vi.importActual<
    typeof import("../application/services/promote-bid-candidate.js")
  >("../application/services/promote-bid-candidate.js");
  return {
    ...actual,
    promoteBidCandidate: (...args: unknown[]) => promoteBidCandidate(...args),
  };
});

import { computeImportBlockedReason } from "../application/services/bid-import-eligibility.js";
import { importBidCandidates } from "../application/services/import-bid-candidates.js";

describe("computeImportBlockedReason", () => {
  it("blocks unresolved existing Job matches and missing name", () => {
    expect(
      computeImportBlockedReason({
        status: "READY",
        proposedProjectName: "Falcon",
        existingJobMatchStatus: "STRONG",
      })
    ).toBe("Unresolved existing Job match");
    expect(
      computeImportBlockedReason({
        status: "READY",
        proposedProjectName: null,
        existingJobMatchStatus: "NONE",
      })
    ).toBe("Missing project name");
    expect(
      computeImportBlockedReason({
        status: "READY",
        proposedProjectName: "Falcon",
        existingJobMatchStatus: "RESOLVED_DIFFERENT",
      })
    ).toBeNull();
  });
});

describe("importBidCandidates", () => {
  beforeEach(() => {
    promoteBidCandidate.mockReset();
  });

  it("rejects non OWNER/ADMIN", async () => {
    await expect(
      importBidCandidates({
        prisma: {} as never,
        workspaceId: "ws",
        userId: "u1",
        role: "MANAGER",
        candidateIds: ["c1"],
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("imports attach for RESOLVED_SAME, fails blocked, skips confirmed", async () => {
    const candidates: Record<string, object> = {
      "c-ready": {
        id: "c-ready",
        status: "READY",
        proposedProjectName: "Nova",
        proposedExistingJobId: null,
        existingJobMatchStatus: "NONE",
        canonicalJobId: null,
        importBlockedReason: null,
      },
      "c-same": {
        id: "c-same",
        status: "READY",
        proposedProjectName: "Falcon",
        proposedExistingJobId: "job-1",
        existingJobMatchStatus: "RESOLVED_SAME",
        canonicalJobId: null,
        importBlockedReason: null,
      },
      "c-blocked": {
        id: "c-blocked",
        status: "READY",
        proposedProjectName: "Blocked",
        proposedExistingJobId: "job-x",
        existingJobMatchStatus: "STRONG",
        canonicalJobId: null,
        importBlockedReason: null,
      },
      "c-done": {
        id: "c-done",
        status: "CONFIRMED",
        proposedProjectName: "Done",
        proposedExistingJobId: null,
        existingJobMatchStatus: "NONE",
        canonicalJobId: "job-done",
        importBlockedReason: "Already imported",
      },
    };

    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          return candidates[where.id] ?? null;
        }),
        update: vi.fn(async () => ({})),
      },
    };

    promoteBidCandidate.mockImplementation(
      async (input: {
        candidateId: string;
        mode: string;
        existingJobId?: string;
        preserveJobFields?: boolean;
      }) => ({
        candidateId: input.candidateId,
        jobId: input.mode === "attach" ? input.existingJobId ?? "job-1" : "job-new",
        created: input.mode !== "attach",
        attachedEmailCount: 1,
        emailConflicts: [],
      })
    );

    const result = await importBidCandidates({
      prisma: prisma as never,
      workspaceId: "ws",
      userId: "owner",
      role: "OWNER",
      candidateIds: ["c-ready", "c-same", "c-blocked", "c-done", "missing"],
    });

    expect(result.imported).toHaveLength(2);
    expect(result.imported.find((i) => i.candidateId === "c-same")?.created).toBe(
      false
    );
    expect(result.imported.find((i) => i.candidateId === "c-ready")?.created).toBe(
      true
    );
    expect(result.failed.map((f) => f.candidateId).sort()).toEqual([
      "c-blocked",
      "missing",
    ]);
    expect(result.skipped).toEqual([
      { candidateId: "c-done", reason: "Already imported" },
    ]);

    const sameCall = promoteBidCandidate.mock.calls.find(
      (c) => (c[0] as { candidateId: string }).candidateId === "c-same"
    )?.[0] as {
      mode: string;
      preserveJobFields?: boolean;
      existingJobId?: string;
    };
    expect(sameCall.mode).toBe("attach");
    expect(sameCall.preserveJobFields).toBe(true);
    expect(sameCall.existingJobId).toBe("job-1");
  });

  it("retry after success is idempotent via skip", async () => {
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "c1",
          status: "CONFIRMED",
          proposedProjectName: "X",
          proposedExistingJobId: null,
          existingJobMatchStatus: "NONE",
          canonicalJobId: "job-1",
          importBlockedReason: "Already imported",
        })),
        update: vi.fn(),
      },
    };
    const result = await importBidCandidates({
      prisma: prisma as never,
      workspaceId: "ws",
      userId: "owner",
      role: "ADMIN",
      candidateIds: ["c1"],
    });
    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(promoteBidCandidate).not.toHaveBeenCalled();
  });
});
