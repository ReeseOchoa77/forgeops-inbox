import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OperationalBidCandidateError,
  updateOperationalBidCandidate,
} from "../application/services/update-operational-bid-candidate.js";

const here = import.meta.dirname;

function prismaStub(existing: Record<string, unknown> | null) {
  return {
    bidCandidate: {
      findFirst: vi.fn(async () => existing),
      update: vi.fn(async () => ({})),
    },
    customer: {
      findFirst: vi.fn(
        async (): Promise<{ id: string; name: string } | null> => ({
          id: "cust-2",
          name: "Mortenson",
        })
      ),
    },
    membership: { findFirst: vi.fn(async () => ({ id: "mem-1" })) },
    job: { update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
  };
}

function lastUpdateData(prisma: ReturnType<typeof prismaStub>) {
  const calls = prisma.bidCandidate.update.mock.calls as unknown as Array<
    [{ data: Record<string, unknown> }]
  >;
  const first = calls[0];
  if (!first) throw new Error("expected bidCandidate.update");
  return first[0].data;
}

const openCandidate = {
  id: "cand-1",
  userEditedFields: ["proposedProjectName"],
  canonicalJobId: null,
  lifecycle: "OPEN",
};

describe("updateOperationalBidCandidate", () => {
  it("1) persists project name and locks proposedProjectName", async () => {
    const prisma = prismaStub(openCandidate);
    const result = await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      projectName: "Harbor Bridge Rehab",
    });
    expect(result.candidateId).toBe("cand-1");
    expect(prisma.bidCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cand-1" },
        data: expect.objectContaining({
          proposedProjectName: "Harbor Bridge Rehab",
          userEditedFields: expect.arrayContaining(["proposedProjectName"]),
        }),
      })
    );
    expect(prisma.job.update).not.toHaveBeenCalled();
  });

  it("2) changes customer and locks customerId", async () => {
    const prisma = prismaStub(openCandidate);
    await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      customerId: "cust-2",
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cust-2", workspaceId: "ws" },
      })
    );
    expect(prisma.bidCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "cust-2",
          proposedCustomerName: "Mortenson",
          userEditedFields: expect.arrayContaining(["customerId", "proposedCustomerName"]),
        }),
      })
    );
  });

  it("3) persists bid due and anticipated start dates", async () => {
    const prisma = prismaStub(openCandidate);
    const bidDueAt = new Date("2026-11-04T12:00:00.000Z");
    const anticipatedStartAt = new Date("2027-02-01T12:00:00.000Z");
    await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      bidDueAt,
      anticipatedStartAt,
    });
    expect(prisma.bidCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposedBidDueAt: bidDueAt,
          anticipatedStartAt,
          userEditedFields: expect.arrayContaining([
            "proposedBidDueAt",
            "anticipatedStartAt",
          ]),
        }),
      })
    );
  });

  it("4) persists notes", async () => {
    const prisma = prismaStub(openCandidate);
    await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      notes: "GC wants stairs included",
    });
    expect(prisma.bidCandidate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          proposedNotes: "GC wants stairs included",
          userEditedFields: expect.arrayContaining(["proposedNotes"]),
        }),
      })
    );
  });

  it("5/6) structured Candidate scope is USER_EDITED and locked against analysis", async () => {
    const prisma = prismaStub(openCandidate);
    await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      scopeDetail: {
        items: ["Beams", "Columns"],
        work: ["Furnish", "Install"],
        summary: "Structural steel package",
      },
    });
    const data = lastUpdateData(prisma) as {
      proposedScope: string | null;
      proposedScopeDetail: { extractionMethod?: string; items?: Array<{ name: string }> };
      userEditedFields: string[];
    };
    expect(data.proposedScope).toBe("Structural steel package");
    expect(data.proposedScopeDetail.extractionMethod).toBe("USER_EDITED");
    expect(data.proposedScopeDetail.items?.map((i) => i.name)).toEqual([
      "Beams",
      "Columns",
    ]);
    expect(data.userEditedFields).toEqual(
      expect.arrayContaining(["proposedScope", "proposedScopeDetail"])
    );
  });

  it("7) protected fields stay in userEditedFields so analysis cannot overwrite", async () => {
    const prisma = prismaStub({
      ...openCandidate,
      userEditedFields: ["proposedProjectName", "proposedScopeDetail"],
    });
    await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      notes: "Keep prior locks",
    });
    const fields = lastUpdateData(prisma).userEditedFields as string[];
    expect(fields).toEqual(
      expect.arrayContaining([
        "proposedProjectName",
        "proposedScopeDetail",
        "proposedNotes",
      ])
    );
  });

  it("13) unauthorized / cross-workspace candidate is NOT_FOUND", async () => {
    const prisma = prismaStub(null);
    await expect(
      updateOperationalBidCandidate({
        prisma: prisma as never,
        workspaceId: "other-ws",
        candidateId: "cand-1",
        projectName: "Stolen",
      })
    ).rejects.toMatchObject({
      name: "OperationalBidCandidateError",
      code: "NOT_FOUND",
    } satisfies Partial<OperationalBidCandidateError>);
    expect(prisma.bidCandidate.update).not.toHaveBeenCalled();
  });

  it("13b) customer from another workspace is rejected", async () => {
    const prisma = prismaStub(openCandidate);
    prisma.customer.findFirst.mockResolvedValueOnce(null);
    await expect(
      updateOperationalBidCandidate({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        customerId: "foreign-cust",
      })
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(prisma.bidCandidate.update).not.toHaveBeenCalled();
  });

  it("11) CONVERTED cannot be selected as a lifecycle edit", async () => {
    const prisma = prismaStub(openCandidate);
    await expect(
      updateOperationalBidCandidate({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        lifecycle: "CONVERTED" as never,
      })
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(prisma.bidCandidate.update).not.toHaveBeenCalled();
    const route = readFileSync(
      join(here, "../interfaces/http/routes/bid-candidates.route.ts"),
      "utf8"
    );
    expect(route).toContain('"LOST"');
    expect(route).toContain('"ARCHIVED"');
    expect(route).toContain("updateOperationalBidCandidate");
    expect(route).toContain("operationalLifecycleEdit");
  });

  it("14) converted Candidate edits never update or delete the Job", async () => {
    const prisma = prismaStub({
      id: "cand-1",
      userEditedFields: [],
      canonicalJobId: "job-9",
      lifecycle: "CONVERTED",
    });
    await updateOperationalBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-1",
      projectName: "Historical name correction",
      notes: "Provenance note",
    });
    const data = lastUpdateData(prisma);
    expect(data.canonicalJobId).toBeUndefined();
    expect(data.lifecycle).toBeUndefined();
    expect(prisma.job.update).not.toHaveBeenCalled();
    expect(prisma.job.delete).not.toHaveBeenCalled();

    await expect(
      updateOperationalBidCandidate({
        prisma: prisma as never,
        workspaceId: "ws",
        candidateId: "cand-1",
        lifecycle: "LOST",
      })
    ).rejects.toMatchObject({ code: "INVALID" });
  });

  it("service never writes Job tables", () => {
    const src = readFileSync(
      join(here, "../application/services/update-operational-bid-candidate.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/prisma\.job\./);
    expect(src).not.toMatch(/data\.canonicalJobId/);
    expect(src).not.toMatch(/canonicalJobId\s*=/);
  });
});
