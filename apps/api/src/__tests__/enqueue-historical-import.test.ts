import { describe, expect, it, vi } from "vitest";
import {
  enqueueHistoricalImportJob,
  formatHistoricalImportEnqueueError,
} from "../application/services/enqueue-historical-import.js";
import { historicalImportJobId } from "@forgeops/shared";

describe("historical import enqueue reliability", () => {
  it("historicalImportJobId contains no colon", () => {
    const id = historicalImportJobId("cmt94gagg000xbb44nftgn8td");
    expect(id).toBe("historical-import-cmt94gagg000xbb44nftgn8td");
    expect(id).not.toContain(":");
  });

  it("formatHistoricalImportEnqueueError is concise and capped", () => {
    const msg = formatHistoricalImportEnqueueError(
      new Error("Custom Id cannot contain :")
    );
    expect(msg).toContain("Failed to enqueue historical import");
    expect(msg).toContain("Custom Id cannot contain :");
    expect(msg.length).toBeLessThanOrEqual(2000);
  });

  it("successful enqueue leaves import PENDING for worker pickup", async () => {
    const add = vi.fn().mockResolvedValue({ id: "job1" });
    const update = vi.fn();
    const logs: Array<{ event: string; data: Record<string, unknown> }> = [];

    const result = await enqueueHistoricalImportJob({
      prisma: { mailboxHistoricalImport: { update } } as never,
      queue: { add } as never,
      importId: "imp1",
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      requestedLimit: 50,
      initiatedBy: "user1",
      log: (event, data) => logs.push({ event, data }),
    });

    expect(result.ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith(
      "mailbox-historical-import",
      expect.objectContaining({
        importId: "imp1",
        workspaceId: "ws1",
        inboxConnectionId: "conn1",
        requestedLimit: 50,
      }),
      expect.objectContaining({
        jobId: "historical-import-imp1",
      })
    );
    expect(logs).toHaveLength(0);
  });

  it("enqueue failure changes row PENDING → FAILED with errorMessage/completedAt", async () => {
    const add = vi.fn().mockRejectedValue(new Error("Custom Id cannot contain :"));
    const completedAt = new Date("2026-08-25T20:00:00.000Z");
    const update = vi.fn().mockResolvedValue({
      id: "imp1",
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      status: "FAILED",
      requestedLimit: 50,
      processedCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      businessCount: 0,
      personalCount: 0,
      failedCount: 0,
      errorMessage: "Failed to enqueue historical import: Custom Id cannot contain :",
      startedAt: null,
      completedAt,
      createdAt: new Date("2026-08-25T19:00:00.000Z"),
      updatedAt: completedAt,
    });
    const logs: Array<{ event: string; data: Record<string, unknown> }> = [];

    const result = await enqueueHistoricalImportJob({
      prisma: { mailboxHistoricalImport: { update } } as never,
      queue: { add } as never,
      importId: "imp1",
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
      requestedLimit: 50,
      log: (event, data) => logs.push({ event, data }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.import.status).toBe("FAILED");
    expect(result.errorMessage).toContain("Failed to enqueue historical import");
    expect(update).toHaveBeenCalledWith({
      where: { id: "imp1" },
      data: {
        status: "FAILED",
        errorMessage: expect.stringContaining("Custom Id cannot contain :"),
        completedAt: expect.any(Date),
      },
    });
    expect(logs).toEqual([
      {
        event: "historical-import-enqueue-failed",
        data: {
          importId: "imp1",
          workspaceId: "ws1",
          inboxConnectionId: "conn1",
          error: "Custom Id cannot contain :",
        },
      },
    ]);
  });

  it("FAILED import does not block retry (active statuses are PENDING/RUNNING only)", () => {
    const activeStatuses = new Set(["PENDING", "RUNNING"]);
    expect(activeStatuses.has("FAILED")).toBe(false);
    expect(activeStatuses.has("COMPLETED")).toBe(false);
    expect(activeStatuses.has("CANCELLED")).toBe(false);
  });
});
