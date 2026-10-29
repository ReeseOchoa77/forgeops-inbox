import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBlockedByInboxClearedAt } from "@forgeops/shared";
import {
  CLEAR_INBOX_TRANSACTION_TIMEOUT_MS,
  clearConnectionInbox,
  clearInboxMessageWhere,
  deleteScopedEmailMessages,
  type ClearInboxMode,
} from "../application/services/clear-inbox.js";

const workspaceId = "ws-1";
const inboxConnectionId = "conn-1";
const clearedAt = new Date("2026-09-24T20:00:00.000Z");
const here = import.meta.dirname;

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

  it("removes imported mail and regular inbox sync, and keeps project-folder mail", () => {
    expect(whereFor("HISTORICAL_IMPORT_ONLY")).toEqual({
      workspaceId,
      inboxConnectionId,
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
  function fakeClient(
    deletedCount: number,
    opts?: { candidateIds?: string[]; quoteDeleteCount?: number }
  ) {
    const calls: Array<{ model: string; op: string; args: unknown }> = [];
    const candidateIds = opts?.candidateIds ?? [];
    const record = (model: string, op: string) => async (args: unknown) => {
      calls.push({ model, op, args });
      if (model === "emailMessage" && op === "deleteMany") return { count: deletedCount };
      if (model === "emailMessage" && op === "count") return 50;
      if (model === "bidCandidate" && op === "findMany") {
        return candidateIds.map((id) => ({ id }));
      }
      if (model === "bidCandidate" && op === "deleteMany") {
        return { count: candidateIds.length };
      }
      if (model === "bidQuoteStaging" && op === "deleteMany") {
        return { count: opts?.quoteDeleteCount ?? candidateIds.length };
      }
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
      customer: { deleteMany: record("customer", "deleteMany") },
      discoveredFolder: { deleteMany: record("discoveredFolder", "deleteMany") },
      bidCandidate: {
        findMany: record("bidCandidate", "findMany"),
        deleteMany: record("bidCandidate", "deleteMany"),
      },
      bidQuoteStaging: { deleteMany: record("bidQuoteStaging", "deleteMany") },
    };
    let transactionOptions: unknown;
    const prisma = {
      $transaction: async (
        fn: (client: typeof tx) => Promise<unknown>,
        options?: unknown
      ) => {
        transactionOptions = options;
        return fn(tx);
      },
    };
    return { prisma, calls, getTransactionOptions: () => transactionOptions };
  }

  it("uses an explicit 60s timeout on this transaction only", async () => {
    const { prisma, getTransactionOptions } = fakeClient(1);
    await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
    });
    expect(CLEAR_INBOX_TRANSACTION_TIMEOUT_MS).toBe(60_000);
    expect(getTransactionOptions()).toEqual({ timeout: 60_000 });
  });

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

    const classification = calls.find((c) => c.model === "classification");
    const task = calls.find((c) => c.model === "task");
    expect(classification?.args).toEqual({
      where: { message: { workspaceId, inboxConnectionId, jobId: null } },
    });
    expect(task?.args).toEqual({
      where: { sourceMessage: { workspaceId, inboxConnectionId, jobId: null } },
    });
    expect(calls.some((c) => c.model === "emailAttachment")).toBe(false);
    expect(calls.some((c) => c.model === "normalizedEmail")).toBe(false);
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
    expect(result.bidCandidatesDeleted).toBe(0);
    const messageDelete = calls.find((c) => c.model === "emailMessage" && c.op === "deleteMany");
    expect((messageDelete?.args as { where: { jobId?: null } }).where.jobId).toBeUndefined();
    expect(calls.some((c) => c.model === "job")).toBe(false);
    expect(calls.some((c) => c.model === "bidCandidate")).toBe(false);
    expect(calls.some((c) => c.model === "inboxConnection")).toBe(true);
  });

  it("NON_JOB_ONLY ignores includeBidCandidates=true", async () => {
    const { prisma, calls } = fakeClient(10, { candidateIds: ["c1"] });
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "NON_JOB_ONLY",
      clearedAt,
      includeBidCandidates: true,
    });
    expect(result.bidCandidatesDeleted).toBe(0);
    expect(calls.some((c) => c.model === "bidCandidate")).toBe(false);
  });

  it("A/B) includeBidCandidates false/omitted preserves Candidates", async () => {
    const { prisma, calls } = fakeClient(10, { candidateIds: ["c1", "c2"] });
    const omitted = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
    });
    expect(omitted.bidCandidatesDeleted).toBe(0);
    expect(calls.some((c) => c.model === "bidCandidate")).toBe(false);

    const { prisma: p2, calls: c2 } = fakeClient(10, { candidateIds: ["c1"] });
    const explicitFalse = await clearConnectionInbox(p2 as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
      includeBidCandidates: false,
    });
    expect(explicitFalse.bidCandidatesDeleted).toBe(0);
    expect(c2.some((c) => c.model === "bidCandidate")).toBe(false);
  });

  it("C–I) includeBidCandidates=true deletes all workspace Candidates; Jobs untouched", async () => {
    const { prisma, calls } = fakeClient(20, {
      candidateIds: ["cand-open", "cand-quoted", "cand-converted"],
      quoteDeleteCount: 4,
    });
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
      includeBidCandidates: true,
    });
    expect(result.bidCandidatesDeleted).toBe(3);
    expect(result.quoteStagingsRemovedWithCandidates).toBe(4);
    expect(result.deletedCount).toBe(20);

    const candFind = calls.find((c) => c.model === "bidCandidate" && c.op === "findMany");
    expect(candFind?.args).toEqual({
      where: { workspaceId },
      select: { id: true },
    });
    const candDelete = calls.find((c) => c.model === "bidCandidate" && c.op === "deleteMany");
    expect(candDelete?.args).toEqual({
      where: {
        workspaceId,
        id: { in: ["cand-open", "cand-quoted", "cand-converted"] },
      },
    });
    const quoteDelete = calls.find(
      (c) => c.model === "bidQuoteStaging" && c.op === "deleteMany"
    );
    expect(quoteDelete?.args).toEqual({
      where: {
        workspaceId,
        bidCandidateId: {
          in: ["cand-open", "cand-quoted", "cand-converted"],
        },
      },
    });
    expect(calls.some((c) => c.model === "job")).toBe(false);
    expect(calls.some((c) => c.model === "customer")).toBe(false);
  });

  it("M) Candidate deletion is workspace-scoped (predicate uses workspaceId only)", async () => {
    const { prisma, calls } = fakeClient(5, { candidateIds: ["only-this-ws"] });
    await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
      includeBidCandidates: true,
    });
    const candFind = calls.find((c) => c.model === "bidCandidate" && c.op === "findMany");
    expect(candFind?.args).toEqual({
      where: { workspaceId },
      select: { id: true },
    });
    expect(JSON.stringify(candFind?.args)).not.toContain("inboxConnectionId");
  });

  it("Candidates deleted before emails when includeBidCandidates=true", async () => {
    const order: string[] = [];
    const tx = {
      bidCandidate: {
        findMany: async () => {
          order.push("cand-find");
          return [{ id: "c1" }];
        },
        deleteMany: async () => {
          order.push("cand-delete");
          return { count: 1 };
        },
      },
      bidQuoteStaging: {
        deleteMany: async () => {
          order.push("quote-delete");
          return { count: 1 };
        },
      },
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
      mode: "ALL_EMAILS",
      clearedAt,
      includeBidCandidates: true,
    });
    expect(order.indexOf("quote-delete")).toBeLessThan(order.indexOf("cand-delete"));
    expect(order.indexOf("cand-delete")).toBeLessThan(order.indexOf("message"));
    expect(order).not.toContain("attachment");
    expect(order).not.toContain("normalized");
    expect(order.indexOf("task")).toBeLessThan(order.indexOf("classification"));
    expect(order.indexOf("classification")).toBeLessThan(order.indexOf("message"));
  });

  it("removes imported mail and inbox sync, keeps project-folder mail, and sets the watermark", async () => {
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
        fromProjectFolder: false,
      },
    });
    const watermark = calls.find((c) => c.model === "inboxConnection");
    expect(watermark?.args).toEqual({
      where: { id: inboxConnectionId },
      data: { inboxClearedAt: clearedAt, syncCursor: null },
    });
    expect(calls.some((c) => c.model === "job" || c.model === "discoveredFolder")).toBe(false);
  });

  it("sets the watermark in the same transaction as the deletes", async () => {
    const order: string[] = [];
    const tx = {
      bidCandidate: {
        findMany: async () => [],
        deleteMany: async () => ({ count: 0 }),
      },
      bidQuoteStaging: { deleteMany: async () => ({ count: 0 }) },
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
    expect(order).not.toContain("attachment");
    expect(order).not.toContain("normalized");
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
    expect(calls).toEqual(["task:msg-1", "classification", "message:msg-1", "thread:thread-1"]);
    expect(JSON.stringify(calls)).not.toContain("job-2218-other");
  });
});

