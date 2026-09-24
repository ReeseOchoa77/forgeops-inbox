import { describe, expect, it } from "vitest";
import { JOBS_SEARCH_DEBOUNCE_MS, isCurrentJobsRequest } from "./jobs-search";

describe("jobs search requests", () => {
  it("debounces about 300ms", () => {
    expect(JOBS_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(JOBS_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(JOBS_SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(300);
  });

  it("drops a stale response when a newer search is in flight", () => {
    const latest = 4;
    expect(isCurrentJobsRequest(3, latest)).toBe(false);
    expect(isCurrentJobsRequest(4, latest)).toBe(true);
  });

  it("ignores an older cleared-search response after a newer term", () => {
    const clearedSeq = 2;
    const typedSeq = 5;
    expect(isCurrentJobsRequest(clearedSeq, typedSeq)).toBe(false);
  });
});
