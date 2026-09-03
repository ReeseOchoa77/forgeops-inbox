import type { PrismaClient, Prisma } from "@prisma/client";
import {
  QueueNames,
  buildProjectFolderEmailAnalyzeJobId,
  emptyProjectFolderEmailAnalyzeProgress,
  type ProjectFolderEmailAnalyzeJobPayload,
  type ProjectFolderEmailAnalyzeJobResult,
} from "@forgeops/shared";
import type { Queue } from "bullmq";

export class ProjectFolderEmailAnalyzeError extends Error {
  readonly code:
    | "CONNECTION_NOT_FOUND"
    | "NOT_OUTLOOK"
    | "NOT_AUTHORIZED"
    | "NO_VERIFIED_FOLDERS"
    | "INVALID_REQUEST"
    | "ENQUEUE_FAILED";

  constructor(code: ProjectFolderEmailAnalyzeError["code"], message: string) {
    super(message);
    this.name = "ProjectFolderEmailAnalyzeError";
    this.code = code;
  }
}

/**
 * Create a run row and enqueue worker analysis for VERIFIED folders only.
 * Re-validates folder status server-side — never trusts client matchedJobId alone.
 */
export async function enqueueProjectFolderEmailAnalyze(input: {
  prisma: PrismaClient;
  queue: Queue<
    ProjectFolderEmailAnalyzeJobPayload,
    ProjectFolderEmailAnalyzeJobResult
  >;
  workspaceId: string;
  connectionId: string;
  /** When empty / omitted, analyze all verified folders for this mailbox. */
  folderIds?: string[];
  initiatedByUserId?: string;
}): Promise<{ runId: string }> {
  const connection = await input.prisma.inboxConnection.findFirst({
    where: {
      id: input.connectionId,
      workspaceId: input.workspaceId,
      status: { not: "DISCONNECTED" },
    },
    select: {
      id: true,
      provider: true,
      email: true,
      encryptedRefreshToken: true,
    },
  });

  if (!connection) {
    throw new ProjectFolderEmailAnalyzeError(
      "CONNECTION_NOT_FOUND",
      "Mailbox connection not found in this workspace"
    );
  }
  if (connection.provider !== "OUTLOOK") {
    throw new ProjectFolderEmailAnalyzeError(
      "NOT_OUTLOOK",
      "Folder email analysis currently supports Outlook only"
    );
  }
  if (!connection.encryptedRefreshToken) {
    throw new ProjectFolderEmailAnalyzeError(
      "NOT_AUTHORIZED",
      "Mailbox is not authorized — reconnect OAuth before analyzing emails"
    );
  }

  const requestedIds = (input.folderIds ?? []).filter(Boolean);

  const verified = await input.prisma.discoveredFolder.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: "APPROVED",
      matchedJobId: { not: null },
      missingFromProvider: false,
      OR: [
        { inboxConnectionId: connection.id },
        { inboxConnectionId: null, mailboxEmail: connection.email },
      ],
      ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
    },
    select: { id: true, status: true, matchedJobId: true },
  });

  if (verified.length === 0) {
    throw new ProjectFolderEmailAnalyzeError(
      "NO_VERIFIED_FOLDERS",
      requestedIds.length > 0
        ? "None of the selected folders are VERIFIED for this mailbox"
        : "No VERIFIED project folders found for this mailbox"
    );
  }

  // Reject if client asked for folders that are not verified
  if (requestedIds.length > 0 && verified.length !== requestedIds.length) {
    const ok = new Set(verified.map((v) => v.id));
    const bad = requestedIds.filter((id) => !ok.has(id));
    throw new ProjectFolderEmailAnalyzeError(
      "INVALID_REQUEST",
      `Only VERIFIED folders can be analyzed (rejected: ${bad.slice(0, 5).join(", ")})`
    );
  }

  const progress = emptyProjectFolderEmailAnalyzeProgress();
  progress.foldersTotal = verified.length;

  const run = await input.prisma.projectFolderEmailAnalyzeRun.create({
    data: {
      workspaceId: input.workspaceId,
      inboxConnectionId: connection.id,
      status: "PENDING",
      folderIds: verified.map((v) => v.id),
      progress: progress as unknown as Prisma.InputJsonValue,
      initiatedByUserId: input.initiatedByUserId ?? null,
    },
  });

  const payload: ProjectFolderEmailAnalyzeJobPayload = {
    workspaceId: input.workspaceId,
    inboxConnectionId: connection.id,
    runId: run.id,
    ...(input.initiatedByUserId
      ? { initiatedBy: input.initiatedByUserId }
      : {}),
  };

  try {
    await input.queue.add(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, payload, {
      jobId: buildProjectFolderEmailAnalyzeJobId(run.id),
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { count: 20 },
      removeOnFail: { count: 40 },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await input.prisma.projectFolderEmailAnalyzeRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorMessage: `enqueue failed: ${msg}`.slice(0, 2000),
          completedAt: new Date(),
        },
      })
      .catch(() => {});
    throw new ProjectFolderEmailAnalyzeError(
      "ENQUEUE_FAILED",
      `Failed to enqueue folder email analysis: ${msg}`
    );
  }

  return { runId: run.id };
}
