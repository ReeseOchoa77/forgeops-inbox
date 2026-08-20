import { describe, expect, it } from "vitest";
import {
  legacyBusinessCategoryFromMailbox,
  mailboxCategoryFromLegacyBusinessFilter,
} from "../mailbox-category.js";

describe("mailbox category mapping", () => {
  it("maps PERSONAL ↔ NON_BUSINESS without inversion", () => {
    expect(legacyBusinessCategoryFromMailbox("PERSONAL")).toBe("NON_BUSINESS");
    expect(legacyBusinessCategoryFromMailbox("BUSINESS")).toBe("BUSINESS");
    expect(mailboxCategoryFromLegacyBusinessFilter("NON_BUSINESS")).toBe(
      "PERSONAL"
    );
    expect(mailboxCategoryFromLegacyBusinessFilter("BUSINESS")).toBe(
      "BUSINESS"
    );
  });

  it("round-trips both directions", () => {
    expect(
      mailboxCategoryFromLegacyBusinessFilter(
        legacyBusinessCategoryFromMailbox("PERSONAL")
      )
    ).toBe("PERSONAL");
    expect(
      mailboxCategoryFromLegacyBusinessFilter(
        legacyBusinessCategoryFromMailbox("BUSINESS")
      )
    ).toBe("BUSINESS");
  });
});
