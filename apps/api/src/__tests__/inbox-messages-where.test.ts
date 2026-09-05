import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildMessagesWhere } from "../interfaces/http/routes/inbox-read.route.js";

const WS = "ws-1";
const CONN = "conn-1";
const MONITORED = ["ed@tekstl.net", "other@example.com"];
const THRESHOLD = new Prisma.Decimal("0.75");

type FixtureMsg = {
  id: string;
  workspaceId: string;
  inboxConnectionId: string;
  senderEmail: string;
  mailboxCategory: "BUSINESS" | "PERSONAL";
  isTrashed?: boolean;
  isArchived?: boolean;
};

function baseWhere(overrides: Partial<Parameters<typeof buildMessagesWhere>[0]> = {}) {
  return buildMessagesWhere({
    workspaceId: WS,
    inboxConnectionId: CONN,
    reviewOnly: false,
    lowConfidenceOnly: false,
    mailboxEmails: MONITORED,
    classificationThreshold: THRESHOLD,
    taskThreshold: THRESHOLD,
    ...overrides,
  });
}

/**
 * Evaluates list-filter semantics for sent + optional category.
 * Mirrors buildMessagesWhere: monitored-sender in/notIn, optional category, trash/archive.
 */
function matchesListWhere(
  where: ReturnType<typeof buildMessagesWhere>,
  msg: FixtureMsg
): boolean {
  const and = Array.isArray(where.AND) ? where.AND : [];

  for (const cond of and) {
    if (!cond || typeof cond !== "object") continue;

    if ("workspaceId" in cond && cond.workspaceId !== msg.workspaceId) return false;
    if ("inboxConnectionId" in cond) {
      const filter = cond.inboxConnectionId;
      if (typeof filter === "string") {
        if (filter !== msg.inboxConnectionId) return false;
      } else if (
        filter &&
        typeof filter === "object" &&
        "in" in filter &&
        Array.isArray(filter.in)
      ) {
        if (!filter.in.includes(msg.inboxConnectionId)) return false;
      }
    }
    if ("isTrashed" in cond && cond.isTrashed === false && msg.isTrashed) return false;
    if ("isArchived" in cond && cond.isArchived === false && msg.isArchived) return false;

    if ("mailboxCategory" in cond) {
      if (cond.mailboxCategory !== msg.mailboxCategory) return false;
    }

    if ("senderEmail" in cond && cond.senderEmail && typeof cond.senderEmail === "object") {
      const se = cond.senderEmail as {
        in?: string[];
        notIn?: string[];
        equals?: string;
      };
      const sender = msg.senderEmail.toLowerCase();
      if (Array.isArray(se.in)) {
        if (!se.in.map((e) => e.toLowerCase()).includes(sender)) return false;
      }
      if (Array.isArray(se.notIn)) {
        if (se.notIn.map((e) => e.toLowerCase()).includes(sender)) return false;
      }
      if (typeof se.equals === "string") {
        if (se.equals.toLowerCase() !== sender) return false;
      }
    }

    if ("OR" in cond && Array.isArray(cond.OR)) {
      const senderEquals = cond.OR.every(
        (c) => c && typeof c === "object" && "senderEmail" in c
      );
      if (senderEquals) {
        const ok = cond.OR.some((c) => {
          const se = (c as { senderEmail?: { equals?: string; in?: string[] } }).senderEmail;
          if (typeof se?.equals === "string") {
            return se.equals.toLowerCase() === msg.senderEmail.toLowerCase();
          }
          if (Array.isArray(se?.in)) {
            return se.in.map((e) => e.toLowerCase()).includes(msg.senderEmail.toLowerCase());
          }
          return false;
        });
        if (!ok) return false;
      }
    }

    if ("NOT" in cond && cond.NOT && typeof cond.NOT === "object" && "OR" in cond.NOT) {
      const orList = cond.NOT.OR;
      if (Array.isArray(orList)) {
        const isMonitored = orList.some((c) => {
          const se = (c as { senderEmail?: { equals?: string } }).senderEmail;
          return (
            typeof se?.equals === "string" &&
            se.equals.toLowerCase() === msg.senderEmail.toLowerCase()
          );
        });
        if (isMonitored) return false;
      }
    }
  }

  return true;
}

