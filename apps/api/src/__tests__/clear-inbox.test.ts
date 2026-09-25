import { describe, expect, it } from "vitest";
import { isBlockedByInboxClearedAt } from "@forgeops/shared";
import {
  clearConnectionInbox,
  clearInboxMessageWhere,
  deleteScopedEmailMessages,
  type ClearInboxMode,
} from "../application/services/clear-inbox.js";

const workspaceId = "ws-1";
const inboxConnectionId = "conn-1";
const clearedAt = new Date("2026-09-24T20:00:00.000Z");

function whereFor(mode: ClearInboxMode) {
  return clearInboxMessageWhere({ workspaceId, inboxConnectionId, mode });
}

describe("clear inbox message scope", () => {
  it("deletes only messages with no job on the selected mailbox", () => {
    expect(whereFor("NON_JOB_ONLY")).toEqual({
      workspaceId,
      inboxConnectionId,
      jobId: null,
    });
  });

  it("keeps every job-assigned message out of the safe delete predicate", () => {
    const where = whereFor("NON_JOB_ONLY");
    expect(where.jobId).toBeNull();
    expect(JSON.stringify(where)).not.toContain("VERIFIED_PROJECT_FOLDER");
    expect(JSON.stringify(where)).not.toContain("USER_ASSIGNED");
    expect(JSON.stringify(where)).not.toContain("AI_AUTO_ASSIGNED");
  });

  it("clear all uses the same mailbox scope and includes job emails", () => {
    expect(whereFor("ALL_EMAILS")).toEqual({
      workspaceId,
      inboxConnectionId,
    });
  });

  it("removes only Import Previous Emails and keeps project-folder mail", () => {
    expect(whereFor("HISTORICAL_IMPORT_ONLY")).toEqual({
      workspaceId,
      inboxConnectionId,
      fromHistoricalImport: true,
      fromProjectFolder: false,
    });
  });

  it("does not widen safe clear to another mailbox", () => {
    const where = clearInboxMessageWhere({
      workspaceId,
      inboxConnectionId: "conn-2",
      mode: "NON_JOB_ONLY",
    });
    expect(where.inboxConnectionId).toBe("conn-2");
    expect(where.workspaceId).toBe(workspaceId);
  });
});

describe("clear inbox deletion", () => {
  function fakeClient(deletedCount: number) {
    const calls: Array<{ model: string; op: string; args: unknown }> = [];
    const record = (model: string, op: string) => async (args: unknown) => {
      calls.push({ model, op, args });
      if (model === "emailMessage" && op === "deleteMany") return { count: deletedCount };
      if (model === "emailMessage" && op === "count") return 50;
      return { count: 0 };
    };
    const tx = {
      emailAttachment: { deleteMany: record("emailAttachment", "deleteMany") },
      task: { deleteMany: record("task", "deleteMany") },
      classification: { deleteMany: record("classification", "deleteMany") },
      normalizedEmail: { deleteMany: record("normalizedEmail", "deleteMany") },
      emailMessage: {
        deleteMany: record("emailMessage", "deleteMany"),
        count: record("emailMessage", "count"),
      },
      emailThread: { deleteMany: record("emailThread", "deleteMany") },
      inboxConnection: { update: record("inboxConnection", "update") },
      job: { deleteMany: record("job", "deleteMany") },
      discoveredFolder: { deleteMany: record("discoveredFolder", "deleteMany") },
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };
    return { prisma, calls };
  }

  it("safe clear deletes unassigned mail, preserves the job-email count, and sets the watermark", async () => {
    const { prisma, calls } = fakeClient(100);
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "NON_JOB_ONLY",
      clearedAt,
    });
    expect(result.deletedCount).toBe(100);
    expect(result.preservedJobEmailCount).toBe(50);
    expect(result.removedJobEmailCount).toBe(0);

    const messageDelete = calls.find((c) => c.model === "emailMessage" && c.op === "deleteMany");
    expect(messageDelete?.args).toEqual({
      where: { workspaceId, inboxConnectionId, jobId: null },
    });
    const threadDelete = calls.find((c) => c.model === "emailThread");
    expect(threadDelete?.args).toEqual({
      where: {
        workspaceId,
        inboxConnectionId,
        messages: { none: {} },
      },
    });
    const watermark = calls.find((c) => c.model === "inboxConnection");
    expect(watermark?.args).toEqual({
      where: { id: inboxConnectionId },
      data: { inboxClearedAt: clearedAt, syncCursor: null },
    });
    expect(calls.some((c) => c.model === "job" || c.model === "discoveredFolder")).toBe(false);

    const attachment = calls.find((c) => c.model === "emailAttachment");
    const classification = calls.find((c) => c.model === "classification");
    const task = calls.find((c) => c.model === "task");
    expect(attachment?.args).toEqual({
      where: { emailMessage: { workspaceId, inboxConnectionId, jobId: null } },
    });
    expect(classification?.args).toEqual({
      where: { message: { workspaceId, inboxConnectionId, jobId: null } },
    });
    expect(task?.args).toEqual({
      where: { sourceMessage: { workspaceId, inboxConnectionId, jobId: null } },
    });
  });

  it("clear all deletes job emails too, keeps jobs, and still sets the watermark", async () => {
    const { prisma, calls } = fakeClient(150);
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
    });
    expect(result.deletedCount).toBe(150);
    expect(result.removedJobEmailCount).toBe(50);
    expect(result.preservedJobEmailCount).toBe(0);
    const messageDelete = calls.find((c) => c.model === "emailMessage" && c.op === "deleteMany");
    expect((messageDelete?.args as { where: { jobId?: null } }).where.jobId).toBeUndefined();
    expect(calls.some((c) => c.model === "job")).toBe(false);
    expect(calls.some((c) => c.model === "inboxConnection")).toBe(true);
  });

  it("removes imported mail without moving the live-sync watermark", async () => {
    const { prisma, calls } = fakeClient(12);
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "HISTORICAL_IMPORT_ONLY",
      clearedAt,
    });
    expect(result.deletedCount).toBe(12);
    const messageDelete = calls.find((c) => c.model === "emailMessage" && c.op === "deleteMany");
    expect(messageDelete?.args).toEqual({
      where: {
        workspaceId,
        inboxConnectionId,
        fromHistoricalImport: true,
        fromProjectFolder: false,
      },
    });
    expect(calls.some((c) => c.model === "inboxConnection")).toBe(false);
    expect(calls.some((c) => c.model === "job" || c.model === "discoveredFolder")).toBe(false);
  });

  it("sets the watermark in the same transaction as the deletes", async () => {
    const order: string[] = [];
    const tx = {
      emailAttachment: { deleteMany: async () => { order.push("attachment"); return { count: 0 }; } },
      task: { deleteMany: async () => { order.push("task"); return { count: 0 }; } },
      classification: { deleteMany: async () => { order.push("classification"); return { count: 0 }; } },
      normalizedEmail: { deleteMany: async () => { order.push("normalized"); return { count: 0 }; } },
      emailMessage: {
        count: async () => 0,
        deleteMany: async () => { order.push("message"); return { count: 1 }; },
      },
      emailThread: { deleteMany: async () => { order.push("thread"); return { count: 0 }; } },
      inboxConnection: { update: async () => { order.push("watermark"); return {}; } },
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };
    await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "NON_JOB_ONLY",
      clearedAt,
    });
    expect(order.indexOf("message")).toBeGreaterThan(-1);
    expect(order.indexOf("watermark")).toBeGreaterThan(order.indexOf("message"));
  });
});

