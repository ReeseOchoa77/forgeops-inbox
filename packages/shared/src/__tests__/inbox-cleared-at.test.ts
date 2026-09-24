import { describe, expect, it } from "vitest";
import { isBlockedByInboxClearedAt } from "../inbox-cleared-at.js";

const clearedAt = new Date("2026-09-23T20:00:00.000Z");

describe("isBlockedByInboxClearedAt", () => {
  it("blocks an old provider message on live sync", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-01T10:00:00.000Z"),
        sentAt: new Date("2026-08-01T09:00:00.000Z"),
      })
    ).toBe(true);
  });

  it("allows a provider message received after the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-09-23T20:05:00.000Z"),
        sentAt: new Date("2026-09-23T20:04:00.000Z"),
      })
    ).toBe(false);
  });

  it("blocks a replayed message at the watermark even when rediscovered later", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-01T10:00:00.000Z"),
        sentAt: new Date("2026-08-01T09:00:00.000Z"),
      })
    ).toBe(true);
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: clearedAt,
        sentAt: clearedAt,
      })
    ).toBe(true);
  });

  it("allows explicit historical import of mail before the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        bypass: true,
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-06-01T00:00:00.000Z"),
        sentAt: new Date("2026-06-01T00:00:00.000Z"),
      })
    ).toBe(false);
  });

  it("allows explicit project-folder analysis of mail before the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        bypass: true,
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-01-01T00:00:00.000Z"),
        sentAt: new Date("2026-01-01T00:00:00.000Z"),
      })
    ).toBe(false);
  });

  it("blocks n8n live ingest of mail at or before the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-01T10:00:00.000Z"),
        sentAt: null,
      })
    ).toBe(true);
  });

  it("blocks a sent message whose sent time is before the clear when receivedAt is missing", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: null,
        sentAt: new Date("2026-08-01T10:00:00.000Z"),
      })
    ).toBe(true);
  });

  it("uses the watermark supplied at processing time, not a stale earlier value", () => {
    const messageSentAt = new Date("2026-09-23T19:00:00.000Z");
    const watermarkWhenQueued = new Date("2026-09-01T00:00:00.000Z");
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: watermarkWhenQueued,
        receivedAt: null,
        sentAt: messageSentAt,
      })
    ).toBe(false);
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: null,
        sentAt: messageSentAt,
      })
    ).toBe(true);
  });

  it("allows mail received after the clear so classification can run", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-09-24T02:00:00.000Z"),
        sentAt: new Date("2026-09-24T01:59:00.000Z"),
      })
    ).toBe(false);
  });

  it("scopes the decision to the connection watermark that is passed in", () => {
    const otherClearedAt = new Date("2026-01-01T00:00:00.000Z");
    const receivedAt = new Date("2026-08-01T10:00:00.000Z");
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt,
        sentAt: receivedAt,
      })
    ).toBe(true);
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: otherClearedAt,
        receivedAt,
        sentAt: receivedAt,
      })
    ).toBe(false);
  });

  it("fails closed when a watermark is set and both provider timestamps are missing", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: null,
        sentAt: null,
      })
    ).toBe(true);
  });

  it("does not block when the connection has never been cleared", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: null,
        receivedAt: new Date("2020-01-01T00:00:00.000Z"),
        sentAt: new Date("2020-01-01T00:00:00.000Z"),
      })
    ).toBe(false);
  });
});
