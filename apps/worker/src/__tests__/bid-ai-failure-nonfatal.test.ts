import { describe, expect, it, vi } from "vitest";
import { emptyBidEmailAnalyzeProgress } from "@forgeops/shared";
import { extractBidCandidatesFromDiscovery } from "../application/services/bid-email-staging-pipeline.js";
import type { BidStagingAiContext } from "../application/services/bid-staging-ai-context.js";

describe("optional AI failure is non-fatal", () => {
  it("still stages a BidCandidate when bid AI throws", async () => {
    const progress = emptyBidEmailAnalyzeProgress();
    const create = vi.fn(async () => ({ id: "c-new" }));
    const prisma = {
      bidAnalysisRun: { update: vi.fn(async () => ({})) },
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => [{ emailMessageId: "em1" }]),
      },
      emailMessage: {
        findFirst: vi.fn(async () => ({
          id: "em1",
          subject: "ITB Mystery Project — details TBD",
          bodyText: "Please bid. Details to follow.",
          senderName: null,
          senderEmail: "noreply@example.com",
          attachmentMetadata: [],
          threadId: null,
        })),
      },
      emailAttachment: { findMany: vi.fn(async () => []) },
      bidCandidate: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create,
        update: vi.fn(),
      },
      bidCandidateEmail: {
        findFirst: vi.fn(async () => null),
        upsert: vi.fn(async () => ({})),
      },
    };

    const ai = {
      client: {} as never,
      bidExtractor: {
        isConfigured: () => true,
        extract: vi.fn(async () => {
          throw new Error("rate limit");
        }),
      },
      quoteExtractor: { isConfigured: () => false, extract: vi.fn() },
      quoteMatchAdjudicator: {
        isConfigured: () => false,
        adjudicate: vi.fn(),
      },
      existingJobAdjudicator: {
        isConfigured: () => false,
        adjudicate: vi.fn(),
      },
      readObject: null,
    } as unknown as BidStagingAiContext;

    await extractBidCandidatesFromDiscovery({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
      ai,
    });

    expect(create).toHaveBeenCalled();
    const data = create.mock.calls[0]![0].data;
    // Deterministic staging still succeeds; AI failure is recorded, not fatal.
    expect(["DISCOVERED", "NEEDS_REVIEW", "READY"]).toContain(data.status);
    expect(data.evidence?.aiFailed).toBe(true);
    expect(data.workspaceId).toBe("ws");
  });
});
