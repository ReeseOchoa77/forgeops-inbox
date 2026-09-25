import { describe, expect, it } from "vitest";
import { QueueNames } from "../constants/queues.js";
import {
  capabilitiesForJob,
  displayStateForBull,
  sanitizeJobData,
  WORKER_JOB_DEFINITIONS,
} from "../worker-jobs/registry.js";

describe("worker job display states", () => {
  it("maps BullMQ waiting, active, delayed, failed, and completed", () => {
    expect(displayStateForBull("waiting")).toBe("QUEUED");
    expect(displayStateForBull("active")).toBe("ACTIVE");
    expect(displayStateForBull("delayed")).toBe("DELAYED");
    expect(displayStateForBull("failed")).toBe("FAILED");
    expect(displayStateForBull("completed")).toBe("COMPLETED");
    expect(displayStateForBull("paused")).toBe("PAUSED");
  });

  it("keeps a cancelling run visible even while the queue job is active", () => {
    expect(displayStateForBull("active", "CANCELLING")).toBe("CANCELLING");
    expect(displayStateForBull("completed", "CANCELLED")).toBe("CANCELLED");
  });
});

describe("worker job capabilities", () => {
  it("does not offer pause or revert for a running classification", () => {
    const caps = capabilitiesForJob({
      queue: QueueNames.MAILBOX_CLASSIFY,
      bullState: "active",
    });
    expect(caps.pause).toBe(false);
    expect(caps.resume).toBe(false);
    expect(caps.cancel).toBe(false);
    expect(caps.revert).toBe(false);
    expect(caps.remove).toBe(false);
  });

  it("lets a failed classification be retried and its history removed", () => {
    const caps = capabilitiesForJob({
      queue: QueueNames.MAILBOX_CLASSIFY,
      bullState: "failed",
    });
    expect(caps.retry).toBe(true);
    expect(caps.remove).toBe(true);
    expect(caps.revert).toBe(false);
  });

  it("can cancel a waiting job and an active historical import", () => {
    expect(
      capabilitiesForJob({ queue: QueueNames.MAILBOX_CLASSIFY, bullState: "waiting" }).cancel
    ).toBe(true);
    expect(
      capabilitiesForJob({
        queue: QueueNames.MAILBOX_HISTORICAL_IMPORT,
        bullState: "active",
        runStatus: "RUNNING",
      }).cancel
    ).toBe(true);
    expect(
      capabilitiesForJob({
        queue: QueueNames.MAILBOX_RECLASSIFY,
        bullState: "active",
        runStatus: "CANCELLING",
      }).cancel
    ).toBe(false);
    expect(
      capabilitiesForJob({
        queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
        bullState: "active",
        runStatus: "RUNNING",
      }).cancel
    ).toBe(true);
    expect(
      capabilitiesForJob({
        queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
        bullState: "missing",
        runStatus: "RUNNING",
      }).cancel
    ).toBe(true);
    expect(
      capabilitiesForJob({
        queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
        bullState: "missing",
        runStatus: "FAILED",
      }).cancel
    ).toBe(false);
    expect(
      capabilitiesForJob({
        queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
        bullState: "failed",
        runStatus: "RUNNING",
      }).cancel
    ).toBe(true);
    expect(
      capabilitiesForJob({
        queue: QueueNames.MAILBOX_CLASSIFY,
        bullState: "failed",
      }).cancel
    ).toBe(false);
  });

  it("keeps revert off for every registered queue", () => {
    for (const def of Object.values(WORKER_JOB_DEFINITIONS)) {
      expect(def.revert).toBe(false);
      expect(def.pause).toBe(false);
      expect(def.revertReason.length).toBeGreaterThan(10);
    }
  });
});

describe("sanitizeJobData", () => {
  it("redacts tokens and truncates long strings", () => {
    const clean = sanitizeJobData({
      workspaceId: "ws",
      accessToken: "secret-token",
      refreshToken: "refresh",
      bodyHtml: "<html>giant</html>",
      note: "x".repeat(400),
    }) as Record<string, unknown>;
    expect(clean.workspaceId).toBe("ws");
    expect(clean.accessToken).toBe("[redacted]");
    expect(clean.refreshToken).toBe("[redacted]");
    expect(clean.bodyHtml).toBe("[redacted]");
    expect(String(clean.note).endsWith("…")).toBe(true);
    expect(String(clean.note).length).toBeLessThan(300);
  });
});
