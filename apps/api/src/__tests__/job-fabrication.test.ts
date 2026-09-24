import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canEditJob,
  fabricationItemWhere,
  lineEstimatedHours,
  presentFabricationItem,
  totalEstimatedHours,
} from "../application/services/job-fabrication.js";

describe("fabrication scope", () => {
  it("derives line hours from quantity times hours per piece", () => {
    expect(lineEstimatedHours(20, 3.5)).toBe(70);
    expect(lineEstimatedHours(24, 3.5)).toBe(84);
    expect(lineEstimatedHours(40, 0.8)).toBe(32);
  });

  it("derives the job total from the line totals", () => {
    const items = [
      { quantity: 24, estimatedHoursPerPiece: 3.5 },
      { quantity: 12, estimatedHoursPerPiece: 5 },
      { quantity: 8, estimatedHoursPerPiece: 6.5 },
      { quantity: 40, estimatedHoursPerPiece: 0.8 },
    ];
    expect(totalEstimatedHours(items)).toBe(228);
    expect(totalEstimatedHours([])).toBe(0);
  });

  it("presents quantity, hours per piece, and calculated total hours", () => {
    expect(presentFabricationItem({
      id: "item-1",
      name: "W12x26 Beams",
      quantity: "24.00",
      estimatedHoursPerPiece: "3.50",
      sortOrder: 0,
    })).toEqual({
      id: "item-1",
      name: "W12x26 Beams",
      quantity: 24,
      estimatedHoursPerPiece: 3.5,
      totalHours: 84,
      sortOrder: 0,
    });
  });

  it("allows only owner and editor writes", () => {
    expect(canEditJob("OWNER")).toBe(true);
    expect(canEditJob("EDITOR")).toBe(true);
    expect(canEditJob("VIEWER")).toBe(false);
    expect(canEditJob("MEMBER")).toBe(false);
  });

  it("scopes every item lookup to the workspace and job", () => {
    expect(fabricationItemWhere("ws-1", "job-1")).toEqual({ workspaceId: "ws-1", jobId: "job-1" });
    expect(fabricationItemWhere("ws-1", "job-1", "item-9")).toEqual({
      id: "item-9",
      workspaceId: "ws-1",
      jobId: "job-1",
    });
    expect(fabricationItemWhere("ws-2", "job-1", "item-9").workspaceId).toBe("ws-2");
  });

  it("counts job emails by EmailMessage.jobId and does not query 7 or 30 day windows", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    expect(src).toContain("emailMessage.count({ where: { jobId, workspaceId } })");
    expect(src).not.toContain("recentEmails7d");
    expect(src).not.toContain("recentEmails30d");
    expect(src).toContain("openTaskCount: openTasks");
    expect(src).toContain('status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] }');
  });

  it("keeps the overview operational and sorts the list on the server", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const overview = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    const headerAndOverview = overview.slice(overview.indexOf("{job.name}"), overview.indexOf("tab === 'emails'"));
    expect(headerAndOverview).toContain("StatusBadge");
    expect(headerAndOverview).toContain("Start Date");
    expect(headerAndOverview).toContain('label="Total Cost"');
    expect(headerAndOverview).toContain('label="Emails"');
    expect(headerAndOverview).toContain('label="Open Tasks"');
    expect(headerAndOverview).toContain('label="Estimated Hours"');
    expect(headerAndOverview).toContain('label="Estimator"');
    expect(headerAndOverview).toContain('label="Contractor"');
    expect(headerAndOverview).toContain('label="Client"');
    expect(headerAndOverview).toContain("<JobFabricationScope");
    for (const removed of ["Emails (7d)", "Emails (30d)", "Completed Tasks", "Last Activity", 'title="Team"', "Created:"]) {
      expect(headerAndOverview).not.toContain(removed);
    }
    const scope = readFileSync(resolve(here, "../../../web/src/views/JobFabricationScope.tsx"), "utf8");
    expect(scope).toContain("FABRICATION SCOPE");
    expect(scope).toContain("No fabrication items have been added.");
    expect(scope).toContain("+ Add Item");
    expect(scope).toContain("Hrs / Piece");
    expect(scope).toContain("Remove");

    const list = readFileSync(resolve(here, "../../../web/src/views/JobsView.tsx"), "utf8");
    expect(list).toContain("sortBy,");
    expect(list).toContain("sortDir,");
    expect(list).toContain("search: debouncedSearch || undefined");
    expect(list).toContain('aria-label="Sort jobs"');
    const api = readFileSync(resolve(here, "../../../web/src/api.ts"), "utf8");
    expect(api).toContain("if (params?.sortBy) p.set('sortBy', params.sortBy)");
    expect(api).toContain("if (params?.search) p.set('search', params.search)");
  });
});
