import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computeImportBlockedReason,
  extractBidCandidatesFromDiscovery,
} from "../application/services/bid-email-staging-pipeline.js";
import { emptyBidEmailAnalyzeProgress } from "@forgeops/shared";

const here = import.meta.dirname;

describe("bid-email-staging-pipeline trust boundary", () => {
  it("source never creates Jobs or sets EmailMessage.jobId", () => {
    const src = readFileSync(
      join(here, "../application/services/bid-email-staging-pipeline.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/\.job\.create\b/);
    expect(src).not.toMatch(/emailMessage\.update/);
    expect(src).not.toMatch(/persistJobMatchResult\(/);
  });
});

describe("override-safe extract", () => {
  it("does not overwrite userEditedFields proposedProjectName", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const prisma = {
      bidAnalysisRun: {
        update: vi.fn(async () => ({})),
      },
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => [{ emailMessageId: "em1" }]),
      },
      emailMessage: {
        findFirst: vi.fn(async () => ({
          id: "em1",
          subject: "25104 Project Falcon Bid Invite",
          bodyText: "Please bid Project Falcon",
          senderName: "Mortenson",
          senderEmail: "a@b.com",
          attachmentMetadata: [],
        })),
      },
      bidCandidate: {
        findUnique: vi.fn(async () => ({
          id: "c1",
          status: "READY",
          userEditedFields: ["proposedProjectName"],
          proposedProjectName: "User Locked Name",
          proposedCustomerName: null,
          proposedBidDueAt: null,
          proposedJobNumber: null,
          existingJobMatchStatus: "NONE",
        })),
        update: vi.fn(async () => ({})),
        create: vi.fn(),
      },
      bidCandidateEmail: {
        upsert: vi.fn(async () => ({})),
      },
    };

    await extractBidCandidatesFromDiscovery({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
    });

    expect(prisma.bidCandidate.update).toHaveBeenCalled();
    const data = prisma.bidCandidate.update.mock.calls[0]![0].data;
    expect(data.proposedProjectName).toBe("User Locked Name");
  });
});

describe("computeImportBlockedReason (worker)", () => {
  it("blocks NEEDS_REVIEW existing match", () => {
    expect(
      computeImportBlockedReason({
        status: "READY",
        proposedProjectName: "X",
        existingJobMatchStatus: "NEEDS_REVIEW",
      })
    ).toBe("Unresolved existing Job match");
  });
});
