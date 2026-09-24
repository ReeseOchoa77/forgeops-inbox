import { describe, expect, it } from "vitest";
import {
  formatHoursNumber,
  formatJobCost,
  formatOverviewDate,
  formatQuantity,
  lineEstimatedHours,
  OVERVIEW_METRIC_LABELS,
  OVERVIEW_PARTY_LABELS,
  OVERVIEW_REMOVED_LABELS,
  partyLabel,
  totalEstimatedHours,
} from "./job-overview-format";

describe("job overview formatting", () => {
  it("formats an entered total cost and treats unknown as not set", () => {
    expect(formatJobCost("428750.00")).toBe("$428,750");
    expect(formatJobCost(428750)).toBe("$428,750");
    expect(formatJobCost("1284.50")).toBe("$1,284.50");
    expect(formatJobCost(null)).toBe("Not set");
    expect(formatJobCost("")).toBe("Not set");
    expect(formatJobCost(0)).toBe("$0");
  });

  it("formats the start date and leaves an empty date unset", () => {
    expect(formatOverviewDate("2026-10-14T00:00:00.000Z")).toBe("Oct 14, 2026");
    expect(formatOverviewDate(null)).toBe("Not set");
    expect(formatOverviewDate("")).toBe("Not set");
  });

  it("labels missing parties as not assigned", () => {
    expect(partyLabel("Mortenson")).toBe("Mortenson");
    expect(partyLabel("John Smith")).toBe("John Smith");
    expect(partyLabel("Nova Academy")).toBe("Nova Academy");
    expect(partyLabel(null)).toBe("Not assigned");
    expect(partyLabel("  ")).toBe("Not assigned");
  });

  it("formats hours and quantities without extra decimals", () => {
    expect(formatHoursNumber(1284)).toBe("1,284");
    expect(formatHoursNumber(1284.5)).toBe("1,284.5");
    expect(formatQuantity(84)).toBe("84");
    expect(lineEstimatedHours(20, 3.5)).toBe(70);
    expect(totalEstimatedHours([
      { quantity: 24, estimatedHoursPerPiece: 3.5 },
      { quantity: 12, estimatedHoursPerPiece: 5 },
    ])).toBe(144);
    expect(totalEstimatedHours([])).toBe(0);
  });

  it("uses the operational overview labels", () => {
    expect(OVERVIEW_METRIC_LABELS).toEqual(["Total Cost", "Emails", "Open Tasks", "Estimated Hours"]);
    expect(OVERVIEW_PARTY_LABELS).toEqual(["Estimator", "Contractor", "Client"]);
    expect(OVERVIEW_REMOVED_LABELS).toEqual([
      "Emails (7d)",
      "Emails (30d)",
      "Completed Tasks",
      "Last Activity",
    ]);
  });

});
