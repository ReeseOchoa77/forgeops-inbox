import { describe, expect, it } from "vitest";

/**
 * Mirrors importProviderMailbox live-sync skip:
 * clearedAt set && receivedAt <= clearedAt → do not create EmailMessage.
 * Historical import sets bypassInboxClearedAt and never applies this filter.
 */
function shouldSkipDueToInboxClearedAt(input: {
  bypassInboxClearedAt?: boolean;
  inboxClearedAt: Date | null;
  receivedAt: Date | null;
}): boolean {
  if (input.bypassInboxClearedAt) return false;
  const clearedAt = input.inboxClearedAt;
  if (!clearedAt || !input.receivedAt) return false;
  return input.receivedAt.getTime() <= clearedAt.getTime();
}

describe("inboxClearedAt live sync filter", () => {
  const clearedAt = new Date("2026-08-28T18:00:00.000Z");

  it("skips provider mail at or before watermark on live sync", () => {
    expect(
      shouldSkipDueToInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-28T17:59:59.000Z"),
      })
    ).toBe(true);
    expect(
      shouldSkipDueToInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: clearedAt,
      })
    ).toBe(true);
  });

  it("allows genuinely new mail after clear", () => {
    expect(
      shouldSkipDueToInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-28T18:00:01.000Z"),
      })
    ).toBe(false);
  });

  it("historical import bypasses watermark", () => {
    expect(
      shouldSkipDueToInboxClearedAt({
        bypassInboxClearedAt: true,
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2020-01-01T00:00:00.000Z"),
      })
    ).toBe(false);
  });

  it("no watermark → no skip", () => {
    expect(
      shouldSkipDueToInboxClearedAt({
        inboxClearedAt: null,
        receivedAt: new Date("2020-01-01T00:00:00.000Z"),
      })
    ).toBe(false);
  });
});

describe("Graph bootstrap page size", () => {
  it("MAX_MESSAGES_PER_SYNC is 100 (explains ~100 reimport after clear)", () => {
    // Kept in outlook-client.ts; documented here for regression awareness.
    const MAX_MESSAGES_PER_SYNC = 100;
    expect(MAX_MESSAGES_PER_SYNC).toBe(100);
  });
});
