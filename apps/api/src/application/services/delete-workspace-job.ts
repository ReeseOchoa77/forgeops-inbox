import { Prisma, type PrismaClient } from "@prisma/client";
import { releaseFoldersForDeletedJob } from "./release-folder-job-match.js";

export type DeleteWorkspaceJobResult =
  | {
      ok: true;
      job: { id: string; name: string; jobNumber: string | null; status: string };
      storageKeys: string[];
    }
  | { ok: false; code: "NOT_FOUND" };

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Permanently delete a Job and Job-owned project records.
 *
 * Survives (unlinked):
 * - EmailMessage (+ EmailAttachment) — jobId cleared, assignment provenance normalized
 * - Classification.jobId, Task.jobId (composite SetNull is unsafe — cleared manually)
 * - CalendarEvent.linkedJobId / KnowledgeDocument.linkedJobId (simple SetNull on job.delete)
 * - DiscoveredFolder match (released via releaseFoldersForDeletedJob)
 * - Customer, Vendor, EntityContact, User
 *
 * Cascades with Job (schema onDelete: Cascade):
 * - participants, work packages, milestones, documents/files/folders,
 *   fabrication, RFIs/directives/changes/COs, procurement/POs,
 *   shipments/installations, invoices, members, activity log
 *
 * EntityAlias JOB rows are hard-deleted (SetNull would leave orphans).
 *
 * No migration — uses existing FKs + explicit pre-clear for composite SetNull.
 */
export async function deleteWorkspaceJob(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
): Promise<DeleteWorkspaceJobResult> {
  const existing = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true, name: true, jobNumber: true, status: true },
  });
  if (!existing) return { ok: false, code: "NOT_FOUND" };

  // Collect storage keys before cascade removes JobFile rows.
  const files = await prisma.jobFile.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    select: { storageKey: true },
  });
  const storageKeys = files
    .map((f) => f.storageKey)
    .filter((key): key is string => typeof key === "string" && key.length > 0);

  await prisma.$transaction(async (tx) => {
    await unlinkJobSurvivors(tx, input.workspaceId, input.jobId);
    await tx.job.delete({ where: { id: input.jobId } });
  });

  return {
    ok: true,
    job: existing,
    storageKeys,
  };
}

/** Exposed for unit tests — transactional unlink steps before job.delete. */
export async function unlinkJobSurvivors(
  tx: Db,
  workspaceId: string,
  jobId: string
): Promise<void> {
  // Composite FKs cannot ON DELETE SET NULL (workspaceId is required).
  await tx.classification.updateMany({
    where: { workspaceId, jobId },
    data: { jobId: null },
  });
  await tx.task.updateMany({
    where: { workspaceId, jobId },
    data: { jobId: null },
  });

  // Prefer explicit unlink so assignment provenance is normalized (SetNull alone
  // would leave jobMatch*/jobAssignment* fields pointing at a deleted Job).
  await tx.emailMessage.updateMany({
    where: { workspaceId, jobId },
    data: {
      jobId: null,
      jobMatchConfidence: null,
      jobMatchEvidence: Prisma.DbNull,
      jobAssignmentSource: null,
      jobAssignedAt: null,
      jobAssignedByUserId: null,
      jobAssignmentIsManual: false,
    },
  });

  await releaseFoldersForDeletedJob(tx, workspaceId, jobId);

  await tx.entityAlias.deleteMany({
    where: { workspaceId, jobId },
  });
}
