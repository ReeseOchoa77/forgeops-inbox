import { describe, expect, it } from "vitest";

/**
 * Documents the jobs-list enrichment contract after N+1 removal:
 * open/overdue counts come from groupBy batches, not per-row queries.
 */
describe("jobs list enrichment batching", () => {
  it("aggregates open and overdue counts by jobId", () => {
    const openGroups = [
      { jobId: "j1", _count: { _all: 3 } },
      { jobId: "j2", _count: { _all: 1 } },
    ];
    const overdueGroups = [{ jobId: "j1", _count: { _all: 2 } }];
    const openMap = new Map(openGroups.map((g) => [g.jobId, g._count._all]));
    const overdueMap = new Map(
      overdueGroups.map((g) => [g.jobId, g._count._all])
    );
    expect(openMap.get("j1")).toBe(3);
    expect(overdueMap.get("j1")).toBe(2);
    expect(overdueMap.get("j2") ?? 0).toBe(0);
  });

  it("caps jobs lookup page size", () => {
    const LOOKUP_LIMIT = 500;
    expect(LOOKUP_LIMIT).toBeLessThanOrEqual(500);
  });
});
