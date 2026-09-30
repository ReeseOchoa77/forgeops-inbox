import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createShipment,
  deriveDeliveryRisk,
  toUtcDateOnly,
  updateShipment,
  addShipmentItem,
} from "../application/services/job-deliveries.js";

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date("2026-10-20T15:00:00.000Z");

describe("job deliveries", () => {
  it("derives late-to-ship and late-delivery without mutating package status", () => {
    expect(
      deriveDeliveryRisk(
        {
          status: "PLANNED",
          plannedShipDate: "2026-10-18",
          actualShipDate: null,
          plannedDeliveryDate: "2026-10-19",
          actualDeliveryDate: null,
        },
        now
      )
    ).toMatchObject({ lateToShip: true, lateDelivery: true, atRisk: true });

    expect(
      deriveDeliveryRisk(
        {
          status: "DELIVERED",
          plannedShipDate: "2026-10-01",
          actualShipDate: "2026-10-02",
          plannedDeliveryDate: "2026-10-03",
          actualDeliveryDate: "2026-10-05",
        },
        now
      )
    ).toMatchObject({ atRisk: false });
  });

  it("stores dates as UTC midnight date-only", () => {
    expect(toUtcDateOnly(new Date("2026-10-18T00:00:00.000Z"))).toBe("2026-10-18");
  });

  it("creates a delivery with no lines and snapshots job site destination", async () => {
    const created = {
      id: "sh-1",
      jobId: "job-1",
      deliveryNumber: "DEL-004",
      status: "PLANNED",
      plannedShipDate: null,
      actualShipDate: null,
      plannedDeliveryDate: new Date("2026-10-18T00:00:00.000Z"),
      actualDeliveryDate: null,
      destinationName: "Site A",
      destinationAddress1: "100 Main",
      destinationAddress2: null,
      destinationCity: "Austin",
      destinationState: "TX",
      destinationPostalCode: "78701",
      carrierName: null,
      driverName: null,
      truckNumber: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      items: [],
      documents: [],
    };
    const prisma = {
      job: {
        findFirst: vi.fn().mockResolvedValue({
          id: "job-1",
          siteName: "Site A",
          siteAddress1: "100 Main",
          siteAddress2: null,
          siteCity: "Austin",
          siteState: "TX",
          sitePostalCode: "78701",
        }),
      },
      jobShipment: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobShipment: { create: vi.fn().mockResolvedValue(created) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await createShipment(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      deliveryNumber: "DEL-004",
      plannedDeliveryDate: "2026-10-18",
      actorUserId: "u1",
    });
    expect(dto.deliveryNumber).toBe("DEL-004");
    expect(dto.lineCount).toBe(0);
    expect(dto.destinationCity).toBe("Austin");
    expect(dto.plannedDeliveryDate).toBe("2026-10-18");
  });

  it("marks shipped/delivered without overwriting planned dates", async () => {
    const existing = {
      id: "sh-1",
      deliveryNumber: "DEL-004",
      status: "PLANNED",
      plannedShipDate: new Date("2026-10-17T00:00:00.000Z"),
      actualShipDate: null,
      plannedDeliveryDate: new Date("2026-10-18T00:00:00.000Z"),
      actualDeliveryDate: null,
    };
    const shipped = {
      ...existing,
      status: "IN_TRANSIT",
      actualShipDate: new Date("2026-10-20T00:00:00.000Z"),
      destinationName: null,
      destinationAddress1: null,
      destinationAddress2: null,
      destinationCity: null,
      destinationState: null,
      destinationPostalCode: null,
      carrierName: null,
      driverName: null,
      truckNumber: null,
      notes: null,
      jobId: "job-1",
      createdAt: now,
      updatedAt: now,
      items: [],
      documents: [],
    };
    const prisma = {
      jobShipment: { findFirst: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobShipment: { update: vi.fn().mockResolvedValue(shipped) },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await updateShipment(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      shipmentId: "sh-1",
      status: "IN_TRANSIT",
      actorUserId: "u1",
    });
    expect(dto.status).toBe("IN_TRANSIT");
    expect(dto.plannedShipDate).toBe("2026-10-17");
    expect(dto.actualShipDate).toBe("2026-10-20");
  });

  it("rejects cross-job fabrication items on shipment lines", async () => {
    await expect(
      addShipmentItem(
        {
          jobShipment: {
            findFirst: vi.fn().mockResolvedValue({ id: "sh-1", status: "PLANNED" }),
          },
          jobFabricationItem: { findFirst: vi.fn().mockResolvedValue(null) },
        } as never,
        {
          workspaceId: "ws",
          jobId: "job-1",
          shipmentId: "sh-1",
          fabricationItemId: "other-job-item",
          actorUserId: "u1",
        }
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("wires Deliveries without AI, procurement mutation, package-status mutation, or Job.totalCost", () => {
    const service = readFileSync(resolve(here, "../application/services/job-deliveries.ts"), "utf8");
    expect(service).toContain("JobShipment");
    expect(service).toContain("jobShipmentItem");
    expect(service).toContain("jobInstallationRecord");
    expect(service).toContain("plannedShipDate");
    expect(service).toContain("actualDeliveryDate");
    expect(service).not.toContain("totalCost");
    expect(service).not.toContain("jobProcurement");
    expect(service).not.toContain("JobWorkPackageStatus");
    expect(service).not.toContain("createMilestone");
    expect(service).not.toContain("JOB_MATCHER");
    expect(service).not.toContain("invoice");

    const detail = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    expect(detail).toContain("JOB_CRM_TABS");
    expect(detail).toContain("<JobDeliveriesView");
    expect(detail).toContain("<DeliveryOverviewSummary");

    const listRoute = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    const listHandler = listRoute.slice(
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs — List jobs"),
      listRoute.indexOf("GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail")
    );
    expect(listHandler).not.toContain("jobShipment");
    expect(listHandler).not.toContain("deliverySummary");

    const migration = readFileSync(
      resolve(here, "../../../../packages/db/prisma/migrations/20260929270000_job_deliveries/migration.sql"),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "JobShipment"');
    expect(migration).toContain('CREATE TABLE "JobShipmentItem"');
    expect(migration).toContain('CREATE TABLE "JobInstallationRecord"');
    expect(migration).toContain('ADD COLUMN "siteName"');
  });
});
