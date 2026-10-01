import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const detailSrc = readFileSync(
  join(here, "../../../web/src/views/JobDetailView.tsx"),
  "utf8"
);

describe("Job Overview headline metrics layout", () => {
  it("renders Emails / Open Tasks / Estimated Hours once, before Work Packages", () => {
    const overviewStart = detailSrc.indexOf("{tab === 'overview' && (");
    expect(overviewStart).toBeGreaterThan(-1);
    const overviewSlice = detailSrc.slice(overviewStart);

    const metricsIdx = overviewSlice.indexOf('data-testid="job-overview-headline-metrics"');
    const workPkgIdx = overviewSlice.indexOf("<WorkPackageOverviewSummary");
    const emailsLabelIdx = overviewSlice.indexOf('label="Emails"');
    const openTasksIdx = overviewSlice.indexOf('label="Open Tasks"');
    const estHoursIdx = overviewSlice.indexOf('label="Estimated Hours"');

    expect(metricsIdx).toBeGreaterThan(-1);
    expect(workPkgIdx).toBeGreaterThan(-1);
    expect(metricsIdx).toBeLessThan(workPkgIdx);
    expect(emailsLabelIdx).toBeGreaterThan(-1);
    expect(openTasksIdx).toBeGreaterThan(-1);
    expect(estHoursIdx).toBeGreaterThan(-1);

    // Exactly one of each metric label in the Overview block
    expect(overviewSlice.split('label="Emails"').length - 1).toBe(1);
    expect(overviewSlice.split('label="Open Tasks"').length - 1).toBe(1);
    expect(overviewSlice.split('label="Estimated Hours"').length - 1).toBe(1);

    // Still uses existing Job detail fields — no new fetch helpers for metrics
    expect(overviewSlice).toContain("job.emailCount");
    expect(overviewSlice).toContain("job.openTaskCount");
    expect(overviewSlice).toContain("job.overdueTaskCount");
    expect(overviewSlice).toContain("job.estimatedHours");

    // Metrics are not gated on Job status
    expect(overviewSlice.slice(0, metricsIdx + 80)).not.toMatch(
      /status\s*===\s*['"]BIDDING['"]/
    );
  });
});
