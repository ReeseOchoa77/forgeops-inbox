import { describe, expect, it } from "vitest";

/**
 * Pure helpers mirroring historical import capping / junk exclusion used by the worker.
 */
function capMessages(
  threads: Array<{ messages: Array<{ id: string; labels: string[] }> }>,
  limit: number,
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

describe("historical import limits and folder filters", () => {
  it("respects requested limit beyond 50", () => {
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
});
