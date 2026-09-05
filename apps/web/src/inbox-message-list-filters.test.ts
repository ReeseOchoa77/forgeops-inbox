import { describe, expect, it } from "vitest";
import { buildInboxMessageListFilters } from "./inbox-message-list-filters";

describe("buildInboxMessageListFilters — global Sent", () => {
  it("1. Sent filter: sentOnly=true, businessCategory omitted", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "sent",
    });
    expect(f).toEqual({ sentOnly: true });
    expect(f.businessCategory).toBeUndefined();
  });

  it("2. Business: businessCategory=BUSINESS, sentOnly omitted", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
    });
    expect(f.businessCategory).toBe("BUSINESS");
    expect(f.sentOnly).toBeUndefined();
  });

  it("3. Personal: businessCategory=NON_BUSINESS, sentOnly omitted", () => {
    const f = buildInboxMessageListFilters({
      inboxTab: "PERSONAL",
      readFilter: "",
    });
    expect(f.businessCategory).toBe("NON_BUSINESS");
    expect(f.sentOnly).toBeUndefined();
  });

  it("7. Switching: Sent ignores stale Business/Personal tab state", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PERSONAL",
        readFilter: "sent",
      })
    ).toEqual({ sentOnly: true });

    expect(
      buildInboxMessageListFilters({
        inboxTab: "PROJECTS",
        readFilter: "sent",
        jobFilter: "job-1",
      })
    ).toEqual({ sentOnly: true });

    // Leaving Sent for Business clears sentOnly
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
      }).sentOnly
    ).toBeUndefined();

    // Leaving Sent for Personal clears sentOnly; unread is server-side
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PERSONAL",
        readFilter: "unread",
      })
    ).toEqual({
      businessCategory: "NON_BUSINESS",
      unreadOnly: true,
    });
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

  it("Business subtype + job only apply when not Sent", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PROJECTS",
        readFilter: "",
        jobFilter: "job-9",
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      businessTypeGroup: "PROJECTS",
      jobId: "job-9",
    });
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

  it("Sent still wins over Unclassified tab", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "sent",
      })
    ).toEqual({ sentOnly: true });
  });

  it("Email ID search ignores tab filters and uses searchIn=id", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "unread",
        jobFilter: "job1",
        activeSearch: "clmsg123",
        searchIn: "id",
      })
    ).toEqual({
      search: "clmsg123",
      searchIn: "id",
    });
  });

  it("dateRange + timezone compose with Business and Unclassified", () => {
    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        dateRange: "TODAY",
        timezone: "America/Chicago",
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      dateRange: "TODAY",
      timezone: "America/Chicago",
    });

    expect(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "unread",
        dateRange: "WEEK",
        timezone: "UTC",
      })
    ).toEqual({
      unclassifiedOnly: true,
      unreadOnly: true,
      dateRange: "WEEK",
      timezone: "UTC",
    });
  });

  it("Exclude groups apply on Business, not Personal/Unclassified/Sent", () => {
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
        inboxTab: "PROJECTS",
        readFilter: "unread",
        jobFilter: "job-1",
        excludeBusinessTypeGroups: ["OTHER"],
      })
    ).toEqual({
      businessCategory: "BUSINESS",
      businessTypeGroup: "PROJECTS",
      jobId: "job-1",
      unreadOnly: true,
      excludeBusinessTypeGroups: ["OTHER"],
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

    expect(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "sent",
        excludeBusinessTypeGroups: ["OTHER"],
      })
    ).toEqual({ sentOnly: true });
  });
});
