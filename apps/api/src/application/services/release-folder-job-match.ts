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
  const result = await db.discoveredFolder.updateMany({
    where: orphanedFolderMatchWhere(workspaceId),
    data: clearedFolderMatchData,
  });
  return result.count;
}
