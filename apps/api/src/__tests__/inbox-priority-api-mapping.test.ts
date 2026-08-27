import { describe, expect, it } from "vitest";
import { mapStoredPriorityToN8n } from "@forgeops/shared";

/**
 * Inbox/API priority boundary: Prisma stores MEDIUM; API exposes NORMAL.
 */
describe("inbox API priority mapping", () => {
  it("maps stored MEDIUM → API NORMAL", () => {
    expect(mapStoredPriorityToN8n("MEDIUM")).toBe("NORMAL");
  });

  it("passes through LOW HIGH URGENT", () => {
    expect(mapStoredPriorityToN8n("LOW")).toBe("LOW");
    expect(mapStoredPriorityToN8n("HIGH")).toBe("HIGH");
    expect(mapStoredPriorityToN8n("URGENT")).toBe("URGENT");
  });

  it("null stays null (unclassified / no invented priority)", () => {
    expect(mapStoredPriorityToN8n(null)).toBeNull();
    expect(mapStoredPriorityToN8n(undefined)).toBeNull();
  });
});
