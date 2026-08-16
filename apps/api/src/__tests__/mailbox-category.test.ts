import { describe, expect, it } from "vitest";

import {
  legacyBusinessCategoryFromMailbox,
  mailboxCategoryFromLegacyBusinessFilter,
} from "../application/services/mailbox-category.js";

describe("mailbox category bridge", () => {
  it("maps PERSONAL ↔ NON_BUSINESS for list filters and reclassify sync", () => {
    expect(legacyBusinessCategoryFromMailbox("PERSONAL")).toBe("NON_BUSINESS");
    expect(legacyBusinessCategoryFromMailbox("BUSINESS")).toBe("BUSINESS");
    expect(mailboxCategoryFromLegacyBusinessFilter("NON_BUSINESS")).toBe("PERSONAL");
    expect(mailboxCategoryFromLegacyBusinessFilter("BUSINESS")).toBe("BUSINESS");
  });

  it("round-trips so Business↔Personal tab moves stay consistent", () => {
    // Simulate Business → Personal reclassify then Personal tab filter
    const afterToPersonal = legacyBusinessCategoryFromMailbox("PERSONAL");
    expect(mailboxCategoryFromLegacyBusinessFilter(afterToPersonal)).toBe("PERSONAL");

    // Simulate Personal → Business reclassify then Business tab filter
    const afterToBusiness = legacyBusinessCategoryFromMailbox("BUSINESS");
    expect(mailboxCategoryFromLegacyBusinessFilter(afterToBusiness)).toBe("BUSINESS");
  });
});
