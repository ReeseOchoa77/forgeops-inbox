import { describe, expect, it } from "vitest";
import { buildJobListWhere } from "../application/services/job-list-query.js";

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
