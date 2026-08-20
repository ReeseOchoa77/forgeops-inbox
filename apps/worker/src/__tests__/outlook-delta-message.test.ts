import { describe, expect, it } from "vitest";
import {
  graphMessageHasSender,
  isIncompleteGraphMessage,
  isRemovedGraphMessage,
  normalizeGraphMessageFrom
} from "../infrastructure/providers/outlook/outlook-client.js";

describe("Outlook delta message guards", () => {
  it("treats @removed entries as deletions", () => {
    expect(
      isRemovedGraphMessage({
        "@removed": { reason: "deleted" }
      })
    ).toBe(true);
    expect(isRemovedGraphMessage({})).toBe(false);
  });

  it("treats missing from as incomplete delta (not null sender)", () => {
    expect(isIncompleteGraphMessage({})).toBe(true);
    expect(isIncompleteGraphMessage({ from: null })).toBe(false);
    expect(
      isIncompleteGraphMessage({
        from: { emailAddress: { address: "a@b.com" } }
      })
    ).toBe(false);
  });

  it("normalizes undefined from to null for strict internals", () => {
    const normalized = normalizeGraphMessageFrom({
      id: "msg-1"
    });
    expect(normalized.from).toBeNull();
    expect(graphMessageHasSender(normalized)).toBe(false);
  });

  it("preserves a valid from through normalization", () => {
    const normalized = normalizeGraphMessageFrom({
      id: "msg-2",
      from: {
        emailAddress: { name: "Ed", address: "ed@tekstl.net" }
      }
    });
    expect(normalized.from).toEqual({
      emailAddress: { name: "Ed", address: "ed@tekstl.net" }
    });
    expect(graphMessageHasSender(normalized)).toBe(true);
  });

  it("normalizes missing sender name to null", () => {
    const normalized = normalizeGraphMessageFrom({
      id: "msg-3",
      from: {
        emailAddress: { address: "solo@tekstl.net" }
      }
    });
    expect(normalized.from).toEqual({
      emailAddress: { name: null, address: "solo@tekstl.net" }
    });
  });

  it("requires a non-empty sender address", () => {
    expect(graphMessageHasSender({ from: null })).toBe(false);
    expect(
      graphMessageHasSender({
        from: { emailAddress: { name: null, address: "  " } }
      })
    ).toBe(false);
    expect(
      graphMessageHasSender({
        from: { emailAddress: { name: null, address: "ed@tekstl.net" } }
      })
    ).toBe(true);
  });
});
