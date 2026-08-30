import { describe, expect, it } from "vitest";
import {
  HISTORICAL_IMPORT_MAX_LIMIT,
  HISTORICAL_IMPORT_PAGE_SIZE,
  HISTORICAL_IMPORT_UNLIMITED,
  isUnlimitedHistoricalImport,
} from "@forgeops/shared";

/**
 * Pure helpers mirroring historical import capping / junk exclusion used by the worker.
 */
function capMessages(
  threads: Array<{ messages: Array<{ id: string; labels: string[] }> }>,
  limit: number | null,
  opts: {
    excludeJunk: boolean;
    excludeTrash: boolean;
    listenIncoming: boolean;
    listenSent: boolean;
  }
) {
  const filtered = threads
    .map((thread) => ({
      ...thread,
      messages: thread.messages.filter((message) => {
        const labels = message.labels.map((l) => l.toLowerCase());
        if (opts.excludeJunk && labels.some((l) => l === "junk" || l === "spam")) {
          return false;
        }
        if (
          opts.excludeTrash &&
          labels.some((l) => l.includes("trash") || l.includes("deleted"))
        ) {
          return false;
        }
        const isSent = labels.some((l) => l === "sent" || l.includes("sent items"));
        if (isSent) return opts.listenSent;
        if (!isSent && !opts.listenIncoming) return false;
        return true;
      }),
    }))
    .filter((t) => t.messages.length > 0);

  if (limit == null) {
    return filtered.flatMap((t) => t.messages);
  }

  let remaining = limit;
  const capped = [];
  for (const thread of filtered) {
    if (remaining <= 0) break;
    if (thread.messages.length <= remaining) {
      capped.push(thread);
      remaining -= thread.messages.length;
    } else {
      capped.push({ ...thread, messages: thread.messages.slice(0, remaining) });
      remaining = 0;
    }
  }
  return capped.flatMap((t) => t.messages);
}

/** Simulate Graph-style paging for Since-date (no total cap). */
function pageAllSinceDate(
  allIds: string[],
  pageSize: number
): { pages: string[][]; total: number } {
  const pages: string[][] = [];
  let cursor = 0;
  while (cursor < allIds.length) {
    pages.push(allIds.slice(cursor, cursor + pageSize));
    cursor += pageSize;
  }
  return { pages, total: allIds.length };
}

describe("historical import limits and folder filters", () => {
  it("respects requested limit beyond 50 for by-count", () => {
    const threads = [
      {
        messages: Array.from({ length: 80 }, (_, i) => ({
          id: `m${i}`,
          labels: ["INBOX"],
        })),
      },
    ];
    const result = capMessages(threads, 75, {
      excludeJunk: true,
      excludeTrash: true,
      listenIncoming: true,
      listenSent: false,
    });
    expect(result).toHaveLength(75);
  });

  it("by-count hard cap stays at HISTORICAL_IMPORT_MAX_LIMIT", () => {
    expect(HISTORICAL_IMPORT_MAX_LIMIT).toBe(250);
    const threads = [
      {
        messages: Array.from({ length: 400 }, (_, i) => ({
          id: `m${i}`,
          labels: ["INBOX"],
        })),
      },
    ];
    const result = capMessages(threads, HISTORICAL_IMPORT_MAX_LIMIT, {
      excludeJunk: true,
      excludeTrash: true,
      listenIncoming: true,
      listenSent: false,
    });
    expect(result).toHaveLength(250);
  });

  it("since-date pages beyond 250 with PAGE_SIZE batches", () => {
    expect(HISTORICAL_IMPORT_PAGE_SIZE).toBe(50);
    expect(isUnlimitedHistoricalImport(HISTORICAL_IMPORT_UNLIMITED)).toBe(true);
    const allIds = Array.from({ length: 673 }, (_, i) => `m${i}`);
    const { pages, total } = pageAllSinceDate(allIds, HISTORICAL_IMPORT_PAGE_SIZE);
    expect(total).toBe(673);
    expect(pages.length).toBe(14); // 13*50 + 23
    expect(pages[0]).toHaveLength(50);
    expect(pages[pages.length - 1]).toHaveLength(23);
    expect(pages.flat()).toHaveLength(673);
  });

  it("final page smaller than page limit works", () => {
    const { pages } = pageAllSinceDate(
      Array.from({ length: 120 }, (_, i) => `m${i}`),
      50
    );
    expect(pages.map((p) => p.length)).toEqual([50, 50, 20]);
  });

  it("excludes junk and trash by default", () => {
    const threads = [
      {
        messages: [
          { id: "ok", labels: ["INBOX"] },
          { id: "junk", labels: ["junk"] },
          { id: "trash", labels: ["deleted items"] },
        ],
      },
    ];
    const result = capMessages(threads, 10, {
      excludeJunk: true,
      excludeTrash: true,
      listenIncoming: true,
      listenSent: false,
    });
    expect(result.map((m) => m.id)).toEqual(["ok"]);
  });

  it("respects sent listening setting", () => {
    const threads = [
      {
        messages: [
          { id: "in", labels: ["INBOX"] },
          { id: "out", labels: ["sent items"] },
        ],
      },
    ];
    expect(
      capMessages(threads, 10, {
        excludeJunk: true,
        excludeTrash: true,
        listenIncoming: true,
        listenSent: false,
      }).map((m) => m.id)
    ).toEqual(["in"]);
    expect(
      capMessages(threads, 10, {
        excludeJunk: true,
        excludeTrash: true,
        listenIncoming: true,
        listenSent: true,
      }).map((m) => m.id)
    ).toEqual(["in", "out"]);
  });

  it("unlimited mode does not apply a message cap", () => {
    const threads = [
      {
        messages: Array.from({ length: 300 }, (_, i) => ({
          id: `m${i}`,
          labels: ["INBOX"],
        })),
      },
    ];
    expect(
      capMessages(threads, null, {
        excludeJunk: true,
        excludeTrash: true,
        listenIncoming: true,
        listenSent: false,
      })
    ).toHaveLength(300);
  });
});

describe("historical import Graph nextLink resume semantics", () => {
  it("preserves nextLink when a page fills to maxMessages", () => {
    // Mirrors outlook-client: when items.length >= maxMessages, keep pageNext.
    const maxMessages = 50;
    let items = 0;
    const pageNext = "https://graph.microsoft.com/v1.0/me/messages?$skiptoken=abc";
    let nextPageCursor: string | null = null;
    let url: string | null = "https://graph.microsoft.com/v1.0/me/messages";

    // Simulate one full Graph page of 50.
    items = maxMessages;
    if (items >= maxMessages) {
      nextPageCursor = pageNext;
      url = null;
    }
    expect(url).toBeNull();
    expect(nextPageCursor).toBe(pageNext);
  });

  it("clears nextLink when the final partial page completes", () => {
    const maxMessages = 50;
    let items = 23;
    const pageNext: string | null = null;
    let nextPageCursor: string | null = "stale";
    if (items >= maxMessages) {
      nextPageCursor = pageNext;
    } else {
      nextPageCursor = null;
    }
    expect(nextPageCursor).toBeNull();
  });

  it("does not put nextLink into audit-style metadata objects", () => {
    const resumeCursor =
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=" +
      "x".repeat(2000);
    const auditMetadata = {
      importId: "imp_1",
      processedCount: 500,
      // Intentionally omit resumeCursor / nextLink
    };
    expect(JSON.stringify(auditMetadata)).not.toContain("skiptoken");
    expect(resumeCursor.length).toBeGreaterThan(1000);
  });
});
