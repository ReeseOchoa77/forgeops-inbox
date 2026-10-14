/**
 * Phase 3 worker: lossless Bid Invites → EmailMessage + Candidates.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureBidInviteCandidates } from "../application/services/ensure-bid-invite-candidates.js";
import { applyDeterministicBidInviteSubtype } from "../application/services/apply-bid-invite-subtype.js";
import { isUserConfirmedBidCandidateEmail } from "@forgeops/shared";

const here = import.meta.dirname;

describe("Phase 3 — Bid Invites lossless ingestion", () => {
  it("A/B) Bid Invites scan imports EmailMessage before matching (source audit)", () => {
    const processor = readFileSync(
      join(here, "../application/processors/bid-email-analyze.processor.ts"),
      "utf8"
    );
    const pipeline = readFileSync(
      join(here, "../application/services/bid-email-staging-pipeline.ts"),
      "utf8"
    );
    expect(processor).toContain("importProviderMailbox");
    expect(processor).toContain('phase === "BID_INVITES"');
    expect(processor).toContain("applyDeterministicBidInviteSubtype");
    expect(pipeline).toContain("ensureBidInviteCandidates");
    // Persistence must not be gated on quote match success.
    expect(processor).not.toMatch(
      /if\s*\(.*quoteMatch[\s\S]{0,80}\)[\s\S]{0,40}importProviderMailbox/
    );
  });

  it("D) authoritative Bid Invites provenance skips AI subtype", () => {
    const src = readFileSync(
      join(here, "../application/services/apply-bid-invite-subtype.ts"),
      "utf8"
    );
    expect(src).toContain("bid_invites_folder");
    expect(src).toContain("deterministic");
    expect(src).toContain('businessTypeKey: "BID_OPPORTUNITY"');
    expect(src).not.toMatch(/openai|generateObject|chat\.completions/i);
  });

  it("R/S) ensureBidInviteCandidates reuses identity / skips already-linked", async () => {
    const creates: unknown[] = [];
    const prisma = {
      bidAnalysisRun: { update: vi.fn(async () => ({})) },
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => [
          {
            emailMessageId: "msg-a",
            emailMessage: {
              id: "msg-a",
              subject: "ITB Project Falcon",
              bodyText: null,
              senderName: "Mortenson",
              senderEmail: "gc@example.com",
              attachmentMetadata: null,
              bidCandidateEmails: [],
            },
          },
          {
            emailMessageId: "msg-b",
            emailMessage: {
              id: "msg-b",
              subject: "Already linked invite",
              bodyText: null,
              senderName: "X",
              senderEmail: "x@example.com",
              attachmentMetadata: null,
              bidCandidateEmails: [
                {
                  bidCandidateId: "existing",
                  matchEvidence: { labels: ["analysis_link"] },
                },
              ],
            },
          },
        ]),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          { id: "msg-a", threadId: "t1", classifications: [] },
          { id: "msg-b", threadId: "t2", classifications: [] },
        ]),
        update: vi.fn(),
      },
      classification: { upsert: vi.fn(async () => ({})) },
      bidCandidate: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async ({ data }: { data: { identityKey: string } }) => {
          creates.push(data);
          return {
            id: `cand-${creates.length}`,
            lifecycle: "OPEN",
            status: "DISCOVERED",
            userEditedFields: [],
          };
        }),
      },
      bidCandidateEmail: {
        upsert: vi.fn(async () => ({})),
      },
    };

    const progress = {
      currentPhase: "DISCOVERING",
      candidatesCreated: 0,
    } as never;

    const result = await ensureBidInviteCandidates({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-1",
      progress,
    });

    // msg-b already linked — skipped; msg-a creates one Candidate.
    expect(result.created).toBe(1);
    expect(result.linked).toBe(1);
    expect(creates).toHaveLength(1);
  });

  it("O) user_confirmed link is skipped on ensure rerun", async () => {
    const create = vi.fn();
    const prisma = {
      bidAnalysisRun: { update: vi.fn(async () => ({})) },
      bidFolderDiscoveryEmail: {
        findMany: vi.fn(async () => [
          {
            emailMessageId: "msg-u",
            emailMessage: {
              id: "msg-u",
              subject: "ITB",
              bodyText: null,
              senderName: "GC",
              senderEmail: "gc@x.com",
              attachmentMetadata: null,
              bidCandidateEmails: [
                {
                  bidCandidateId: "manual-cand",
                  matchEvidence: {
                    labels: ["user_confirmed", "manual_assign"],
                    userConfirmed: true,
                  },
                },
              ],
            },
          },
        ]),
      },
      emailMessage: {
        findMany: vi.fn(async () => [
          { id: "msg-u", threadId: "t", classifications: [] },
        ]),
        update: vi.fn(),
      },
      classification: { upsert: vi.fn(async () => ({})) },
      bidCandidate: { findUnique: vi.fn(), create },
      bidCandidateEmail: { upsert: vi.fn() },
    };

    await ensureBidInviteCandidates({
      prisma: prisma as never,
      workspaceId: "ws",
      inboxConnectionId: "conn",
      runId: "run-2",
      progress: { currentPhase: "DISCOVERING", candidatesCreated: 0 } as never,
    });

    expect(create).not.toHaveBeenCalled();
    expect(
      isUserConfirmedBidCandidateEmail({
        labels: ["user_confirmed", "manual_assign"],
      })
    ).toBe(true);
  });

  it("persist-native-classification preserves stronger folder/manual subtype authority", () => {
    const src = readFileSync(
      join(here, "../application/services/persist-native-classification.ts"),
      "utf8"
    );
    expect(src).toContain("canReplaceClassificationAuthority");
    expect(src).toContain("preserveStrongerAuthority");
  });

  it("quote-first respects user_confirmed BidCandidateEmail", () => {
    const src = readFileSync(
      join(here, "../application/services/quote-first-reconstruction.ts"),
      "utf8"
    );
    expect(src).toContain("isUserConfirmedBidCandidateEmail");
    expect(src).toContain("userLocked");
  });

  it("C) applyDeterministicBidInviteSubtype sets BID_OPPORTUNITY", async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          { id: "e1", threadId: "t1", classifications: [] },
        ]),
        update: vi.fn(),
      },
      classification: { upsert },
    };
    await applyDeterministicBidInviteSubtype({
      prisma: prisma as never,
      workspaceId: "ws",
      emailMessageIds: ["e1"],
    });
    expect(upsert.mock.calls[0]![0].create.businessTypeKey).toBe(
      "BID_OPPORTUNITY"
    );
  });
});
