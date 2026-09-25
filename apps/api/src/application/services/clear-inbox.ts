import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * NON_JOB_ONLY keeps Job emails. ALL_EMAILS removes every mailbox email.
 * HISTORICAL_IMPORT_ONLY removes Import Previous Emails and regular inbox
 * sync. Project-folder analysis stays.
 */
export type ClearInboxMode = "NON_JOB_ONLY" | "ALL_EMAILS" | "HISTORICAL_IMPORT_ONLY";

export function clearInboxMessageWhere(input: {
  workspaceId: string;
  inboxConnectionId: string;
  mode: ClearInboxMode;
}): Prisma.EmailMessageWhereInput {
  return {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
    ...(input.mode === "NON_JOB_ONLY" ? { jobId: null } : {}),
    ...(input.mode === "HISTORICAL_IMPORT_ONLY" ? { fromProjectFolder: false } : {}),
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
): Promise<{
  unassignedCount: number;
  jobAssociatedCount: number;
  nonProjectFolderCount: number;
  projectFolderCount: number;
}> {
  const base = {
    workspaceId: input.workspaceId,
    inboxConnectionId: input.inboxConnectionId,
  };
  const [unassignedCount, jobAssociatedCount, nonProjectFolderCount, projectFolderCount] =
    await Promise.all([
      prisma.emailMessage.count({ where: { ...base, jobId: null } }),
      prisma.emailMessage.count({ where: { ...base, jobId: { not: null } } }),
      prisma.emailMessage.count({ where: { ...base, fromProjectFolder: false } }),
      prisma.emailMessage.count({ where: { ...base, fromProjectFolder: true } }),
    ]);
  return { unassignedCount, jobAssociatedCount, nonProjectFolderCount, projectFolderCount };
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
    // Every mode deletes live inbox mail, so the watermark has to move or
    // the next sync brings those messages back. Project-folder analysis
    // bypasses the watermark and is kept by HISTORICAL_IMPORT_ONLY.
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
