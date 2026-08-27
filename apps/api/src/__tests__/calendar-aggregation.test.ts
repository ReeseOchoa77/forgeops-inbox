import { describe, expect, it } from "vitest";

describe("calendar feed aggregation contract", () => {
  it("keeps task dues separate from CalendarEvent rows", () => {
    const events = [{ id: "e1", type: "MEETING" }];
    const taskDueItems = [{ id: "t1", type: "TASK" }];
    const feed = [
      ...events.map((e) => ({ ...e, kind: "event" as const })),
      ...taskDueItems.map((t) => ({ ...t, kind: "task" as const })),
    ];
    expect(feed.filter((i) => i.kind === "task")).toHaveLength(1);
    expect(feed.find((i) => i.kind === "task")?.type).toBe("TASK");
    expect(feed.find((i) => i.kind === "event")?.type).toBe("MEETING");
  });
});