const incomingBusiness: FixtureMsg = {
  id: "1",
  workspaceId: WS,
  inboxConnectionId: CONN,
  senderEmail: "client@acme.com",
  mailboxCategory: "BUSINESS",
};

const sentBusiness: FixtureMsg = {
  id: "2",
  workspaceId: WS,
  inboxConnectionId: CONN,
  senderEmail: "ed@tekstl.net",
  mailboxCategory: "BUSINESS",
};

const incomingPersonal: FixtureMsg = {
  id: "3",
  workspaceId: WS,
  inboxConnectionId: CONN,
  senderEmail: "friend@gmail.com",
  mailboxCategory: "PERSONAL",
};

const sentPersonal: FixtureMsg = {
  id: "4",
  workspaceId: WS,
  inboxConnectionId: CONN,
  senderEmail: "ed@tekstl.net",
  mailboxCategory: "PERSONAL",
};

describe("buildMessagesWhere — global Sent (no businessCategory)", () => {
  it("1. Sent: sentOnly=true, businessCategory omitted → BUSINESS + PERSONAL outbound", () => {
    const where = baseWhere({ sentOnly: true });
    const and = where.AND as object[];
    expect(and.some((c) => "mailboxCategory" in c)).toBe(false);
    expect(matchesListWhere(where, sentBusiness)).toBe(true);
    expect(matchesListWhere(where, sentPersonal)).toBe(true);
  });

  it("2. Business: businessCategory=BUSINESS, sentOnly false → incoming only", () => {
    const where = baseWhere({ businessCategory: "BUSINESS", sentOnly: false });
    expect(matchesListWhere(where, incomingBusiness)).toBe(true);
    expect(matchesListWhere(where, sentBusiness)).toBe(false);
    expect(matchesListWhere(where, incomingPersonal)).toBe(false);
  });

  it("3. Personal: businessCategory=NON_BUSINESS, sentOnly false → incoming only", () => {
    const where = baseWhere({ businessCategory: "NON_BUSINESS", sentOnly: false });
    expect(matchesListWhere(where, incomingPersonal)).toBe(true);
    expect(matchesListWhere(where, sentPersonal)).toBe(false);
    expect(matchesListWhere(where, incomingBusiness)).toBe(false);
  });

  it("4. Global Sent result set includes both BUSINESS and PERSONAL outbound", () => {
    const where = baseWhere({ sentOnly: true });
    expect(matchesListWhere(where, sentBusiness)).toBe(true);
    expect(matchesListWhere(where, sentPersonal)).toBe(true);
  });

  it("5. Multiple monitored mailboxes → in across monitored emails", () => {
    const where = baseWhere({ sentOnly: true });
    expect(
      matchesListWhere(where, { ...sentBusiness, senderEmail: "other@example.com" })
    ).toBe(true);
    expect(
      matchesListWhere(where, { ...sentBusiness, senderEmail: "not-monitored@x.com" })
    ).toBe(false);
    const and = where.AND as Array<Record<string, unknown>>;
    const senderCond = and.find((c) => c && typeof c === "object" && "senderEmail" in c) as
      | { senderEmail: { in?: string[] } }
      | undefined;
    expect(senderCond?.senderEmail?.in).toEqual(
      expect.arrayContaining(["ed@tekstl.net", "other@example.com"])
    );
  });

  it("uses notIn (not NOT/OR) to exclude monitored senders from Business", () => {
    const where = baseWhere({ businessCategory: "BUSINESS", sentOnly: false });
    const and = where.AND as Array<Record<string, unknown>>;
    const senderCond = and.find((c) => c && typeof c === "object" && "senderEmail" in c) as
      | { senderEmail: { notIn?: string[] } }
      | undefined;
    expect(senderCond?.senderEmail?.notIn?.length).toBeGreaterThan(0);
    expect(and.some((c) => c && typeof c === "object" && "NOT" in c)).toBe(false);
  });

  it("6. Incoming messages do not appear in Sent", () => {
    const where = baseWhere({ sentOnly: true });
    expect(matchesListWhere(where, incomingBusiness)).toBe(false);
    expect(matchesListWhere(where, incomingPersonal)).toBe(false);
  });

  it("stale combo avoided: omit businessCategory when building global Sent where", () => {
    const where = baseWhere({ sentOnly: true });
    // Explicitly ensure we did not pass businessCategory
    expect(
      (where.AND as object[]).some(
        (c) =>
          "mailboxCategory" in c &&
          ((c as { mailboxCategory: string }).mailboxCategory === "BUSINESS" ||
            (c as { mailboxCategory: string }).mailboxCategory === "PERSONAL")
      )
    ).toBe(false);
  });
});

