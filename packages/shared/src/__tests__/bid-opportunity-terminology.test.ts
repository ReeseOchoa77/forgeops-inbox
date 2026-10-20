import { describe, expect, it } from "vitest";
import {
  BUSINESS_SUBTYPE_LABELS,
  INBOX_BID_INVITES_SOURCE_FILTER_LABEL,
  inboxBusinessTypeFilterOptionLabel,
  businessSubtypeFilterOptionsForDirection,
} from "../business-subtypes.js";

describe("Bid Opportunity terminology (shared)", () => {
  it("subtype label Bid Opportunity; Inbox filter Active Bid; key unchanged", () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe("Bid Opportunity");
    expect(INBOX_BID_INVITES_SOURCE_FILTER_LABEL).toBe("Active Bid");
    expect(inboxBusinessTypeFilterOptionLabel("BID_OPPORTUNITY")).toBe(
      "Active Bid"
    );
    const incoming = businessSubtypeFilterOptionsForDirection("incoming");
    expect(incoming.some((o) => o.key === "BID_OPPORTUNITY")).toBe(true);
    // Shared filter options still expose the subtype label for non-Inbox pickers.
    expect(
      incoming.find((o) => o.key === "BID_OPPORTUNITY")?.label
    ).toBe("Bid Opportunity");
  });

  it("AI-facing key BID_OPPORTUNITY remains in taxonomy", () => {
    expect(BUSINESS_SUBTYPE_LABELS).toHaveProperty("BID_OPPORTUNITY");
  });
});
