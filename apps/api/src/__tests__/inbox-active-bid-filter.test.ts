import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { buildMessagesWhere } from "../interfaces/http/routes/inbox-read.route.js";
import {
  ACTIVE_BID_LIST_LIFECYCLES,
  emailLinkedToActiveBidCandidateWhere,
} from "../application/services/active-bid-candidate-membership.js";
import { bidCandidatesWorkspaceWhere } from "../application/services/list-bid-candidates.js";

const THRESHOLD = new Prisma.Decimal("0.75");
const here = import.meta.dirname;

function baseWhere(
  overrides: Partial<Parameters<typeof buildMessagesWhere>[0]> = {}
) {
  return buildMessagesWhere({
    workspaceId: "ws-1",
    inboxConnectionId: "conn-1",
    reviewOnly: false,
    lowConfidenceOnly: false,
    mailboxEmails: ["me@company.com"],
    classificationThreshold: THRESHOLD,
    taskThreshold: THRESHOLD,
    ...overrides,
  });
}

function serialized(where: ReturnType<typeof buildMessagesWhere>) {
  return JSON.stringify(where);
}

describe("Inbox Active Bid filter = BidCandidateEmail membership", () => {
  it("1. Bid Invites folder email with no BidCandidate link does not match", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      businessTypeKey: "BID_OPPORTUNITY",
    });
    const s = serialized(where);
    expect(s).not.toContain("discoveredInBidInvitesFolder");
    expect(s).toContain("bidCandidateEmails");
    expect(s).toContain('"some"');
  });

  it("2. BID_OPPORTUNITY subtype alone does not qualify", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      businessTypeKey: "BID_OPPORTUNITY",
    });
    const s = serialized(where);
    expect(s).not.toMatch(
      /"classifications":\{"some":\{"businessTypeKey":"BID_OPPORTUNITY"\}\}/
    );
    expect(s).not.toContain('"role":"BID_INVITE"');
  });

  it("3. Email linked to OPEN/QUOTED BidCandidate qualifies", () => {
    const pred = emailLinkedToActiveBidCandidateWhere("ws-1");
    expect(pred).toEqual({
      bidCandidateEmails: {
        some: {
          workspaceId: "ws-1",
          bidCandidate: {
            workspaceId: "ws-1",
            lifecycle: { in: ["OPEN", "QUOTED"] },
          },
        },
      },
    });
    const where = baseWhere({
      businessCategory: "BUSINESS",
      businessTypeKey: "BID_OPPORTUNITY",
    });
    expect(serialized(where)).toContain('"lifecycle":{"in":["OPEN","QUOTED"]}');
  });

  it("4. Assign to Active Bid uses BidCandidateEmail (same predicate)", () => {
    const src = readFileSync(
      join(here, "../application/services/link-email-to-bid-candidate.ts"),
      "utf8"
    );
    expect(src).toContain("bidCandidateEmail.upsert");
    const route = readFileSync(
      join(here, "../interfaces/http/routes/bid-candidates.route.ts"),
      "utf8"
    );
    expect(route).toContain("assign-email");
    expect(route).toContain("linkEmailToBidCandidate");
  });

  it("5. Create Bid links the source email via BidCandidateEmail", () => {
    const src = readFileSync(
      join(here, "../application/services/create-bid-candidate-from-email.ts"),
      "utf8"
    );
    expect(src).toContain("linkEmailToBidCandidate");
  });

  it("6. Removing the only qualifying Candidate link drops membership", () => {
    const pred = emailLinkedToActiveBidCandidateWhere("ws-1");
    expect(pred.bidCandidateEmails).toEqual(
      expect.objectContaining({ some: expect.any(Object) })
    );
    expect(JSON.stringify(pred)).not.toContain("discoveredInBidInvitesFolder");
  });

  it("7. Archived/lost/converted match Active Bids list default lifecycle", () => {
    expect([...ACTIVE_BID_LIST_LIFECYCLES]).toEqual(["OPEN", "QUOTED"]);
    const listWhere = bidCandidatesWorkspaceWhere({ workspaceId: "ws-1" });
    expect(JSON.stringify(listWhere)).toContain(
      '"lifecycle":{"in":["OPEN","QUOTED"]}'
    );
    expect(JSON.stringify(listWhere)).not.toContain("CONVERTED");
    expect(JSON.stringify(listWhere)).not.toContain("LOST");
    expect(JSON.stringify(listWhere)).not.toContain("ARCHIVED");
    const inbox = serialized(
      baseWhere({
        businessCategory: "BUSINESS",
        businessTypeKey: "BID_OPPORTUNITY",
      })
    );
    expect(inbox).toContain('"lifecycle":{"in":["OPEN","QUOTED"]}');
  });

  it("8–9. Predicate is in buildMessagesWhere used before findMany/count", () => {
    const route = readFileSync(
      join(here, "../interfaces/http/routes/inbox-read.route.ts"),
      "utf8"
    );
    expect(route).toContain("emailLinkedToActiveBidCandidateWhere");
    expect(route).toContain("const where = buildMessagesWhere(");
    expect(route).toContain("emailMessage.count({ where })");
    expect(route).toContain("emailMessage.findMany({");
  });

  it("10. Active Bid still ANDs unread, pinned, search, subtype-adjacent filters", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      businessTypeKey: "BID_OPPORTUNITY",
      unreadOnly: true,
      pinnedOnly: true,
      search: "stairway",
    });
    const and = where.AND as Array<Record<string, unknown>>;
    const s = serialized(where);
    expect(s).toContain("bidCandidateEmails");
    expect(and.some((c) => c && "isPinned" in c && c.isPinned === true)).toBe(
      true
    );
    expect(and.some((c) => c && "isRead" in c && c.isRead === false)).toBe(true);
    expect(s).toContain("stairway");
  });

  it("11. Nested some does not duplicate EmailMessage rows", () => {
    const pred = emailLinkedToActiveBidCandidateWhere("ws-1");
    const link = pred.bidCandidateEmails as { some: unknown };
    expect(link.some).toBeDefined();
    expect(pred).not.toHaveProperty("OR");
  });
});