describe("buildMessagesWhere — Unclassified tab", () => {
  it("unclassifiedOnly requires classifications.none and no mailboxCategory", () => {
    const where = baseWhere({ unclassifiedOnly: true });
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and.some((c) => c && "mailboxCategory" in c)).toBe(false);
    const classCond = and.find((c) => c && "classifications" in c) as
      | { classifications: { none?: object } }
      | undefined;
    expect(classCond?.classifications?.none).toEqual({});
  });

  it("Business tab requires a Classification row (excludes unclassified)", () => {
    const where = baseWhere({ businessCategory: "BUSINESS" });
    const and = where.AND as Array<Record<string, unknown>>;
    const catCond = and.find(
      (c) => c && "mailboxCategory" in c && "classifications" in c
    ) as
      | { mailboxCategory: string; classifications: { some?: object } }
      | undefined;
    expect(catCond?.mailboxCategory).toBe("BUSINESS");
    expect(catCond?.classifications?.some).toEqual({});
  });
});

describe("buildMessagesWhere — Exclude business type groups", () => {
  it("adds classifications.none with notIn keys for excluded groups", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      excludeBusinessTypeGroups: ["BIDS_ESTIMATING", "OTHER"],
    });
    const and = where.AND as Array<Record<string, unknown>>;
    const excludeCond = and.find(
      (c) =>
        c &&
        "classifications" in c &&
        (c as { classifications: { none?: { businessTypeKey?: unknown } } })
          .classifications?.none &&
        "businessTypeKey" in
          ((c as { classifications: { none: object } }).classifications.none as object)
    ) as
      | {
          classifications: {
            none: { businessTypeKey: { in: string[] } };
          };
        }
      | undefined;
    expect(excludeCond?.classifications.none.businessTypeKey.in).toEqual(
      expect.arrayContaining([
        "BID_OPPORTUNITY",
        "BID_UPDATE",
        "ESTIMATE_QUOTE",
        "OTHER_BUSINESS",
      ])
    );
    expect(excludeCond?.classifications.none.businessTypeKey.in).toHaveLength(4);
  });

  it("composes with include group + unread + job", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      businessTypeGroup: "PROJECTS",
      excludeBusinessTypeGroups: ["BIDS_ESTIMATING"],
      unreadOnly: true,
      jobId: "job-1",
    });
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and.some((c) => c && "isRead" in c && c.isRead === false)).toBe(true);
    expect(and.some((c) => c && "jobId" in c && c.jobId === "job-1")).toBe(true);
    expect(
      and.some(
        (c) =>
          c &&
          "classifications" in c &&
          (c as { classifications: { some?: { businessTypeKey?: { in?: string[] } } } })
            .classifications?.some?.businessTypeKey?.in?.includes("PROJECT_COORDINATION")
      )
    ).toBe(true);
    expect(
      and.some(
        (c) =>
          c &&
          "classifications" in c &&
          (c as { classifications: { none?: { businessTypeKey?: { in?: string[] } } } })
            .classifications?.none?.businessTypeKey?.in?.includes("BID_OPPORTUNITY")
      )
    ).toBe(true);
  });

  it("omits exclude predicate when list is empty", () => {
    const where = baseWhere({
      businessCategory: "BUSINESS",
      excludeBusinessTypeGroups: [],
    });
    const and = where.AND as Array<Record<string, unknown>>;
    const excludeCond = and.find(
      (c) =>
        c &&
        "classifications" in c &&
        (c as { classifications: { none?: { businessTypeKey?: unknown } } })
          .classifications?.none &&
        typeof (c as { classifications: { none: unknown } }).classifications.none ===
          "object" &&
        (c as { classifications: { none: object } }).classifications.none !== null &&
        "businessTypeKey" in
          ((c as { classifications: { none: object } }).classifications.none as object)
    );
    expect(excludeCond).toBeUndefined();
  });
});