type EmailWhere = {
  id?: string;
  workspaceId?: string;
  inboxConnectionId?: string;
  jobId?: string | null | { not: null };
  fromProjectFolder?: boolean;
};

type StoreEmail = {
  id: string;
  workspaceId: string;
  inboxConnectionId: string;
  threadId: string;
  jobId: string | null;
  fromProjectFolder: boolean;
};

function matchesEmailWhere(email: StoreEmail, where: EmailWhere): boolean {
  if (where.id && email.id !== where.id) return false;
  if (where.workspaceId && email.workspaceId !== where.workspaceId) return false;
  if (where.inboxConnectionId && email.inboxConnectionId !== where.inboxConnectionId) {
    return false;
  }
  if (where.jobId === null && email.jobId != null) return false;
  if (typeof where.jobId === "string" && email.jobId !== where.jobId) return false;
  if (
    where.jobId &&
    typeof where.jobId === "object" &&
    where.jobId.not === null &&
    email.jobId == null
  ) {
    return false;
  }
  if (where.fromProjectFolder === false && email.fromProjectFolder !== false) return false;
  if (where.fromProjectFolder === true && email.fromProjectFolder !== true) return false;
  return true;
}

/**
 * In-memory mailbox that applies set-based deletes and EmailMessage cascades.
 * Used to exercise bulk shape + rollback without a live database.
 */
