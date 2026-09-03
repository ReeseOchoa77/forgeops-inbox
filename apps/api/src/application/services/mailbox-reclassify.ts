import type { PrismaClient } from "@prisma/client";
import {
  BUSINESS_SUBTYPE_KEYS,
} from "@forgeops/ai";
import {
  buildMailboxReclassifyWhere,
  classifierGeneratedTaskKeyFilter,
  MAILBOX_RECLASSIFY_MAX_SELECTED,
  MAILBOX_RECLASSIFY_PREVIEW_SAMPLE,
  type MailboxReclassifyFilters,
  type ReclassifyTaskMode,
} from "@forgeops/shared";

export class MailboxReclassifyError extends Error {
  readonly code:
    | "CONNECTION_NOT_FOUND"
    | "NOT_NATIVE"
    | "INVALID_REQUEST"
    | "RUN_NOT_FOUND"
    | "RUN_NOT_CANCELLABLE"
    | "ACTIVE_RUN_EXISTS";

  constructor(
    code: MailboxReclassifyError["code"],
    message: string
  ) {
    super(message);
    this.name = "MailboxReclassifyError";
    this.code = code;
  }
}

export async function assertNativeMailbox(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
}): Promise<{ id: string; email: string; ingestionSource: string; status: string; provider: string }> {
  const conn = await input.prisma.inboxConnection.findFirst({
    where: {
      id: input.inboxConnectionId,
      workspaceId: input.workspaceId,
    },
    select: {
      id: true,
      email: true,
      ingestionSource: true,
      status: true,
      provider: true,
    },
  });
  if (!conn) {
    throw new MailboxReclassifyError("CONNECTION_NOT_FOUND", "Mailbox not found");
  }
  if (conn.ingestionSource !== "NATIVE") {
    throw new MailboxReclassifyError(
      "NOT_NATIVE",
      "Reclassify is only available for NATIVE mailboxes"
    );
  }
  return conn;
}

export function sanitizeReclassifyFilters(
  raw: MailboxReclassifyFilters
): MailboxReclassifyFilters {
  const keys = (raw.businessTypeKeys ?? []).filter((k) =>
    (BUSINESS_SUBTYPE_KEYS as readonly string[]).includes(k)
  );
  const { businessTypeKeys: _drop, ...rest } = raw;
  return {
    ...rest,
    ...(keys.length > 0 ? { businessTypeKeys: keys } : {}),
  };
}

export async function previewMailboxReclassify(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  filters: MailboxReclassifyFilters;
  messageIds?: string[];
  taskMode?: ReclassifyTaskMode;
}): Promise<{
  totalMatched: number;
  classifierTasksToRemove: number;
  taskMode: ReclassifyTaskMode;
  breakdown: {
    byProcessingStatus: Record<string, number>;
    byMailboxCategory: Record<string, number>;
    read: number;
    unread: number;
  };
  sample: Array<{
    id: string;
    subject: string | null;
    senderEmail: string;
    receivedAt: string | null;
    sentAt: string;
    mailboxCategory: string;
    classificationStatus: string | null;
    priority: string | null;
    jobId: string | null;
    businessTypeKey: string | null;
    isRead: boolean;
  }>;
}> {
  const conn = await assertNativeMailbox(input);
  const filters = sanitizeReclassifyFilters(input.filters);
  const taskMode = input.taskMode === "REGENERATE" ? "REGENERATE" : "REMOVE_ONLY";
  if (
    input.messageIds &&
    input.messageIds.length > MAILBOX_RECLASSIFY_MAX_SELECTED
  ) {
    throw new MailboxReclassifyError(
      "INVALID_REQUEST",
      `At most ${MAILBOX_RECLASSIFY_MAX_SELECTED} selected message ids`
    );
  }

  const where = buildMailboxReclassifyWhere({
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    mailboxEmail: conn.email,
    filters,
    ...(input.messageIds ? { messageIds: input.messageIds } : {}),
  });

  const [
    totalMatched,
    sampleRows,
    statusGroups,
    categoryGroups,
    readGroups,
    classifierTasksToRemove,
  ] = await Promise.all([
      input.prisma.emailMessage.count({ where }),
      input.prisma.emailMessage.findMany({
        where,
        orderBy: [{ receivedAt: "desc" }, { sentAt: "desc" }],
        take: MAILBOX_RECLASSIFY_PREVIEW_SAMPLE,
        select: {
          id: true,
          subject: true,
          senderEmail: true,
          receivedAt: true,
          sentAt: true,
          mailboxCategory: true,
          classificationStatus: true,
          priority: true,
          jobId: true,
          isRead: true,
          classifications: {
            select: { businessTypeKey: true },
            take: 1,
            orderBy: { updatedAt: "desc" },
          },
        },
      }),
      input.prisma.emailMessage.groupBy({
        by: ["classificationStatus"],
        where,
        _count: { _all: true },
      }),
      input.prisma.emailMessage.groupBy({
        by: ["mailboxCategory"],
        where,
        _count: { _all: true },
      }),
      input.prisma.emailMessage.groupBy({
        by: ["isRead"],
        where,
        _count: { _all: true },
      }),
      input.prisma.task.count({
        where: {
          workspaceId: input.workspaceId,
          ...classifierGeneratedTaskKeyFilter(),
          sourceMessage: where,
        },
      }),
    ]);

  const byProcessingStatus: Record<string, number> = {};
  for (const g of statusGroups) {
    byProcessingStatus[g.classificationStatus ?? "NULL"] = g._count._all;
  }
  const byMailboxCategory: Record<string, number> = {};
  for (const g of categoryGroups) {
    byMailboxCategory[g.mailboxCategory] = g._count._all;
  }
  let read = 0;
  let unread = 0;
  for (const g of readGroups) {
    if (g.isRead) read = g._count._all;
    else unread = g._count._all;
  }

  return {
    totalMatched,
    classifierTasksToRemove,
    taskMode,
    breakdown: { byProcessingStatus, byMailboxCategory, read, unread },
    sample: sampleRows.map((r) => ({
      id: r.id,
      subject: r.subject,
      senderEmail: r.senderEmail,
      receivedAt: r.receivedAt?.toISOString() ?? null,
      sentAt: r.sentAt.toISOString(),
      mailboxCategory: r.mailboxCategory,
      classificationStatus: r.classificationStatus,
      priority: r.priority,
      jobId: r.jobId,
      businessTypeKey: r.classifications[0]?.businessTypeKey ?? null,
      isRead: r.isRead,
    })),
  };
}

export async function searchMailboxSenders(input: {
  prisma: PrismaClient;
  workspaceId: string;
  inboxConnectionId: string;
  q: string;
  limit?: number;
}): Promise<Array<{ senderEmail: string; count: number }>> {
  await assertNativeMailbox(input);
  const term = input.q.trim();
  if (term.length < 2) return [];
  const take = Math.min(Math.max(input.limit ?? 20, 1), 50);

  const rows = await input.prisma.emailMessage.groupBy({
    by: ["senderEmail"],
    where: {
      workspaceId: input.workspaceId,
      inboxConnectionId: input.inboxConnectionId,
      senderEmail: { contains: term, mode: "insensitive" },
    },
    _count: { _all: true },
    orderBy: { _count: { senderEmail: "desc" } },
    take,
  });

  return rows.map((r) => ({
    senderEmail: r.senderEmail,
    count: r._count._all,
  }));
}
