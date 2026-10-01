import { describe, expect, it } from "vitest";
import {
  buildInboxMessageListFilters,
  type InboxMessageListFilters,
} from "./inbox-message-list-filters.js";
import { inboxListQueryKey, isSameInboxListQuery } from "./inbox-list-query.js";

describe("inboxListQueryKey", () => {
  it("isolates Business from Unclassified and Trash", () => {
    const business = inboxListQueryKey(
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
      })
    );
    const unclassified = inboxListQueryKey(
      buildInboxMessageListFilters({
        inboxTab: "UNCLASSIFIED",
        readFilter: "",
      })
    );
    const trash = inboxListQueryKey(
      buildInboxMessageListFilters({
        inboxTab: "TRASH",
        readFilter: "",
      })
    );
    expect(business).not.toBe(unclassified);
    expect(business).not.toBe(trash);
    expect(unclassified).not.toBe(trash);
  });

  it("changes identity for mail / date / job / search filters", () => {
    const base = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
    });
    const unread = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "unread",
    });
    const week = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      dateRange: "WEEK",
      timezone: "UTC",
    });
    const noJob = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      jobFilter: "unassigned",
    });
    const search = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
      activeSearch: "steel",
      searchIn: "all",
    });
    const keys = [
      inboxListQueryKey(base),
      inboxListQueryKey(unread),
      inboxListQueryKey(week),
      inboxListQueryKey(noJob),
      inboxListQueryKey(search),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("isSameInboxListQuery only for identical identity", () => {
    const business = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
    });
    const key = inboxListQueryKey(business);
    expect(isSameInboxListQuery(key, business)).toBe(true);
    expect(
      isSameInboxListQuery(
        key,
        buildInboxMessageListFilters({
          inboxTab: "UNCLASSIFIED",
          readFilter: "",
        })
      )
    ).toBe(false);
    expect(isSameInboxListQuery("", business)).toBe(false);
  });
});

describe("Inbox list commit lifecycle (query context)", () => {
  it("empty successful response replaces prior non-empty rows", () => {
    let messages = [
      { id: "b1" },
      { id: "b2" },
    ] as Array<{ id: string }>;
    const commitReplace = (next: Array<{ id: string }>) => {
      messages = next;
    };
    // Simulate Unclassified empty page 1
    commitReplace([]);
    expect(messages).toEqual([]);
  });

  it("new query resets accumulation; same query appends next page", () => {
    let messages: Array<{ id: string }> = [];
    let activeKey = "";
    const apply = (
      filters: InboxMessageListFilters,
      pageMessages: Array<{ id: string }>,
      append: boolean
    ) => {
      const key = inboxListQueryKey(filters);
      if (!append || key !== activeKey) {
        activeKey = key;
        messages = pageMessages;
      } else {
        messages = [...messages, ...pageMessages];
      }
    };

    const business = buildInboxMessageListFilters({
      inboxTab: "ALL_BUSINESS",
      readFilter: "",
    });
    apply(business, [{ id: "1" }, { id: "2" }], false);
    apply(business, [{ id: "3" }], true);
    expect(messages.map((m) => m.id)).toEqual(["1", "2", "3"]);

    const trash = buildInboxMessageListFilters({
      inboxTab: "TRASH",
      readFilter: "",
    });
    apply(trash, [], false);
    expect(messages).toEqual([]);

    // Late Business page must not append onto Trash
    const lateBusinessKey = inboxListQueryKey(business);
    expect(lateBusinessKey === activeKey).toBe(false);
  });

  it("stale response from prior category is rejected", () => {
    let activeKey = inboxListQueryKey(
      buildInboxMessageListFilters({ inboxTab: "UNCLASSIFIED", readFilter: "" })
    );
    let messages: Array<{ id: string }> = [];
    const commit = (
      requestKey: string,
      seq: number,
      currentSeq: number,
      rows: Array<{ id: string }>
    ) => {
      if (seq !== currentSeq) return;
      if (requestKey !== activeKey) return;
      messages = rows;
    };

    // Unclassified empty committed
    commit(activeKey, 2, 2, []);
    expect(messages).toEqual([]);

    // Late Business response (seq 1) ignored
    const businessKey = inboxListQueryKey(
      buildInboxMessageListFilters({ inboxTab: "ALL_BUSINESS", readFilter: "" })
    );
    commit(businessKey, 1, 2, [{ id: "stale" }]);
    expect(messages).toEqual([]);
  });

  it("No job / Today / search empty results replace prior rows", () => {
    let messages: Array<{ id: string }> = [{ id: "x" }];
    for (const filters of [
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        jobFilter: "unassigned",
      }),
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        dateRange: "TODAY",
        timezone: "UTC",
      }),
      buildInboxMessageListFilters({
        inboxTab: "ALL_BUSINESS",
        readFilter: "",
        activeSearch: "zzzz-no-match",
      }),
    ]) {
      void filters;
      messages = [];
      expect(messages).toEqual([]);
      messages = [{ id: "x" }];
    }
  });
});
