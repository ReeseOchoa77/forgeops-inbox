import { describe, expect, it } from "vitest";
import { buildInboxMessageListFilters } from "./inbox-message-list-filters";
import { inboxListQueryKey } from "./inbox-list-query";

describe("buildInboxMessageListFilters — Sent composes with other filters", () => {
  it("1. Sent + All Business → sentOnly + BUSINESS (all subtypes)", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "sent",
    });
    expect(f).toEqual({ sentOnly: true, businessCategory: "BUSINESS" });
  });

  it("2. Sent + Business excludes Personal param (BUSINESS only)", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "sent",
    });
    expect(f.businessCategory).toBe("BUSINESS");
    expect(f.sentOnly).toBe(true);
  });

  it("3. Sent + Personal → sentOnly + NON_BUSINESS", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PERSONAL",
        readFilter: "sent",
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "NON_BUSINESS",
    });
  });

  it("4. Sent + each business type group sets businessTypeGroup", () => {
    for (const group of [
      "BIDS_ESTIMATING",
      "PROJECTS",
      "PURCHASING",
      "ACCOUNTING",
      "INTERNAL",
      "OTHER",
    ] as const) {
      expect(
        buildInboxMessageListFilters({
          inboxTab: group,
          readFilter: "sent",
        })
      ).toEqual({
        sentOnly: true,
        businessCategory: "BUSINESS",
        businessTypeGroup: group,
      });
    }
  });

  it("5. Sent + Pinned → sentOnly + pinnedOnly (+ tab category)", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        pinnedOnly: true,
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      pinnedOnly: true,
    });
  });

  it("6. Sent + No job → jobId=unassigned", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        jobFilter: "unassigned",
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      jobId: "unassigned",
    });
  });

  it("7. Sent + Job → jobId preserved", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PROJECTS",
        readFilter: "sent",
        jobFilter: "job-9",
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      businessTypeGroup: "PROJECTS",
      jobId: "job-9",
    });
  });

  it("8. Sent + date range composes", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        dateRange: "WEEK",
        timezone: "America/Chicago",
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      dateRange: "WEEK",
      timezone: "America/Chicago",
    });
  });

  it("9. Sent + Business + Pinned + This week uses AND of all", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        pinnedOnly: true,
        dateRange: "WEEK",
        timezone: "UTC",
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      pinnedOnly: true,
      dateRange: "WEEK",
      timezone: "UTC",
    });
  });

  it("10. Sent + search composes", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        activeSearch: "mortenson",
        searchIn: "sender",
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      search: "mortenson",
      searchIn: "sender",
    });
  });

  it("11. Sent + Unclassified → sentOnly + unclassifiedOnly", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "sent",
      })
    ).toEqual({ sentOnly: true, unclassifiedOnly: true });
  });

  it("12. Sent + Exclude groups on Business tab", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        excludeBusinessTypeGroups: ["OTHER"],
      })
    ).toEqual({
      sentOnly: true,
      businessCategory: "BUSINESS",
      excludeBusinessTypeGroups: ["OTHER"],
    });
  });

  it("13. query/cache identity distinguishes Sent filter combinations", () => {
    const sentBusiness = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "sent",
    });
    const sentPersonal = buildInboxMessageListFilters({
      inboxTab: "PERSONAL",
      readFilter: "sent",
    });
    const sentBids = buildInboxMessageListFilters({
      inboxTab: "BIDS_ESTIMATING",
      readFilter: "sent",
    });
    const sentPinned = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "sent",
      pinnedOnly: true,
    });
    const keys = [
      inboxListQueryKey(sentBusiness),
      inboxListQueryKey(sentPersonal),
      inboxListQueryKey(sentBids),
      inboxListQueryKey(sentPinned),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toContain("sent");
    expect(keys[0]).toContain("BUSINESS");
    expect(keys[1]).toContain("NON_BUSINESS");
    expect(keys[2]).toContain("BIDS_ESTIMATING");
    expect(keys[3]).toContain("pinned");
  });

  it("14. Received / All mail (non-sent) still omit sentOnly", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
      }).sentOnly
    ).toBeUndefined();
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "unread",
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      unreadOnly: true,
    });
  });

  it("Business without Sent still sets BUSINESS only", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
    });
    expect(f.businessCategory).toBe("BUSINESS");
    expect(f.sentOnly).toBeUndefined();
  });

  it("Personal without Sent omits sentOnly", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PERSONAL",
        readFilter: "",
      })
    ).toEqual({ businessCategory: "NON_BUSINESS" });
  });

  it("Unread on Business tab sets unreadOnly with BUSINESS category", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "unread",
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      unreadOnly: true,
    });
  });

  it("Any job filter sends jobId=assigned", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        jobFilter: "assigned",
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      jobId: "assigned",
    });
  });

  it("No job combines with Unread + This week", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "unread",
        dateRange: "WEEK",
        timezone: "UTC",
        jobFilter: "unassigned",
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      unreadOnly: true,
      dateRange: "WEEK",
      timezone: "UTC",
      jobId: "unassigned",
    });
  });

  it("All Jobs clears job filter (empty jobFilter omits jobId)", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        jobFilter: "",
      })
    ).not.toHaveProperty("jobId");
  });

  it("Trash unchanged", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "TRASH",
        readFilter: "",
      })
    ).toEqual({ category: "trash" });
  });

  it("Unclassified: unclassifiedOnly=true, no businessCategory", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "",
      })
    ).toEqual({ unclassifiedOnly: true });

    expect(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "unread",
      })
    ).toEqual({ unclassifiedOnly: true, unreadOnly: true });
  });

  it("Email ID search ignores tab filters and uses searchIn=id", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        jobFilter: "job1",
        activeSearch: "clmsg123",
        searchIn: "id",
      })
    ).toEqual({
      search: "clmsg123",
      searchIn: "id",
    });
  });

  it("Exclude groups apply on Business, not Personal/Unclassified", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        excludeBusinessTypeGroups: ["BIDS_ESTIMATING", "OTHER"],
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      excludeBusinessTypeGroups: ["BIDS_ESTIMATING", "OTHER"],
    });

    expect(
      buildInboxMessageListFilters({
        inboxTab: "PERSONAL",
        readFilter: "",
        excludeBusinessTypeGroups: ["BIDS_ESTIMATING"],
      }).excludeBusinessTypeGroups
    ).toBeUndefined();

    expect(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "",
        excludeBusinessTypeGroups: ["OTHER"],
      }).excludeBusinessTypeGroups
    ).toBeUndefined();
  });
});
