import type { Prisma, PrismaClient } from "@prisma/client";

/** A deleted job must not leave the folder looking verified or suggested. */
export const clearedFolderMatchData = {
  matchedJobId: null,
  status: "DISCOVERED" as const,
  matchConfidence: null,
  matchReason: null,
  approvedAt: null,
  approvedByUserId: null,
};

export function shouldPreserveFolderMatch(
  status: string,
  matchedJobId: string | null,
): boolean {
  if (status === "IGNORED") return true;
  if ((status === "APPROVED" || status === "MATCHED") && Boolean(matchedJobId)) return true;
  return false;
}

export function foldersMatchedToJobWhere(
  workspaceId: string,
  jobId: string,
): Prisma.DiscoveredFolderWhereInput {
  return {
    workspaceId,
    matchedJobId: jobId,
    status: { in: ["APPROVED", "MATCHED", "DISCOVERED"] },
  };
}

/** Verified or suggested rows whose job is already gone. */
export function orphanedFolderMatchWhere(workspaceId: string): Prisma.DiscoveredFolderWhereInput {
  return {
    workspaceId,
    matchedJobId: null,
    status: { in: ["APPROVED", "MATCHED"] },
  };
}

type FolderMatchDb = PrismaClient | Prisma.TransactionClient;

export async function releaseFoldersForDeletedJob(
  db: FolderMatchDb,
  workspaceId: string,
  jobId: string,
): Promise<void> {
  await db.discoveredFolder.updateMany({
    where: foldersMatchedToJobWhere(workspaceId, jobId),
    data: clearedFolderMatchData,
  });
  // Ignored/archived rows still hold the composite FK. Drop the job id only.
  await db.discoveredFolder.updateMany({
    where: { workspaceId, matchedJobId: jobId },
    data: { matchedJobId: null },
  });
}

export async function releaseOrphanedFolderMatches(
  db: FolderMatchDb,
  workspaceId: string,
): Promise<number> {
  // Null job ids left the folder verified. A stored id with no Job row is the
  // same situation when the foreign key did not clear it.
  const cleared = await db.$executeRaw`
    UPDATE "DiscoveredFolder" AS f
    SET
      "matchedJobId" = NULL,
      "status" = CASE
        WHEN f."status" IN ('IGNORED', 'ARCHIVED') THEN f."status"
        ELSE 'DISCOVERED'::"FolderStatus"
      END,
      "matchConfidence" = CASE
        WHEN f."status" IN ('IGNORED', 'ARCHIVED') THEN f."matchConfidence"
        ELSE NULL
      END,
      "matchReason" = CASE
        WHEN f."status" IN ('IGNORED', 'ARCHIVED') THEN f."matchReason"
        ELSE NULL
      END,
      "approvedAt" = CASE
        WHEN f."status" IN ('IGNORED', 'ARCHIVED') THEN f."approvedAt"
        ELSE NULL
      END,
      "approvedByUserId" = CASE
        WHEN f."status" IN ('IGNORED', 'ARCHIVED') THEN f."approvedByUserId"
        ELSE NULL
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE f."workspaceId" = ${workspaceId}
      AND (
        (
          f."matchedJobId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "Job" j
            WHERE j."id" = f."matchedJobId"
              AND j."workspaceId" = f."workspaceId"
          )
        )
        OR (
          f."matchedJobId" IS NULL
          AND f."status" IN ('APPROVED', 'MATCHED')
        )
      )
  `;
  return Number(cleared);
}