describe("individual job email delete", () => {
  it("deletes one message and only an empty thread, without a provider call or job delete", async () => {
    const calls: string[] = [];
    const tx = {
      emailAttachment: { deleteMany: async (args: { where: { emailMessage: { id: string } } }) => {
        calls.push(`attachment:${args.where.emailMessage.id}`);
        return { count: 1 };
      } },
      task: { deleteMany: async (args: { where: { sourceMessage: { id: string } } }) => {
        calls.push(`task:${args.where.sourceMessage.id}`);
        return { count: 1 };
      } },
      classification: { deleteMany: async () => { calls.push("classification"); return { count: 1 }; } },
      normalizedEmail: { deleteMany: async () => { calls.push("normalized"); return { count: 1 }; } },
      emailMessage: { deleteMany: async (args: { where: { id: string } }) => {
        calls.push(`message:${args.where.id}`);
        return { count: 1 };
      } },
      emailThread: { deleteMany: async (args: { where: { id: string } }) => {
        calls.push(`thread:${args.where.id}`);
        return { count: 0 };
      } },
    };
    const count = await deleteScopedEmailMessages(tx as never, {
      where: { id: "msg-1", workspaceId, jobId: "job-2218" },
      emptyThreadWhere: { id: "thread-1", workspaceId, messages: { none: {} } },
    });
    expect(count).toBe(1);
    expect(calls).toContain("message:msg-1");
    expect(calls).toContain("attachment:msg-1");
    expect(calls).toContain("thread:thread-1");
    expect(JSON.stringify(calls)).not.toContain("job-2218-other");
  });
});

describe("clear watermark still blocks live replay", () => {
  it("skips an old unassigned message rediscovered after the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-08-01T00:00:00.000Z"),
        sentAt: new Date("2026-08-01T00:00:00.000Z"),
      })
    ).toBe(true);
  });

  it("allows mail received after the clear", () => {
    expect(
      isBlockedByInboxClearedAt({
        inboxClearedAt: clearedAt,
        receivedAt: new Date("2026-09-24T20:05:00.000Z"),
        sentAt: new Date("2026-09-24T20:04:00.000Z"),
      })
    ).toBe(false);
  });

  it("lets explicit historical import and project-folder analysis bypass the watermark", () => {
    const old = {
      inboxClearedAt: clearedAt,
      receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
      bypass: true,
    };
    expect(isBlockedByInboxClearedAt(old)).toBe(false);
  });
});
