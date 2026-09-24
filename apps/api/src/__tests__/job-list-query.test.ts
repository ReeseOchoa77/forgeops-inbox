import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJobListWhere, jobListOrderBy } from "../application/services/job-list-query.js";

const now = new Date("2026-09-24T12:00:00.000Z");

describe("buildJobListWhere", () => {
  it("empty search is workspace-scoped and excludes archived jobs", () => {
    const where = buildJobListWhere({ workspaceId: "ws-1", now });
    expect(where.workspaceId).toBe("ws-1");
    expect(where.archivedAt).toBeNull();
    expect(where.OR).toBeUndefined();
  });

  it("searches job number, name, and description with the same contains predicate", () => {
    const where = buildJobListWhere({ workspaceId: "ws-1", search: "2218", now });
    expect(where.OR).toEqual([
      { jobNumber: { contains: "2218", mode: "insensitive" } },
      { name: { contains: "2218", mode: "insensitive" } },
      { description: { contains: "2218", mode: "insensitive" } },
    ]);
  });

  it("trims the search term and treats whitespace as empty", () => {
    const trimmed = buildJobListWhere({ workspaceId: "ws-1", search: "  Koch  ", now });
    expect(trimmed.OR).toEqual([
      { jobNumber: { contains: "Koch", mode: "insensitive" } },
      { name: { contains: "Koch", mode: "insensitive" } },
      { description: { contains: "Koch", mode: "insensitive" } },
    ]);
    const blank = buildJobListWhere({ workspaceId: "ws-1", search: "   ", now });
    expect(blank.OR).toBeUndefined();
  });

  it("does not search customer name or aliases", () => {
    const where = buildJobListWhere({ workspaceId: "ws-1", search: "Acme", now });
    const serialized = JSON.stringify(where);
    expect(serialized).not.toContain("customer");
    expect(serialized).not.toContain("alias");
  });

  it("keeps another workspace out of the predicate", () => {
    const where = buildJobListWhere({ workspaceId: "ws-a", search: "2218", now });
    expect(where.workspaceId).toBe("ws-a");
    expect(JSON.stringify(where)).not.toContain("ws-b");
  });

  it("returns no extra OR when there is no match term", () => {
    const where = buildJobListWhere({
      workspaceId: "ws-1",
      status: "ACTIVE",
      showArchived: true,
      now,
    });
    expect(where.status).toBe("ACTIVE");
    expect(where.archivedAt).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });
});

describe("jobListOrderBy", () => {
  it("keeps the existing default of newest created jobs", () => {
    expect(jobListOrderBy("createdAt", "desc")).toEqual([{ createdAt: "desc" }, { id: "asc" }]);
  });

  it("sorts start date with nulls last in both directions", () => {
    expect(jobListOrderBy("startDate", "desc")[0]).toEqual({ startDate: { sort: "desc", nulls: "last" } });
    expect(jobListOrderBy("startDate", "asc")[0]).toEqual({ startDate: { sort: "asc", nulls: "last" } });
  });

  it("sorts cost with nulls last in both directions", () => {
    expect(jobListOrderBy("totalCost", "desc")[0]).toEqual({ totalCost: { sort: "desc", nulls: "last" } });
    expect(jobListOrderBy("totalCost", "asc")[0]).toEqual({ totalCost: { sort: "asc", nulls: "last" } });
  });

  it("sorts name on the normalized column", () => {
    expect(jobListOrderBy("name", "asc")[0]).toEqual({ normalizedName: "asc" });
    expect(jobListOrderBy("name", "desc")[0]).toEqual({ normalizedName: "desc" });
  });

  it("sorts activity by updatedAt, the list's lastActivityAt", () => {
    expect(jobListOrderBy("activity", "desc")[0]).toEqual({ updatedAt: "desc" });
    expect(jobListOrderBy("activity", "asc")[0]).toEqual({ updatedAt: "asc" });
  });

  it("is applied on the same list query as skip and take, and still filters by workspace", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    const listStart = src.indexOf("workspaces/:workspaceId/jobs\",");
    const listEnd = src.indexOf("Job detail");
    const list = src.slice(listStart, listEnd);
    expect(list).toContain("buildJobListWhere");
    expect(list).toContain("orderBy: jobListOrderBy(query.sortBy, query.sortDir)");
    expect(list).toContain("skip,");
    expect(list).toContain("take: query.pageSize");
    expect(list).not.toContain(".sort(");
  });
});
