import { describe, expect, it } from "vitest";
import { formatJobPrimaryLabel, formatJobSecondaryLabel, formatJobTooltip } from "../components/JobAssignPicker";

describe("job assign label helpers", () => {
  it("prioritizes job name and keeps number/status secondary", () => {
    const job = {
      name: "BSC BLDG. 3 Patio Rail",
      jobNumber: "2209",
      status: "ACTIVE",
      customerName: "Cobeck",
    };
    expect(formatJobPrimaryLabel(job)).toBe("BSC BLDG. 3 Patio Rail");
    expect(formatJobSecondaryLabel(job)).toBe("#2209 · ACTIVE · Cobeck");
    expect(formatJobTooltip(job)).toContain("BSC BLDG. 3 Patio Rail");
    expect(formatJobTooltip(job)).toContain("#2209");
    expect(formatJobTooltip(job)).toContain("ACTIVE");
  });

  it("truncates long names for constrained badges", () => {
    expect(
      formatJobPrimaryLabel(
        { name: "A Very Long Job Name That Should Truncate", jobNumber: "1" },
        18
      )
    ).toMatch(/…$/);
  });
});
