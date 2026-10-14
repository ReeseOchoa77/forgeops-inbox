import { describe, expect, it, vi } from "vitest";
import { emptyBidEmailAnalyzeProgress } from "@forgeops/shared";
import { matchQuotesToCandidates } from "../application/services/bid-email-staging-pipeline.js";

describe("matchQuotesToCandidates import safety", () => {
  it("does not create BidCandidateEmail for NEEDS_REVIEW matches", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const upsert = vi.fn(async () => ({}));
    const deleteMany = vi.fn(async () => ({ count: 0 }));
    const prisma = {
      bidAnalysisRun: { update: vi.fn(async () => ({})) },
      bidQuoteStaging: {
        findMany: vi.fn(async () => [
          {
            id: "q1",
            emailMessageId: "em-q",
            matchStatus: "UNMATCHED",
            userConfirmedMatch: false,
            extractedScope: null,
            extractedAmount: null,
            emailMessage: {
              id: "em-q",
              // Exact project name → ~0.35 score (review band, not auto-link).
              subject: "Project Falcon",
              bodyText: "Please see our pricing.",
              senderName: "Some Vendor LLC",
              attachmentMetadata: [],
              jobId: null,
            },
          },
        ]),
        update: vi.fn(async () => ({})),
      },
      bidCandidate: {
        findMany: vi.fn(async () => [
          {
            id: "c1",
            proposedProjectName: "Project Falcon",
            proposedJobNumber: null,
            proposedCustomerName: "Mortenson",
          },
        ]),
        update: vi.fn(async () => ({})),
      },
      bidCandidateEmail: {
        findFirst: vi.fn(async () => null),
        upsert,
        deleteMany,
      },
    };

    await matchQuotesToCandidates({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
      ai: null,
    });

    // Ambiguous / mid-score should be NEEDS_REVIEW without QUOTE email link upsert.
    const updateData = prisma.bidQuoteStaging.update.mock.calls[0]?.[0]?.data;
    expect(updateData?.matchStatus).toBe("NEEDS_REVIEW");
    expect(upsert).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalled();
  });
});
