import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTasksWhere } from "../interfaces/http/routes/inbox-read.route.js";

describe("buildTasksWhere dateRange", () => {
  const base = {
    workspaceId: "ws1",
    inboxConnectionId: "conn1",
    reviewOnly: false,
    lowConfidenceOnly: false,
    taskThreshold: new Prisma.Decimal("0.75"),
  };

  it("applies sourceDate bounds for TODAY", () => {
    const where = buildTasksWhere({
      ...base,
      dateRange: "TODAY",
      timezone: "UTC",
    });
    const and = (where as { AND: unknown[] }).AND;
    expect(and).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceDate: expect.objectContaining({
            gte: expect.any(Date),
            lt: expect.any(Date),
          }),
        }),
      ])
    );
  });

  it("omits sourceDate when no dateRange", () => {
    const where = buildTasksWhere(base);
    const and = (where as { AND: Array<Record<string, unknown>> }).AND;
    expect(and.some((c) => "sourceDate" in c)).toBe(false);
  });

  it("composes status with dateRange", () => {
    const where = buildTasksWhere({
      ...base,
      status: "OPEN",
      dateRange: "WEEK",
      timezone: "America/Chicago",
    });
    const and = (where as { AND: Array<Record<string, unknown>> }).AND;
    expect(and.some((c) => c.status === "OPEN")).toBe(true);
    expect(and.some((c) => "sourceDate" in c)).toBe(true);
  });
});
