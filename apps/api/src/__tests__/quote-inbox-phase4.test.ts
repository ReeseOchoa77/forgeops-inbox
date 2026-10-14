/**
 * Phase 4: Sent mail + lossless Quote ingestion.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyDeterministicQuoteSubtype } from "../application/services/apply-quote-subtype.js";
import { linkEmailToBidCandidate } from "../application/services/link-email-to-bid-candidate.js";
import { clearBiddingAnalysisStaging } from "../application/services/clear-bidding-analysis.js";
import { bidCandidatesWorkspaceWhere } from "../application/services/list-bid-candidates.js";
import {
  BUSINESS_SUBTYPE_LABELS,
  businessSubtypeFilterOptionsForDirection,
  isUserConfirmedBidCandidateEmail,
  userConfirmedBidCandidateEmailEvidence,
} from "@forgeops/shared";

const here = import.meta.dirname;

function readSrc(rel: string) {
  return readFileSync(join(here, rel), "utf8");
}

describe("Phase 4 — Quote / Sent mail", () => {
  it("reuses ESTIMATE_QUOTE with Quote label (no new QUOTE subtype key)", () => {
    expect(BUSINESS_SUBTYPE_LABELS.ESTIMATE_QUOTE).toBe("Quote");
    const subtypes = readSrc(
      "../../../../packages/shared/src/business-subtypes.ts"
    );
    expect(subtypes).toContain('"ESTIMATE_QUOTE"');
    expect(subtypes).not.toMatch(/"QUOTE"/);
  });

  it("direction-aware subtype options: Bid Candidate incoming, Quote sent", () => {
    const incoming = businessSubtypeFilterOptionsForDirection("incoming").map(
      (o) => o.key
    );
    const sent = businessSubtypeFilterOptionsForDirection("sent").map(
      (o) => o.key
    );
    expect(incoming).toContain("BID_OPPORTUNITY");
    expect(incoming).not.toContain("ESTIMATE_QUOTE");
    expect(sent).toContain("ESTIMATE_QUOTE");
    expect(sent).not.toContain("BID_OPPORTUNITY");
  });

  it("G) Quote Inbox filter is server-side (inbox-read)", () => {
    const src = readSrc("../interfaces/http/routes/inbox-read.route.ts");
    expect(src).toContain('businessTypeKey === "ESTIMATE_QUOTE"');
    expect(src).toContain('role: "QUOTE"');
    expect(src).toMatch(/andConditions\.push/);
  });

  it("C/D) deterministic Quotes subtype — no AI, ESTIMATE_QUOTE", () => {
    const src = readSrc("../application/services/apply-quote-subtype.ts");
    expect(src).toContain('businessTypeKey: "ESTIMATE_QUOTE"');
    expect(src).toContain("quotes_folder");
    expect(src).toContain("deterministic");
    expect(src).not.toMatch(/openai|chat\.completions|classifySubtype/i);
    expect(src).toContain("Does NOT set EmailMessage.direction");
  });

  it("deterministic Quote subtype upsert", async () => {
    const upserts: Array<{
      create: { businessTypeKey: string };
      update: { businessTypeKey: string };
    }> = [];
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          { id: "q1", threadId: "t1", classifications: [] },
        ]),
        update: vi.fn(),
      },
      classification: {
        upsert: vi.fn(
          async (args: {
            create: { businessTypeKey: string };
            update: { businessTypeKey: string };
          }) => {
            upserts.push(args);
            return {};
          }
        ),
      },
    };
    const r = await applyDeterministicQuoteSubtype({
      prisma: prisma as never,
      workspaceId: "ws",
      emailMessageIds: ["q1"],
    });
    expect(r.applied).toBe(1);
    expect(upserts[0]!.create.businessTypeKey).toBe("ESTIMATE_QUOTE");
  });

  it("K/M) Manual Quote → Candidate creates durable QUOTE link + OPEN→QUOTED", async () => {
    const lifecycleUpdates: unknown[] = [];
    const emailUpserts: Array<{ create: { role: string; matchEvidence: unknown } }> =
      [];
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({ id: "cand-q", lifecycle: "OPEN" })),
        update: vi.fn(async (args: unknown) => {
          lifecycleUpdates.push(args);
          return {};
        }),
      },
      emailMessage: {
        findFirst: vi.fn(async () => ({ id: "msg-q" })),
        findMany: vi.fn(async () => [
          { id: "msg-q", threadId: "th", classifications: [] },
        ]),
        update: vi.fn(),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async (args: { create: { role: string; matchEvidence: unknown } }) => {
          emailUpserts.push(args);
          return args;
        }),
      },
      bidQuoteStaging: {
        findFirst: vi.fn(async () => ({ id: "stg-1" })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      classification: { upsert: vi.fn(async () => ({})) },
    };

    await linkEmailToBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-q",
      emailMessageId: "msg-q",
      role: "QUOTE",
      userConfirmed: true,
      forceReassign: true,
    });

    expect(emailUpserts[0]!.create.role).toBe("QUOTE");
    expect(
      isUserConfirmedBidCandidateEmail(emailUpserts[0]!.create.matchEvidence)
    ).toBe(true);
    expect(lifecycleUpdates.length).toBe(1);
    expect(JSON.stringify(lifecycleUpdates[0])).toContain("QUOTED");
  });

  it("does not overwrite CONVERTED lifecycle on Quote link", async () => {
    const updates: unknown[] = [];
    const prisma = {
      bidCandidate: {
        findFirst: vi.fn(async () => ({
          id: "cand-c",
          lifecycle: "CONVERTED",
        })),
        update: vi.fn(async (args: unknown) => {
          updates.push(args);
          return {};
        }),
      },
      emailMessage: {
        findFirst: vi.fn(async () => ({ id: "msg-c" })),
        findMany: vi.fn(async () => [
          { id: "msg-c", threadId: "t", classifications: [] },
        ]),
        update: vi.fn(),
      },
      bidCandidateEmail: {
        findMany: vi.fn(async () => []),
        upsert: vi.fn(async () => ({})),
      },
      bidQuoteStaging: {
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      classification: { upsert: vi.fn(async () => ({})) },
    };

    await linkEmailToBidCandidate({
      prisma: prisma as never,
      workspaceId: "ws",
      candidateId: "cand-c",
      emailMessageId: "msg-c",
      role: "QUOTE",
      userConfirmed: true,
    });
    expect(updates).toHaveLength(0);
  });

  it("P/Q) With/Without Quote filters use durable evidence", () => {
    const withQ = bidCandidatesWorkspaceWhere({
      workspaceId: "ws",
      filter: { quote: "with" },
    });
    const withoutQ = bidCandidatesWorkspaceWhere({
      workspaceId: "ws",
      filter: { quote: "without" },
    });
    const withS = JSON.stringify(withQ);
    const withoutS = JSON.stringify(withoutQ);
    expect(withS).toContain("isDurable");
    expect(withS).toContain('"QUOTE"');
    expect(withoutS).toContain("NOT");
    expect(withoutS).toContain("isDurable");
  });

  it("R/T) Clear Analysis preserves EmailMessage + durable Quote links", async () => {
    const tx = {
      bidCandidate: { count: vi.fn(async () => 1), deleteMany: vi.fn() },
      bidQuoteStaging: {
        count: vi.fn(async () => 1),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      bidCandidateEmail: { deleteMany: vi.fn() },
      bidFolderDiscoveryEmail: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      bidAnalysisRun: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      emailMessage: { deleteMany: vi.fn() },
      classification: { deleteMany: vi.fn() },
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
    expect(tx.bidCandidateEmail.deleteMany).not.toHaveBeenCalled();
    expect(tx.emailMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.classification.deleteMany).not.toHaveBeenCalled();
  });

  it("N) user_confirmed evidence survives", () => {
    const ev = userConfirmedBidCandidateEmailEvidence("inbox_manual");
    expect(isUserConfirmedBidCandidateEmail(ev)).toBe(true);
  });

  it("W) historical Job(BIDDING) path untouched", () => {
    const src = readSrc("../interfaces/http/routes/bidding.route.ts");
    expect(src).toContain("ACTIVE_BID_STATUS");
    expect(src).toContain("/bidding/from-email");
  });
});