function createBulkMailbox(opts?: { failOnMessageDelete?: boolean }) {
  const store = {
    emails: [
      { id: "u1", workspaceId, inboxConnectionId, threadId: "t-unassigned", jobId: null, fromProjectFolder: false },
      { id: "u2", workspaceId, inboxConnectionId, threadId: "t-unassigned", jobId: null, fromProjectFolder: false },
      { id: "u3", workspaceId, inboxConnectionId, threadId: "t-unassigned-empty", jobId: null, fromProjectFolder: false },
      { id: "j1", workspaceId, inboxConnectionId, threadId: "t-job", jobId: "job-canonical", fromProjectFolder: false },
      { id: "j2", workspaceId, inboxConnectionId, threadId: "t-job", jobId: "job-canonical", fromProjectFolder: false },
      { id: "pf1", workspaceId, inboxConnectionId, threadId: "t-project", jobId: null, fromProjectFolder: true },
      { id: "other-mbox", workspaceId, inboxConnectionId: "conn-2", threadId: "t-other", jobId: null, fromProjectFolder: false },
    ] as StoreEmail[],
    attachments: [
      { id: "att-u1a", emailMessageId: "u1" },
      { id: "att-u1b", emailMessageId: "u1" },
      { id: "att-u2", emailMessageId: "u2" },
      { id: "att-j1", emailMessageId: "j1" },
      { id: "att-pf1", emailMessageId: "pf1" },
    ],
    inlineRelevance: [
      { id: "rel-u1a", emailAttachmentId: "att-u1a" },
      { id: "rel-j1", emailAttachmentId: "att-j1" },
    ],
    documentRecords: [
      { id: "doc-u1a", emailAttachmentId: "att-u1a" },
      { id: "doc-j1", emailAttachmentId: "att-j1" },
    ],
    tasks: [
      { id: "task-u1", sourceMessageId: "u1" as string | null },
      { id: "task-u2", sourceMessageId: "u2" as string | null },
      { id: "task-j1", sourceMessageId: "j1" as string | null },
    ],
    classifications: [
      { id: "cls-u1", messageId: "u1" as string | null },
      { id: "cls-u2", messageId: "u2" as string | null },
      { id: "cls-u3", messageId: "u3" as string | null },
      { id: "cls-j1", messageId: "j1" as string | null },
      { id: "cls-pf1", messageId: "pf1" as string | null },
    ],
    classificationCorrections: [
      { id: "corr-u1", classificationId: "cls-u1" },
      { id: "corr-j1", classificationId: "cls-j1" },
    ],
    normalized: [
      { id: "norm-u1", messageId: "u1" },
      { id: "norm-j1", messageId: "j1" },
      { id: "norm-pf1", messageId: "pf1" },
    ],
    threads: [
      { id: "t-unassigned", workspaceId, inboxConnectionId },
      { id: "t-unassigned-empty", workspaceId, inboxConnectionId },
      { id: "t-job", workspaceId, inboxConnectionId },
      { id: "t-project", workspaceId, inboxConnectionId },
      { id: "t-other", workspaceId, inboxConnectionId: "conn-2" },
    ],
    quotes: [
      { id: "q-open", workspaceId, bidCandidateId: "cand-open", emailMessageId: "u1" },
      { id: "q-quoted", workspaceId, bidCandidateId: "cand-quoted", emailMessageId: "u2" },
      { id: "q-converted", workspaceId, bidCandidateId: "cand-converted", emailMessageId: "j1" },
    ],
    candidateEmails: [
      { id: "ce-open", bidCandidateId: "cand-open", emailMessageId: "u1" },
      { id: "ce-quoted", bidCandidateId: "cand-quoted", emailMessageId: "u2" },
      { id: "ce-converted", bidCandidateId: "cand-converted", emailMessageId: "j1" },
    ],
    discoveries: [
      { id: "disc-u1", emailMessageId: "u1" },
      { id: "disc-j1", emailMessageId: "j1" },
    ],
    candidates: [
      { id: "cand-open", workspaceId, canonicalJobId: null as string | null, customerId: "cust-1" },
      { id: "cand-quoted", workspaceId, canonicalJobId: null as string | null, customerId: "cust-1" },
      { id: "cand-converted", workspaceId, canonicalJobId: "job-canonical" as string | null, customerId: "cust-1" },
    ],
    jobs: [{ id: "job-canonical", workspaceId, customerId: "cust-1" }],
    customers: [{ id: "cust-1", workspaceId }],
    connection: {
      id: inboxConnectionId,
      inboxClearedAt: null as Date | null,
      syncCursor: "delta-token-1" as string | null,
    },
    callCounts: {
      task: 0,
      classification: 0,
      emailMessage: 0,
      emailThread: 0,
      emailAttachment: 0,
      normalizedEmail: 0,
    },
  };

  const cascadeFromAttachments = (attachmentIds: Set<string>) => {
    store.inlineRelevance = store.inlineRelevance.filter(
      (row) => !attachmentIds.has(row.emailAttachmentId)
    );
    store.documentRecords = store.documentRecords.filter(
      (row) => !attachmentIds.has(row.emailAttachmentId)
    );
  };

  const cascadeFromEmails = (emailIds: Set<string>) => {
    const removedAttachments = store.attachments.filter((row) =>
      emailIds.has(row.emailMessageId)
    );
    store.attachments = store.attachments.filter((row) => !emailIds.has(row.emailMessageId));
    cascadeFromAttachments(new Set(removedAttachments.map((row) => row.id)));
    store.normalized = store.normalized.filter((row) => !emailIds.has(row.messageId));
    store.quotes = store.quotes.filter((row) => !emailIds.has(row.emailMessageId));
    store.candidateEmails = store.candidateEmails.filter(
      (row) => !emailIds.has(row.emailMessageId)
    );
    store.discoveries = store.discoveries.filter((row) => !emailIds.has(row.emailMessageId));
    for (const cls of store.classifications) {
      if (cls.messageId && emailIds.has(cls.messageId)) cls.messageId = null;
    }
    for (const task of store.tasks) {
      if (task.sourceMessageId && emailIds.has(task.sourceMessageId)) {
        task.sourceMessageId = null;
      }
    }
  };

  const tx = {
    emailAttachment: {
      deleteMany: async (args: { where: { emailMessage: EmailWhere } }) => {
        store.callCounts.emailAttachment += 1;
        const ids = new Set(
          store.emails.filter((email) => matchesEmailWhere(email, args.where.emailMessage)).map((email) => email.id)
        );
        const removed = store.attachments.filter((row) => ids.has(row.emailMessageId));
        store.attachments = store.attachments.filter((row) => !ids.has(row.emailMessageId));
        cascadeFromAttachments(new Set(removed.map((row) => row.id)));
        return { count: removed.length };
      },
    },
    task: {
      deleteMany: async (args: { where: { sourceMessage: EmailWhere } }) => {
        store.callCounts.task += 1;
        const ids = new Set(
          store.emails.filter((email) => matchesEmailWhere(email, args.where.sourceMessage)).map((email) => email.id)
        );
        const before = store.tasks.length;
        store.tasks = store.tasks.filter(
          (row) => !row.sourceMessageId || !ids.has(row.sourceMessageId)
        );
        return { count: before - store.tasks.length };
      },
    },
    classification: {
      deleteMany: async (args: { where: { message: EmailWhere } }) => {
        store.callCounts.classification += 1;
        const ids = new Set(
          store.emails.filter((email) => matchesEmailWhere(email, args.where.message)).map((email) => email.id)
        );
        const removed = store.classifications.filter(
          (row) => row.messageId && ids.has(row.messageId)
        );
        const removedIds = new Set(removed.map((row) => row.id));
        store.classifications = store.classifications.filter((row) => !removedIds.has(row.id));
        store.classificationCorrections = store.classificationCorrections.filter(
          (row) => !removedIds.has(row.classificationId)
        );
        return { count: removed.length };
      },
    },
    normalizedEmail: {
      deleteMany: async (args: { where: { message: EmailWhere } }) => {
        store.callCounts.normalizedEmail += 1;
        const ids = new Set(
          store.emails.filter((email) => matchesEmailWhere(email, args.where.message)).map((email) => email.id)
        );
        const before = store.normalized.length;
        store.normalized = store.normalized.filter((row) => !ids.has(row.messageId));
        return { count: before - store.normalized.length };
      },
    },
    emailMessage: {
      count: async (args: { where: EmailWhere }) =>
        store.emails.filter((email) => matchesEmailWhere(email, args.where)).length,
      deleteMany: async (args: { where: EmailWhere }) => {
        store.callCounts.emailMessage += 1;
        if (opts?.failOnMessageDelete) {
          throw new Error("simulated emailMessage.deleteMany failure");
        }
        const removed = store.emails.filter((email) => matchesEmailWhere(email, args.where));
        const ids = new Set(removed.map((email) => email.id));
        store.emails = store.emails.filter((email) => !ids.has(email.id));
        cascadeFromEmails(ids);
        return { count: removed.length };
      },
    },
    emailThread: {
      deleteMany: async (args: {
        where: { workspaceId: string; inboxConnectionId: string; messages: { none: object } };
      }) => {
        store.callCounts.emailThread += 1;
        const before = store.threads.length;
        store.threads = store.threads.filter((thread) => {
          if (
            thread.workspaceId !== args.where.workspaceId ||
            thread.inboxConnectionId !== args.where.inboxConnectionId
          ) {
            return true;
          }
          const remaining = store.emails.some((email) => email.threadId === thread.id);
          return remaining;
        });
        return { count: before - store.threads.length };
      },
    },
    inboxConnection: {
      update: async (args: {
        where: { id: string };
        data: { inboxClearedAt: Date; syncCursor: null };
      }) => {
        if (store.connection.id !== args.where.id) return {};
        store.connection.inboxClearedAt = args.data.inboxClearedAt;
        store.connection.syncCursor = args.data.syncCursor;
        return store.connection;
      },
    },
    bidCandidate: {
      findMany: async (args: { where: { workspaceId: string } }) =>
        store.candidates
          .filter((row) => row.workspaceId === args.where.workspaceId)
          .map((row) => ({ id: row.id })),
      deleteMany: async (args: { where: { workspaceId: string; id: { in: string[] } } }) => {
        const ids = new Set(args.where.id.in);
        const before = store.candidates.length;
        store.candidates = store.candidates.filter(
          (row) => !(row.workspaceId === args.where.workspaceId && ids.has(row.id))
        );
        store.candidateEmails = store.candidateEmails.filter((row) => !ids.has(row.bidCandidateId));
        return { count: before - store.candidates.length };
      },
    },
    bidQuoteStaging: {
      deleteMany: async (args: {
        where: { workspaceId: string; bidCandidateId: { in: string[] } };
      }) => {
        const ids = new Set(args.where.bidCandidateId.in);
        const before = store.quotes.length;
        store.quotes = store.quotes.filter(
          (row) => !(row.workspaceId === args.where.workspaceId && ids.has(row.bidCandidateId))
        );
        return { count: before - store.quotes.length };
      },
    },
    job: { deleteMany: async () => ({ count: 0 }) },
    customer: { deleteMany: async () => ({ count: 0 }) },
  };

  let transactionOptions: unknown;
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>, options?: unknown) => {
      transactionOptions = options;
      const snapshot = structuredClone(store);
      try {
        return await fn(tx);
      } catch (error) {
        store.emails = snapshot.emails;
        store.attachments = snapshot.attachments;
        store.inlineRelevance = snapshot.inlineRelevance;
        store.documentRecords = snapshot.documentRecords;
        store.tasks = snapshot.tasks;
        store.classifications = snapshot.classifications;
        store.classificationCorrections = snapshot.classificationCorrections;
        store.normalized = snapshot.normalized;
        store.threads = snapshot.threads;
        store.quotes = snapshot.quotes;
        store.candidateEmails = snapshot.candidateEmails;
        store.discoveries = snapshot.discoveries;
        store.candidates = snapshot.candidates;
        store.jobs = snapshot.jobs;
        store.customers = snapshot.customers;
        store.connection = snapshot.connection;
        throw error;
      }
    },
  };

  return { prisma, store, getTransactionOptions: () => transactionOptions };
}

