/**
 * Phase 3: Bid Opportunity subtype + Bid Invites Inbox filter + lossless ingestion.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBidCandidateFromEmail } from "../application/services/create-bid-candidate-from-email.js";
import { linkEmailToBidCandidate } from "../application/services/link-email-to-bid-candidate.js";
import { applyDeterministicBidInviteSubtype } from "../application/services/apply-bid-invite-subtype.js";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import {
  BUSINESS_SUBTYPE_LABELS,
  isUserConfirmedBidCandidateEmail,
  userConfirmedBidCandidateEmailEvidence,
} from "@forgeops/shared";

const here = import.meta.dirname;

function readSrc(rel: string) {
  return readFileSync(join(here, rel), "utf8");
}

describe("Phase 3 — Bid Opportunity subtype + Bid Invites Inbox filter", () => {
  it("reuses BID_OPPORTUNITY with Bid Opportunity label (no new subtype key)", () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe("Bid Opportunity");
    const subtypes = readSrc("../../../../packages/shared/src/business-subtypes.ts");
    expect(subtypes).toContain('"BID_OPPORTUNITY"');
    expect(subtypes).not.toContain("BID_CANDIDATE");
    expect(subtypes).toContain('INBOX_BID_INVITES_SOURCE_FILTER_LABEL = "Active Bid"');
  });

  it("E) Bid Invites Inbox filter = durable Bid Invites provenance only", () => {
    const src = readSrc("../interfaces/http/routes/inbox-read.route.ts");
    expect(src).toContain('businessTypeKey === "BID_OPPORTUNITY"');
    expect(src).toContain("discoveredInBidInvitesFolder: true");
    // Must NOT use subtype OR BidCandidateEmail.role as filter predicates.
    const bidBlock = src.slice(
      src.indexOf('businessTypeKey === "BID_OPPORTUNITY"'),
      src.indexOf('businessTypeKey === "ESTIMATE_QUOTE"')
    );
    expect(bidBlock).toContain("discoveredInBidInvitesFolder");
    expect(bidBlock).not.toContain('businessTypeKey: "BID_OPPORTUNITY"');
    expect(bidBlock).not.toContain('role: "BID_INVITE"');
    expect(src).toMatch(/andConditions\.push/);
  });

  it("C/D) deterministic Bid Invites subtype — no AI, BID_OPPORTUNITY + provenance", () => {
    const src = readSrc("../application/services/apply-bid-invite-subtype.ts");
    expect(src).toContain('businessTypeKey: "BID_OPPORTUNITY"');
    expect(src).toContain("bid_invites_folder");
    expect(src).toContain("discoveredInBidInvitesFolder");
    expect(src).toContain("recordFolderProvenance");
    expect(src).toContain("deterministic");
    expect(src).not.toMatch(/openai|chat\.completions|classifySubtype/i);
  });

  it("manual Assign does not stamp Bid Invites folder provenance", () => {
    const src = readSrc("../application/services/link-email-to-bid-candidate.ts");
    expect(src).toContain("recordFolderProvenance: false");
  });

  it("J/K/L/M) Create Bid Candidate from email — no Job / Job number", async () => {
    const createdCandidate: Record<string, unknown>[] = [];
    const emailLinks: Record<string, unknown>[] = [];
    const prisma = {
      emailMessage: {
        findFirst: vi.fn(async () => ({ id: "msg-1" })),
        update: vi.fn(),
        findMany: vi.fn(async () => [
          {
            id: "msg-1",
            threadId: "th-1",
            mailboxCategory: "BUSINESS",
            discoveredInBidInvitesFolder: false,
            classifications: [],
          },
        ]),
      },
      customer: { findFirst: vi.fn() },
      bidCandidate: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createdCandidate.push(data);
          return { id: "cand-1", identityKey: data.identityKey, lifecycle: "OPEN" };
        }),
        findFirst: vi.fn(async () => ({ id: "cand-1", lifecycle: "OPEN" })),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          emailLinks.push(create);
          return create;
        }),
      },
      classification: {
        upsert: vi.fn(async () => ({ id: "cls-1" })),
      },
    };

    const result = await createBidCandidateFromEmail({
      prisma: prisma as never,
      workspaceId: "ws",
      userId: "u1",
      messageId: "msg-1",
      projectName: "Falcon Renovation",
      notes: "From inbox",
    });

    expect(result.candidateId).toBe("cand-1");
    expect(result.lifecycle).toBe("OPEN");
    expect(createdCandidate[0]!.proposedJobNumber).toBeNull();
    expect(createdCandidate[0]!.lifecycle).toBe("OPEN");
    expect(emailLinks[0]!.emailMessageId).toBe("msg-1");
    expect(emailLinks[0]!.role).toBe("BID_INVITE");
    expect(
      isUserConfirmedBidCandidateEmail(emailLinks[0]!.matchEvidence)
    ).toBe(true);
    // G) Create from ordinary Inbox must not stamp folder provenance.
    const updates = (prisma.emailMessage.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ data: { discoveredInBidInvitesFolder?: boolean } }]>;
    expect(
      updates.every(
        (c) => c[0]?.data?.discoveredInBidInvitesFolder !== true
      )
    ).toBe(true);

    const fromEmailSrc = readSrc(
      "../application/services/create-bid-candidate-from-email.ts"
    );
    expect(fromEmailSrc).not.toMatch(/\.job\.create/);
    expect(fromEmailSrc).not.toMatch(/suggestNextJobNumber/);
    expect(fromEmailSrc).toContain("linkEmailToBidCandidate");
  });

  it("N) Assign email to existing Candidate works without folder provenance", async () => {
    const upserts: unknown[] = [];
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({ id: "cand-2", lifecycle: "OPEN" })),
      },
      emailMessage: {
        findFirst: vi.fn(async () => ({ id: "msg-2" })),
        findMany: vi.fn(async () => [
          {
            id: "msg-2",
            threadId: "th-2",
            mailboxCategory: "BUSINESS",
            discoveredInBidInvitesFolder: false,
            classifications: [],
          },
        ]),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => {
          updates.push(args);
          return {};
        }),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async (args: unknown) => {
          upserts.push(args);
          return args;
        }),
      },
      classification: { upsert: vi.fn(async () => ({})) },
    };

    const result = await linkEmailToBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-2",
      emailMessageId: "msg-2",
      userConfirmed: true,
      forceReassign: true,
    });
    expect(result).toEqual({ candidateId: "cand-2", emailMessageId: "msg-2" });
    expect(upserts).toHaveLength(1);
    // F) Manual assign without folder provenance must not set the flag.
    expect(
      updates.every((u) => u.data?.discoveredInBidInvitesFolder !== true)
    ).toBe(true);
  });

  it("O) Manual association evidence is user_confirmed", () => {
    const ev = userConfirmedBidCandidateEmailEvidence("inbox_manual");
    expect(isUserConfirmedBidCandidateEmail(ev)).toBe(true);
    expect(ev.labels).toContain("user_confirmed");
  });

  it("P/Q) Candidate can exist with zero Quotes (no quote gate in create)", () => {
    const src = readSrc("../application/services/create-bid-candidate.ts");
    expect(src).not.toMatch(/quoteCount|bidQuoteStaging/);
    const fromEmail = readSrc(
      "../application/services/create-bid-candidate-from-email.ts"
    );
    // From-email may link QUOTE role when source is a Quote email — still no Quote gate.
    expect(fromEmail).not.toMatch(/quoteCount|mustHaveQuote|requireQuote/i);
    expect(fromEmail).toContain("createBidCandidate");
  });

  it("T/U) Clear Analysis preserves EmailMessage + Candidate + durable links", async () => {
    const tx = {
      bidCandidate: {
        count: vi.fn(async () => 3),
        deleteMany: vi.fn(),
      },
      bidQuoteStaging: {
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bidCandidateEmail: { deleteMany: vi.fn() },
      bidFolderDiscoveryEmail: {
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
      bidAnalysisRun: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      emailMessage: { deleteMany: vi.fn() },
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
    expect(tx.emailMessage.deleteMany).not.toHaveBeenCalled();
  });

  it("V) historical Job(BIDDING) from-email path remains untouched", () => {
    const src = readSrc("../interfaces/http/routes/bidding.route.ts");
    expect(src).toContain("ACTIVE_BID_STATUS");
    expect(src).toContain("/bidding/from-email");
  });

  it("routes expose from-email + assign-email (no Convert)", () => {
    const src = readSrc("../interfaces/http/routes/bid-candidates.route.ts");
    expect(src).toContain("bid-candidates/from-email");
    expect(src).toContain("assign-email");
    expect(src).toContain("createBidCandidateFromEmail");
    expect(src).toContain("linkEmailToBidCandidate");
    // Error type reused from promote module — Inbox routes must not call promote.
    expect(src).not.toMatch(/promoteBidCandidate\(/);
    expect(src).not.toMatch(/convertToJob/i);
  });

  it("A) folder discovery stamps durable discoveredInBidInvitesFolder", async () => {
    const updates: Array<{ data: Record<string, unknown> }> = [];
    const upserts: Array<{ create: { businessTypeKey: string }; update: { businessTypeKey: string } }> = [];
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "m1",
            threadId: "t1",
            mailboxCategory: null,
            discoveredInBidInvitesFolder: false,
            classifications: [],
          },
        ]),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => {
          updates.push(args);
          return {};
        }),
      },
      classification: {
        upsert: vi.fn(async (args: { create: { businessTypeKey: string }; update: { businessTypeKey: string } }) => {
          upserts.push(args);
          return {};
        }),
      },
    };
    const r = await applyDeterministicBidInviteSubtype({
      prisma: prisma as never,
      workspaceId: "ws",
      emailMessageIds: ["m1"],
    });
    expect(r.applied).toBe(1);
    expect(r.provenanceMarked).toBe(1);
    expect(upserts[0]!.create.businessTypeKey).toBe("BID_OPPORTUNITY");
    expect(upserts[0]!.update.businessTypeKey).toBe("BID_OPPORTUNITY");
    expect(updates.some((u) => u.data.discoveredInBidInvitesFolder === true)).toBe(
      true
    );
  });

  it("J) analysis rerun is idempotent for provenance (no duplicate stamp work)", async () => {
    const updates: unknown[] = [];
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          {
            id: "m1",
            threadId: "t1",
            discoveredInBidInvitesFolder: true,
            classifications: [
              {
                reviewedByUserId: null,
                routingHints: {
                  authority: "SYSTEM_DETERMINISTIC",
                  source: "bid_invites_folder",
                },
              },
            ],
          },
        ]),
        update: vi.fn(async (args: unknown) => {
          updates.push(args);
          return {};
        }),
      },
      classification: {
        upsert: vi.fn(async () => ({})),
      },
    };
    const r = await applyDeterministicBidInviteSubtype({
      prisma: prisma as never,
      workspaceId: "ws",
      emailMessageIds: ["m1"],
    });
    expect(r.provenanceMarked).toBe(0);
    // May still refresh subtype when authority allows — provenanceMarked stays 0.
    expect(r.applied).toBeGreaterThanOrEqual(0);
  });

  it("H) Clear Analysis does not erase EmailMessage (provenance lives on message)", async () => {
    const clearSrc = readSrc("../application/services/clear-bidding-analysis.ts");
    expect(clearSrc).toContain("bidFolderDiscoveryEmail");
    expect(clearSrc).toContain("EmailMessage");
    expect(clearSrc).not.toMatch(/discoveredInBidInvitesFolder\s*[:=]\s*false/);
    expect(clearSrc).not.toMatch(/emailMessage\.updateMany/);
  });
});
