import { describe, expect, it } from "vitest";
import {
  buildMailboxReclassifyWhere,
  MAILBOX_RECLASSIFY_ENQUEUE_BATCH,
  type MailboxReclassifyFilters,
} from "../mailbox-reclassify-filters.js";

function whereOf(filters: MailboxReclassifyFilters, messageIds?: string[]) {
  return buildMailboxReclassifyWhere({
    workspaceId: "ws1",
    inboxConnectionId: "c1",
    mailboxEmail: "ed@forgeops.com",
    filters,
    ...(messageIds ? { messageIds } : {}),
  });
}

function flattenAnd(where: ReturnType<typeof whereOf>) {
  const and = where.AND;
  return Array.isArray(and) ? and : [];
}

describe("buildMailboxReclassifyWhere", () => {
  it("scopes to workspace + mailbox and excludes archived", () => {
    const and = flattenAnd(whereOf({}));
    expect(and[0]).toMatchObject({
      workspaceId: "ws1",
      inboxConnectionId: "c1",
      isArchived: false,
    });
  });

  it("filters BUSINESS / PERSONAL / UNCLASSIFIED / FAILED", () => {
    expect(flattenAnd(whereOf({ category: "BUSINESS" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mailboxCategory: "BUSINESS",
          classifications: { some: {} },
        }),
      ])
    );
    expect(flattenAnd(whereOf({ category: "PERSONAL" }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mailboxCategory: "PERSONAL" }),
      ])
    );
    expect(flattenAnd(whereOf({ category: "UNCLASSIFIED" }))).toEqual(
      expect.arrayContaining([{ classifications: { none: {} } }])
    );
    expect(flattenAnd(whereOf({ category: "FAILED" }))).toEqual(
      expect.arrayContaining([{ classificationStatus: "FAILED" }])
    );
  });

  it("ORs subtypes within AND composition", () => {
    const and = flattenAnd(
      whereOf({
        category: "BUSINESS",
        businessTypeKeys: ["RFI_CLARIFICATION", "SUBMITTAL_SHOP_DRAWING"],
      })
    );
    expect(and).toEqual(
      expect.arrayContaining([
        {
          classifications: {
            some: { businessTypeKey: { in: ["RFI_CLARIFICATION", "SUBMITTAL_SHOP_DRAWING"] } },
          },
        },
      ])
    );
  });

  it("filters sender contains / equals", () => {
    expect(
      flattenAnd(whereOf({ senderContains: "@customer.com" }))
    ).toEqual(
      expect.arrayContaining([
        {
          senderEmail: {
            contains: "@customer.com",
            mode: "insensitive",
          },
        },
      ])
    );
    expect(
      flattenAnd(whereOf({ senderEmailEquals: "a@b.com" }))
    ).toEqual(
      expect.arrayContaining([
        {
          senderEmail: { equals: "a@b.com", mode: "insensitive" },
        },
      ])
    );
  });

  it("filters read / unread", () => {
    expect(flattenAnd(whereOf({ readStatus: "READ" }))).toEqual(
      expect.arrayContaining([{ isRead: true }])
    );
    expect(flattenAnd(whereOf({ readStatus: "UNREAD" }))).toEqual(
      expect.arrayContaining([{ isRead: false }])
    );
  });

  it("filters sent / received by mailbox email", () => {
    expect(flattenAnd(whereOf({ direction: "SENT" }))).toEqual(
      expect.arrayContaining([
        {
          senderEmail: {
            equals: "ed@forgeops.com",
            mode: "insensitive",
          },
        },
      ])
    );
    const received = flattenAnd(whereOf({ direction: "RECEIVED" }));
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          senderEmail: expect.objectContaining({
            not: "ed@forgeops.com",
          }),
        }),
      ])
    );
  });

  it("maps UI NORMAL priority to stored MEDIUM", () => {
    expect(
      flattenAnd(whereOf({ priorities: ["NORMAL", "HIGH"] }))
    ).toEqual(
      expect.arrayContaining([
        { priority: { in: ["MEDIUM", "HIGH"] } },
      ])
    );
  });

  it("filters job scope and specific job", () => {
    expect(flattenAnd(whereOf({ jobScope: "HAS_JOB" }))).toEqual(
      expect.arrayContaining([{ jobId: { not: null } }])
    );
    expect(flattenAnd(whereOf({ jobScope: "NO_JOB" }))).toEqual(
      expect.arrayContaining([{ jobId: null }])
    );
    expect(
      flattenAnd(whereOf({ jobScope: "SPECIFIC", jobId: "job_1" }))
    ).toEqual(expect.arrayContaining([{ jobId: "job_1" }]));
  });

  it("distinguishes processingStatus NULL from Unclassified category", () => {
    const nullProc = flattenAnd(whereOf({ processingStatus: "NULL" }));
    expect(nullProc).toEqual(
      expect.arrayContaining([{ classificationStatus: null }])
    );
    expect(nullProc).not.toEqual(
      expect.arrayContaining([{ classifications: { none: {} } }])
    );

    const unclassified = flattenAnd(whereOf({ category: "UNCLASSIFIED" }));
    expect(unclassified).toEqual(
      expect.arrayContaining([{ classifications: { none: {} } }])
    );
    expect(unclassified).not.toEqual(
      expect.arrayContaining([{ classificationStatus: null }])
    );
  });

  it("intersects messageIds with filters", () => {
    expect(flattenAnd(whereOf({ category: "FAILED" }, ["m1", "m2"]))).toEqual(
      expect.arrayContaining([
        { id: { in: ["m1", "m2"] } },
        { classificationStatus: "FAILED" },
      ])
    );
  });

  it("composes combined filters with AND", () => {
    const and = flattenAnd(
      whereOf({
        category: "BUSINESS",
        businessTypeKeys: ["RFI_CLARIFICATION"],
        readStatus: "UNREAD",
        direction: "RECEIVED",
        priorities: ["HIGH", "URGENT"],
        senderContains: "@customer.com",
        processingStatus: "CLASSIFIED",
        jobScope: "HAS_JOB",
      })
    );
    expect(and.length).toBeGreaterThanOrEqual(8);
    expect(MAILBOX_RECLASSIFY_ENQUEUE_BATCH).toBe(50);
  });

  it("applies date range bounds for TODAY", () => {
    const and = flattenAnd(
      whereOf({ dateRange: "TODAY", timezone: "America/Chicago" })
    );
    const dateClause = and.find(
      (c) => c && typeof c === "object" && "OR" in c
    ) as { OR: unknown[] } | undefined;
    expect(dateClause?.OR?.length).toBe(2);
  });
});