describe("bulk clear inbox fixture", () => {
  it("NON_JOB_ONLY keeps job mail, cleans dependents, and stamps watermark/cursor only after success", async () => {
    const { prisma, store, getTransactionOptions } = createBulkMailbox();
    const audit: string[] = [];
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "NON_JOB_ONLY",
      clearedAt,
    });
    audit.push("success");

    expect(getTransactionOptions()).toEqual({ timeout: 60_000 });
    expect(result.deletedCount).toBe(4);
    expect(result.preservedJobEmailCount).toBe(2);
    expect(store.emails.map((row) => row.id).sort()).toEqual(["j1", "j2", "other-mbox"]);
    expect(store.tasks.map((row) => row.id)).toEqual(["task-j1"]);
    expect(store.classifications.map((row) => row.id)).toEqual(["cls-j1"]);
    expect(store.classificationCorrections.map((row) => row.id)).toEqual(["corr-j1"]);
    expect(store.attachments.map((row) => row.id)).toEqual(["att-j1"]);
    expect(store.normalized.map((row) => row.id)).toEqual(["norm-j1"]);
    expect(store.inlineRelevance.map((row) => row.id)).toEqual(["rel-j1"]);
    expect(store.documentRecords.map((row) => row.id)).toEqual(["doc-j1"]);
    expect(store.threads.map((row) => row.id).sort()).toEqual(["t-job", "t-other"]);
    expect(store.connection.inboxClearedAt).toEqual(clearedAt);
    expect(store.connection.syncCursor).toBeNull();
    expect(store.candidates).toHaveLength(3);
    expect(store.jobs).toEqual([{ id: "job-canonical", workspaceId, customerId: "cust-1" }]);
    expect(store.customers).toEqual([{ id: "cust-1", workspaceId }]);
    expect(store.callCounts).toEqual({
      task: 1,
      classification: 1,
      emailMessage: 1,
      emailThread: 1,
      emailAttachment: 0,
      normalizedEmail: 0,
    });
    expect(audit).toEqual(["success"]);
  });

  it("ALL_EMAILS removes job mail too and still preserves Candidates when include=false", async () => {
    const { prisma, store } = createBulkMailbox();
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
      includeBidCandidates: false,
    });
    expect(result.deletedCount).toBe(6);
    expect(result.removedJobEmailCount).toBe(2);
    expect(result.bidCandidatesDeleted).toBe(0);
    expect(store.emails.map((row) => row.id)).toEqual(["other-mbox"]);
    expect(store.tasks).toEqual([]);
    expect(store.classifications).toEqual([]);
    expect(store.attachments).toEqual([]);
    expect(store.normalized).toEqual([]);
    expect(store.quotes).toEqual([]);
    expect(store.candidateEmails).toEqual([]);
    expect(store.discoveries).toEqual([]);
    expect(store.candidates.map((row) => row.id)).toEqual([
      "cand-open",
      "cand-quoted",
      "cand-converted",
    ]);
    expect(store.jobs[0]?.id).toBe("job-canonical");
    expect(store.customers[0]?.id).toBe("cust-1");
    expect(store.threads.map((row) => row.id)).toEqual(["t-other"]);
  });

  it("HISTORICAL_IMPORT_ONLY keeps project-folder mail", async () => {
    const { prisma, store } = createBulkMailbox();
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "HISTORICAL_IMPORT_ONLY",
      clearedAt,
    });
    expect(result.deletedCount).toBe(5);
    expect(store.emails.map((row) => row.id).sort()).toEqual(["other-mbox", "pf1"]);
    expect(store.attachments.map((row) => row.id)).toEqual(["att-pf1"]);
    expect(store.classifications.map((row) => row.id)).toEqual(["cls-pf1"]);
    expect(store.threads.map((row) => row.id).sort()).toEqual(["t-other", "t-project"]);
    expect(store.connection.syncCursor).toBeNull();
  });

  it("includeBidCandidates=true removes quoted and converted Candidates without deleting Job or Customer", async () => {
    const { prisma, store } = createBulkMailbox();
    const result = await clearConnectionInbox(prisma as never, {
      workspaceId,
      inboxConnectionId,
      mode: "ALL_EMAILS",
      clearedAt,
      includeBidCandidates: true,
    });
    expect(result.bidCandidatesDeleted).toBe(3);
    expect(result.quoteStagingsRemovedWithCandidates).toBe(3);
    expect(store.candidates).toEqual([]);
    expect(store.quotes).toEqual([]);
    expect(store.candidateEmails).toEqual([]);
    expect(store.jobs).toEqual([{ id: "job-canonical", workspaceId, customerId: "cust-1" }]);
    expect(store.customers).toEqual([{ id: "cust-1", workspaceId }]);
  });

  it("simulated transaction failure rolls back deletes, watermark, and cursor", async () => {
    const { prisma, store } = createBulkMailbox({ failOnMessageDelete: true });
    const audit: string[] = [];
    await expect(
      clearConnectionInbox(prisma as never, {
        workspaceId,
        inboxConnectionId,
        mode: "ALL_EMAILS",
        clearedAt,
        includeBidCandidates: true,
      }).then((result) => {
        audit.push("success");
        return result;
      })
    ).rejects.toThrow(/simulated emailMessage.deleteMany failure/);

    expect(audit).toEqual([]);
    expect(store.emails).toHaveLength(7);
    expect(store.tasks).toHaveLength(3);
    expect(store.classifications).toHaveLength(5);
    expect(store.attachments).toHaveLength(5);
    expect(store.candidates).toHaveLength(3);
    expect(store.quotes).toHaveLength(3);
    expect(store.connection.inboxClearedAt).toBeNull();
    expect(store.connection.syncCursor).toBe("delta-token-1");
    expect(store.jobs).toHaveLength(1);
    expect(store.customers).toHaveLength(1);
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

describe("clear inbox side-effect and timeout guards", () => {
  it("does not add provider, S3, matcher, or contact-learning work", () => {
    const src = readFileSync(
      join(here, "../application/services/clear-inbox.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/@aws-sdk|S3Client|DeleteObjectCommand|storageKey/);
    expect(src).not.toMatch(/graph\.microsoft|googleapis|microsoft-graph/i);
    expect(src).not.toMatch(/JobMatcher|learnJobContacts|JobEmailContact/);
    expect(src).toContain("must NEVER\n * honor `deleteFromProviderOnDelete`");
    expect(src).not.toMatch(/emailAttachment\.deleteMany/);
    expect(src).not.toMatch(/normalizedEmail\.deleteMany/);
    expect(src).toContain("timeout: CLEAR_INBOX_TRANSACTION_TIMEOUT_MS");
    expect(src).toContain("task.deleteMany");
    expect(src).toContain("classification.deleteMany");
  });

  it("route writes success audit only after clearConnectionInbox resolves", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/routes/mailbox-control.route.ts"),
      "utf8"
    );
    const handlerStart = src.indexOf(
      '"/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/clear-inbox"'
    );
    const handlerEnd = src.indexOf(
      "/api/v1/workspaces/:workspaceId/monitored-mailboxes",
      handlerStart
    );
    const handler = src.slice(handlerStart, handlerEnd);
    expect(handler.indexOf("await clearConnectionInbox")).toBeGreaterThan(-1);
    expect(handler.indexOf("auditEventLogger.log")).toBeGreaterThan(
      handler.indexOf("await clearConnectionInbox")
    );
    expect(handler).not.toMatch(/s3|DeleteObject|graph\.microsoft|JobMatcher/i);
  });

  it("does not change Prisma's global transaction timeout", () => {
    expect(CLEAR_INBOX_TRANSACTION_TIMEOUT_MS).toBe(60_000);
    const prismaClient = readFileSync(
      join(here, "../../../../packages/db/src/client.ts"),
      "utf8"
    );
    expect(prismaClient).not.toMatch(/transactionOptions/);
    expect(prismaClient).not.toMatch(/timeout:\s*60_000/);
  });
});
