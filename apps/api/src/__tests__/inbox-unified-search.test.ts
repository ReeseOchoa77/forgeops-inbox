import { describe, expect, it } from "vitest";
import { buildUnifiedInboxSearchOr } from "../application/services/inbox-unified-search.js";
import { buildMessagesWhere } from "../interfaces/http/routes/inbox-read.route.js";
import { Prisma } from "@prisma/client";

const THRESHOLD = new Prisma.Decimal("0.75");

function baseWhere(overrides: Partial<Parameters<typeof buildMessagesWhere>[0]> = {}) {
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

function searchOrFromWhere(where: ReturnType<typeof buildMessagesWhere>) {
  const and = where.AND as Array<Record<string, unknown>>;
  return and.find(
    (c) =>
      c &&
      "OR" in c &&
      Array.isArray(c.OR) &&
      (c.OR as object[]).some((o) => o && "bodyText" in o)
  ) as { OR: object[] } | undefined;
}

describe("unified Inbox search", () => {
  it("OR includes sender, To/Cc JSON, subject, snippet, body, normalized body", () => {
    const pred = buildUnifiedInboxSearchOr("Anchor Bolts");
    const serialized = JSON.stringify(pred);
    expect(serialized).toContain('"senderEmail"');
    expect(serialized).toContain('"senderName"');
    expect(serialized).toContain('"subject"');
    expect(serialized).toContain('"snippet"');
    expect(serialized).toContain('"bodyText"');
    expect(serialized).toContain('"toAddresses"');
    expect(serialized).toContain('"ccAddresses"');
    expect(serialized).toContain('"string_contains"');
    expect(serialized).toContain('"cleanTextBody"');
    expect(serialized).toContain("Anchor Bolts");
    expect(serialized).toContain("anchor bolts");
    // Must be a single OR — not AND of sender+content.
    expect(pred.OR).toBeDefined();
    expect(Array.isArray(pred.OR)).toBe(true);
    expect((pred.OR as object[]).length).toBeGreaterThan(5);
  });

  it("critical: email address search does not require body match (OR not AND)", () => {
    const pred = buildUnifiedInboxSearchOr("estimating@company.com");
    const or = pred.OR as object[];
    const hasSender = or.some((o) => o && "senderEmail" in o);
    const hasBody = or.some((o) => o && "bodyText" in o);
    const hasTo = or.some((o) => o && "toAddresses" in o);
    expect(hasSender && hasBody && hasTo).toBe(true);
    expect(pred).not.toHaveProperty("AND");
  });

  it("critical: content search does not require sender match", () => {
    const pred = buildUnifiedInboxSearchOr("anchor bolts");
    expect(JSON.stringify(pred.OR)).toContain("bodyText");
    expect(JSON.stringify(pred.OR)).toContain("senderEmail");
    expect(Object.keys(pred)).toEqual(["OR"]);
  });

  it("searchIn=sender is ignored — still unified OR", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      search: "mortenson",
      searchIn: "sender",
    });
    const searchOr = searchOrFromWhere(where);
    expect(searchOr).toBeDefined();
    const serialized = JSON.stringify(searchOr);
    expect(serialized).toContain("bodyText");
    expect(serialized).toContain("toAddresses");
    expect(serialized).toContain("senderEmail");
  });

  it("Sent + search ANDs direction with unified OR", () => {
    const where = baseWhere({
      sentOnly: true,
      businessCategory: "BUSINESS",
      search: "john@customer.com",
    });
    const serialized = JSON.stringify(where);
    expect(serialized).toContain('"direction":"SENT"');
    expect(serialized).toContain("toAddresses");
    expect(serialized).toContain("john@customer.com");
    const searchOr = searchOrFromWhere(where);
    expect(searchOr).toBeDefined();
  });

  it("Active Bid + search compose with AND", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      businessTypeKey: "BID_OPPORTUNITY",
      search: "stairs",
    });
    const serialized = JSON.stringify(where);
    expect(serialized).toContain("bidCandidateEmails");
    expect(serialized).not.toContain("discoveredInBidInvitesFolder");
    expect(serialized).toContain("stairs");
    expect(searchOrFromWhere(where)).toBeDefined();
  });

  it("Quote + Sent + search compose", () => {
    const where = baseWhere({
      sentOnly: true,
      businessCategory: "BUSINESS",
      businessTypeKey: "ESTIMATE_QUOTE",
      search: "Turner",
    });
    const serialized = JSON.stringify(where);
    expect(serialized).toContain('"direction":"SENT"');
    expect(serialized).toContain('"businessTypeKey":"ESTIMATE_QUOTE"');
    expect(serialized).toContain("Turner");
  });

  it("Pinned + Jobs + date + search compose", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      pinnedOnly: true,
      jobId: "job-1",
      receivedAfter: new Date("2026-08-01T00:00:00.000Z"),
      search: "abcsteel",
    });
    const and = where.AND as object[];
    expect(and.some((c) => c && "isPinned" in c)).toBe(true);
    expect(and.some((c) => c && "jobId" in c)).toBe(true);
    expect(searchOrFromWhere(where)).toBeDefined();
  });

  it("empty/whitespace search yields empty predicate object", () => {
    expect(buildUnifiedInboxSearchOr("   ")).toEqual({});
  });

  it("searchIn=id still exact-matches ids only", () => {
    const where = baseWhere({
      search: "clmsg123",
      searchIn: "id",
    });
    const serialized = JSON.stringify(where);
    expect(serialized).toContain('"id":"clmsg123"');
    expect(serialized).toContain("gmailMessageId");
    expect(serialized).not.toContain("bodyText");
    expect(serialized).not.toContain("toAddresses");
  });
});
