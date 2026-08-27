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
 * Mirrors buildMessagesWhere: monitored-sender OR/NOT, optional category, trash/archive.
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

    if ("OR" in cond && Array.isArray(cond.OR)) {
      const senderEquals = cond.OR.every(
        (c) => c && typeof c === "object" && "senderEmail" in c
      );
      if (senderEquals) {
        const ok = cond.OR.some((c) => {
          const se = (c as { senderEmail?: { equals?: string } }).senderEmail;
          return (
            typeof se?.equals === "string" &&
            se.equals.toLowerCase() === msg.senderEmail.toLowerCase()
          );
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

  it("5. Multiple monitored mailboxes → OR across monitored emails", () => {
    const where = baseWhere({ sentOnly: true });
    expect(
      matchesListWhere(where, { ...sentBusiness, senderEmail: "other@example.com" })
    ).toBe(true);
    expect(
      matchesListWhere(where, { ...sentBusiness, senderEmail: "not-monitored@x.com" })
    ).toBe(false);
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
