import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBidCandidate } from "../application/services/create-bid-candidate.js";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import { bidCandidatesWorkspaceWhere } from "../application/services/list-bid-candidates.js";
import { buildBidCandidateIdentityKey } from "@forgeops/shared";

const here = import.meta.dirname;

describe("permanent Bid Candidate (phase 2)", () => {
  it("A) manual Candidate with no email/Quote/Job/Job# persists via create service", async () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      customer: { findFirst: vi.fn() },
      bidCandidate: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "cand-1", identityKey: data.identityKey };
        }),
      },
    };

    const result = await createBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      userId: "user-1",
      projectName: "Manual Falcon Opportunity",
      notes: "Created without mail",
    });

    expect(result.candidateId).toBe("cand-1");
    expect(result.lifecycle).toBe("OPEN");
    expect(created[0]!.lifecycle).toBe("OPEN");
    expect(created[0]!.proposedJobNumber).toBeNull();
    expect(created[0]!.proposedProjectName).toBe("Manual Falcon Opportunity");
    expect(String(created[0]!.identityKey)).not.toMatch(/^num:/);
  });

  it("D/L) createBidCandidate never creates a Job", async () => {
    const src = readFileSync(
      join(here, "../application/services/create-bid-candidate.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/\.job\.create/);
    expect(src).not.toMatch(/ACTIVE_BID_STATUS/);
    expect(src).not.toMatch(/suggestNextJobNumber/);
  });

  it("E/F) Clear Analysis does not delete Candidates or Candidate emails", async () => {
    const tx = {
      bidCandidate: {
        count: vi.fn(async () => 2),
        deleteMany: vi.fn(),
      },
      bidQuoteStaging: {
        count: vi.fn(async () => 1),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bidCandidateEmail: { deleteMany: vi.fn() },
      bidFolderDiscoveryEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      bidAnalysisRun: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };

    const result = await clearBiddingAnalysisStaging({
      prisma: prisma as never,
      workspaceId: "ws",
      connectionId: "conn",
    });

    expect(result.candidatesDeleted).toBe(0);
    expect(result.candidateEmailsUnlinked).toBe(0);
    expect(tx.bidCandidate.deleteMany).not.toHaveBeenCalled();
    expect(tx.bidCandidateEmail.deleteMany).not.toHaveBeenCalled();
  });

  it("J/O) workspace list includes Candidates without mailbox and ignores analysis CONFIRMED hide", () => {
    const where = bidCandidatesWorkspaceWhere({
      workspaceId: "ws",
      filter: { lifecycle: ["OPEN", "QUOTED", "CONVERTED"] },
    });
    expect(where).toMatchObject({
      AND: expect.arrayContaining([
        { workspaceId: "ws" },
        { lifecycle: { in: ["OPEN", "QUOTED", "CONVERTED"] } },
      ]),
    });
    const serialized = JSON.stringify(where);
    expect(serialized).not.toContain("CONFIRMED");
    expect(serialized).not.toContain("inboxConnectionId");
  });

  it("identity key for manual Candidates does not use ForgeOps Job numbers", () => {
    const withName = buildBidCandidateIdentityKey({
      projectName: "Harbor Bridge",
      customerName: "Mortenson",
    });
    expect(withName).toMatch(/^name:/);

    // Passing a number is only for external evidence — still allowed as num:,
    // but createBidCandidate never passes ForgeOps Job numbers.
    const external = buildBidCandidateIdentityKey({
      externalProjectNumber: "25104",
      projectName: "Harbor Bridge",
    });
    expect(external).toBe("num:25104");
  });

  it("K) historical BIDDING Job path remains in bidding.route (untouched)", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/routes/bidding.route.ts"),
      "utf8"
    );
    expect(src).toContain("ACTIVE_BID_STATUS");
    expect(src).toContain("from-email");
  });
});
