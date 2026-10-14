/**
 * Phase 3: Inbox Bid Candidate + lossless Bid Invites ingestion.
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

describe("Phase 3 — Bid Candidate subtype + Inbox", () => {
  it("reuses BID_OPPORTUNITY with Bid Candidate label (no new subtype key)", () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe("Bid Candidate");
    const subtypes = readSrc("../../../../packages/shared/src/business-subtypes.ts");
    expect(subtypes).toContain('"BID_OPPORTUNITY"');
    expect(subtypes).not.toContain("BID_CANDIDATE");
  });

  it("E) Bid Candidate Inbox filter is server-side (inbox-read)", () => {
    const src = readSrc("../interfaces/http/routes/inbox-read.route.ts");
    expect(src).toContain('businessTypeKey === "BID_OPPORTUNITY"');
    expect(src).toContain("bidCandidateEmails");
    expect(src).toContain('role: "BID_INVITE"');
    expect(src).toMatch(/andConditions\.push/);
  });

  it("C/D) deterministic Bid Invites subtype — no AI, BID_OPPORTUNITY", () => {
    const src = readSrc("../application/services/apply-bid-invite-subtype.ts");
    expect(src).toContain('businessTypeKey: "BID_OPPORTUNITY"');
    expect(src).toContain("bid_invites_folder");
    expect(src).toContain("deterministic");
    expect(src).not.toMatch(/openai|chat\.completions|classifySubtype/i);
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

    const fromEmailSrc = readSrc(
      "../application/services/create-bid-candidate-from-email.ts"
    );
    expect(fromEmailSrc).not.toMatch(/\.job\.create/);
    expect(fromEmailSrc).not.toMatch(/suggestNextJobNumber/);
    expect(fromEmailSrc).toContain("linkEmailToBidCandidate");
  });

  it("N) Assign email to existing Candidate works", async () => {
    const upserts: unknown[] = [];
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
            classifications: [],
          },
        ]),
        update: vi.fn(),
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

  it("deterministic subtype upsert sets BID_OPPORTUNITY", async () => {
    const upserts: Array<{ create: { businessTypeKey: string }; update: { businessTypeKey: string } }> = [];
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          { id: "m1", threadId: "t1", mailboxCategory: null, classifications: [] },
        ]),
        update: vi.fn(),
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
    expect(upserts[0]!.create.businessTypeKey).toBe("BID_OPPORTUNITY");
    expect(upserts[0]!.update.businessTypeKey).toBe("BID_OPPORTUNITY");
  });
});
