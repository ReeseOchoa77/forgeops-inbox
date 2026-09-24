import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_JOB_LIST_SORT,
  getJobListSort,
  JOB_LIST_SORT_OPTIONS,
  jobListSortFromValue,
  resetJobListSortForTests,
  setJobListSort,
} from "./job-list-sort";

describe("job list sort", () => {
  beforeEach(() => {
    resetJobListSortForTests();
  });

  it("keeps recently added as the default", () => {
    expect(getJobListSort()).toEqual(DEFAULT_JOB_LIST_SORT);
    expect(DEFAULT_JOB_LIST_SORT).toEqual({ sortBy: "createdAt", sortDir: "desc" });
  });

  it("offers date, cost, name, and activity in both directions", () => {
    const labels = JOB_LIST_SORT_OPTIONS.map((option) => option.label);
    expect(labels).toEqual(expect.arrayContaining([
      "Activity — Most Recent",
      "Activity — Oldest",
      "Start Date — Newest",
      "Start Date — Oldest",
      "Cost — High to Low",
      "Cost — Low to High",
      "Name — A to Z",
      "Name — Z to A",
    ]));
    expect(jobListSortFromValue("startDate:asc")).toEqual({ sortBy: "startDate", sortDir: "asc" });
    expect(jobListSortFromValue("startDate:desc")).toEqual({ sortBy: "startDate", sortDir: "desc" });
    expect(jobListSortFromValue("totalCost:asc")).toEqual({ sortBy: "totalCost", sortDir: "asc" });
    expect(jobListSortFromValue("totalCost:desc")).toEqual({ sortBy: "totalCost", sortDir: "desc" });
    expect(jobListSortFromValue("name:asc")).toEqual({ sortBy: "name", sortDir: "asc" });
    expect(jobListSortFromValue("name:desc")).toEqual({ sortBy: "name", sortDir: "desc" });
    expect(jobListSortFromValue("activity:asc")).toEqual({ sortBy: "activity", sortDir: "asc" });
    expect(jobListSortFromValue("activity:desc")).toEqual({ sortBy: "activity", sortDir: "desc" });
  });

  it("remembers the sort after leaving the list", () => {
    setJobListSort({ sortBy: "totalCost", sortDir: "desc" });
    expect(getJobListSort()).toEqual({ sortBy: "totalCost", sortDir: "desc" });
  });
});