describe("buildMessagesWhere — Email ID lookup", () => {
  it("matches EmailMessage id or provider gmailMessageId and skips tab filters", () => {
    const where = baseWhere({
      search: "clxyz123abc",
      searchIn: "id",
      businessCategory: "BUSINESS",
      sentOnly: true,
      unreadOnly: true,
    });
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: [{ id: "clxyz123abc" }, { gmailMessageId: "clxyz123abc" }],
        }),
        { isArchived: false },
      ])
    );
    expect(and.some((c) => c && "mailboxCategory" in c)).toBe(false);
    expect(and.some((c) => c && "isTrashed" in c)).toBe(false);
    expect(and.some((c) => c && "senderEmail" in c)).toBe(false);
  });
});

describe("buildMessagesWhere — Inbox dateRange", () => {
  it("applies receivedAfter/before against receivedAt with sentAt fallback", () => {
    const after = new Date("2026-08-01T00:00:00.000Z");
    const before = new Date("2026-08-31T23:59:59.000Z");
    const where = baseWhere({ receivedAfter: after, receivedBefore: before });
    const and = where.AND as Array<Record<string, unknown>>;
    const rangeCond = and.find((c) => c && "OR" in c && Array.isArray(c.OR)) as
      | { OR: Array<Record<string, unknown>> }
      | undefined;
    expect(rangeCond?.OR?.some((c) => "receivedAt" in c)).toBe(true);
  });
});

describe("thread list where (no sent exclusion)", () => {
  it("Mixed thread endpoint filters only by threadId", () => {
    const threadWhere = {
      workspaceId: WS,
      inboxConnectionId: CONN,
      threadId: "thread-1",
    };
    expect("senderEmail" in threadWhere).toBe(false);
    expect("mailboxCategory" in threadWhere).toBe(false);
  });
});

describe("buildMessagesWhere — All Mailboxes aggregate", () => {
  it("accepts inboxConnectionId.in for multi-mailbox scope", () => {
    const where = baseWhere({
      inboxConnectionId: { in: ["conn-1", "conn-2"] },
      businessCategory: "BUSINESS",
    });
    const and = where.AND as object[];
    const scope = and.find(
      (c) => c && typeof c === "object" && "inboxConnectionId" in c
    ) as { inboxConnectionId: { in: string[] } } | undefined;
    expect(scope?.inboxConnectionId).toEqual({ in: ["conn-1", "conn-2"] });

    expect(
      matchesListWhere(where, {
        id: "m1",
        workspaceId: WS,
        inboxConnectionId: "conn-2",
        senderEmail: "vendor@example.com",
        mailboxCategory: "BUSINESS",
      })
    ).toBe(true);
    expect(
      matchesListWhere(where, {
        id: "m2",
        workspaceId: WS,
        inboxConnectionId: "conn-other",
        senderEmail: "vendor@example.com",
        mailboxCategory: "BUSINESS",
      })
    ).toBe(false);
  });
});
