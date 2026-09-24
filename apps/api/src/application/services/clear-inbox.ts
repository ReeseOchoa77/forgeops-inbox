import type { Prisma, PrismaClient } from "@prisma/client";

/** Safe clear keeps Job emails. Clear all removes every mailbox email. */
export type ClearInboxMode = "NON_JOB_ONLY" | "ALL_EMAILS";

export function clearInboxMessageWhere(input: {
  workspaceId: string;
  inboxConnectionId: string;
  mode: ClearInboxMode;
}): Prisma.EmailMessageWhereInput {
  return {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    ...(input.mode === "NON_JOB_ONLY" ? { jobId: null } : {}),
  };
}

/**
 * Delete EmailMessage rows matching `where`, plus email-owned children.
 * Threads are removed only when they have no messages left.
 * Does not delete Jobs, Customers, or DiscoveredFolder rows.
 * Does not call the mail provider.
 */
export async function deleteScopedEmailMessages(
  tx: Prisma.TransactionClient,
  input: {
    where: Prisma.EmailMessageWhereInput;
    emptyThreadWhere: Prisma.EmailThreadWhereInput;
  }
): Promise<number> {
  await tx.emailAttachment.deleteMany({
    where: { emailMessage: input.where },
  });
  await tx.task.deleteMany({
    where: { sourceMessage: input.where },
  });
  await tx.classification.deleteMany({
    where: { message: input.where },
  });
  await tx.normalizedEmail.deleteMany({
    where: { message: input.where },
  });
  const deleted = await tx.emailMessage.deleteMany({ where: input.where });
  await tx.emailThread.deleteMany({ where: input.emptyThreadWhere });
  return deleted.count;
}

export async function previewClearInbox(
  prisma: PrismaClient,
  input: { workspaceId: string; inboxConnectionId: string }
): Promise<{ unassignedCount: number; jobAssociatedCount: number }> {
  const base = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
  };
  const [unassignedCount, jobAssociatedCount] = await Promise.all([
    prisma.emailMessage.count({ where: { ...base, jobId: null } }),
    prisma.emailMessage.count({ where: { ...base, jobId: { not: null } } }),
  ]);
  return { unassignedCount, jobAssociatedCount };
}

export async function clearConnectionInbox(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    inboxConnectionId: string;
    mode: ClearInboxMode;
    clearedAt: Date;
  }
): Promise<{
  deletedCount: number;
  preservedJobEmailCount: number;
  removedJobEmailCount: number;
}> {
  const messageWhere = clearInboxMessageWhere(input);
  return prisma.$transaction(async (tx) => {
    const jobAssociatedCount = await tx.emailMessage.count({
      where: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        jobId: { not: null },
      },
    });
    const deletedCount = await deleteScopedEmailMessages(tx, {
      where: messageWhere,
      emptyThreadWhere: {
        workspaceId: input.workspaceId,
        inboxConnectionId: input.inboxConnectionId,
        messages: { none: {} },
      },
    });
    await tx.inboxConnection.update({
      where: { id: input.inboxConnectionId },
      data: {
        inboxClearedAt: input.clearedAt,
        syncCursor: null,
      },
    });
    return {
      deletedCount,
      preservedJobEmailCount: input.mode === "NON_JOB_ONLY" ? jobAssociatedCount : 0,
      removedJobEmailCount: input.mode === "ALL_EMAILS" ? jobAssociatedCount : 0,
    };
  });
}
