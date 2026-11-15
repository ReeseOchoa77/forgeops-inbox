import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatJobPrimaryLabel,
  formatJobSecondaryLabel,
  formatJobTooltip,
  INBOX_JOB_TAG_MAX_LEN,
} from "../components/JobAssignPicker";

const here = dirname(fileURLToPath(import.meta.url));

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

  it("inbox Job tag is name-first and more prominent than Type", () => {
    expect(INBOX_JOB_TAG_MAX_LEN).toBeGreaterThanOrEqual(36);
    const picker = readFileSync(join(here, "JobAssignPicker.tsx"), "utf8");
    expect(picker).toContain("export function InboxJobTag");
    expect(picker).toContain("fontSize: 13");
    expect(picker).toContain("fontWeight: 600");
    const messages = readFileSync(join(here, "../views/MessagesView.tsx"), "utf8");
    expect(messages).toContain("InboxJobTag");
    expect(messages).toContain('emphasis="secondary"');
    // Job column/header before Type in desktop table.
    const jobTh = messages.indexOf(">Job</th>");
    const typeTh = messages.indexOf(">Type</th>");
    expect(jobTh).toBeGreaterThan(-1);
    expect(typeTh).toBeGreaterThan(jobTh);
    const badges = readFileSync(join(here, "Badges.tsx"), "utf8");
    expect(badges).toContain("emphasis === 'secondary'");
  });
});
