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

    // Leaving Sent for Personal clears sentOnly
    expect(
      buildInboxMessageListFilters({
        inboxTab: "PERSONAL",
        readFilter: "unread",
      }).sentOnly
    ).toBeUndefined();
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
});
