import { describe, expect, it } from "vitest";
import {
  graphMessageHasSender,
  isIncompleteGraphMessage,
  isRemovedGraphMessage
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

  it("requires a non-empty sender address", () => {
    expect(graphMessageHasSender({ from: null })).toBe(false);
    expect(
      graphMessageHasSender({
        from: { emailAddress: { address: "  " } }
      })
    ).toBe(false);
    expect(
      graphMessageHasSender({
        from: { emailAddress: { address: "ed@tekstl.net" } }
      })
    ).toBe(true);
  });
});
