import { describe, expect, it } from "vitest";
import { isBlockedByInboxClearedAt } from "@forgeops/shared";

describe("live import uses isBlockedByInboxClearedAt", () => {
  const clearedAt = new Date("2026-09-23T20:00:00.000Z");

  it("skips provider mail at or before the current watermark", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-01T10:00:00.000Z"),
        sentAt: new Date("2026-08-01T09:00:00.000Z"),
      })
    ).toBe(true);
  });

  it("keeps mail received after the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-09-23T20:05:00.000Z"),
        sentAt: new Date("2026-09-23T20:04:00.000Z"),
      })
    ).toBe(false);
  });
});
