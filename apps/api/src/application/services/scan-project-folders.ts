import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  matchFolderToExistingJobs,
  normalizeName,
  PROJECTS_ROOT_DISPLAY_NAME,
  type JobAliasCandidate,
  type JobMatchCandidate,
} from "@forgeops/shared";

import {
  discoverFoldersUnderProjectsRoot,
  resolveProjectsRoot,
  type DiscoveredGraphFolder,
} from "./outlook-mail-folders.js";

export class ProjectFolderScanError extends Error {
  readonly code:
    | "CONNECTION_NOT_FOUND"
    | "NOT_OUTLOOK"
    | "NOT_AUTHORIZED"
    | "OUTLOOK_NOT_CONFIGURED"
    | "TOKEN_REFRESH_FAILED"
    | "PROJECTS_NOT_FOUND"
    | "PROJECTS_AMBIGUOUS"
    | "GRAPH_FAILED";

  readonly details?: unknown;

  constructor(
    code: ProjectFolderScanError["code"],
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "ProjectFolderScanError";
    this.code = code;
    this.details = details;
  }
}

export type ProjectFolderScanSummary = {
  projectsRoot: { id: string; path: string; displayName: string };
  totalUnderProjects: number;
  candidates: number;
  created: number;
  updated: number;
  missingMarked: number;
  verified: number;
  suggested: number;
  unmatched: number;
};

type OutlookTokenEnv = {
  OUTLOOK_CLIENT_ID?: string | undefined;
  OUTLOOK_CLIENT_SECRET?: string | undefined;
  OUTLOOK_TENANT_ID?: string | undefined;
};

async function refreshOutlookAccessToken(input: {
  refreshToken: string;
  env: OutlookTokenEnv;
}): Promise<string> {
  const { env } = input;
  if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) {
    throw new ProjectFolderScanError(
      "OUTLOOK_NOT_CONFIGURED",
      "Outlook is not configured on this server"
    );
  }
  const tenant = env.OUTLOOK_TENANT_ID || "common";
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env.OUTLOOK_CLIENT_ID,
    client_secret: env.OUTLOOK_CLIENT_SECRET,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
    scope: "https://graph.microsoft.com/Mail.Read offline_access",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new ProjectFolderScanError(
      "TOKEN_REFRESH_FAILED",
      "Failed to refresh Outlook access token"
    );
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new ProjectFolderScanError(
      "TOKEN_REFRESH_FAILED",
      "Outlook token response missing access_token"
    );
  }
  return json.access_token;
}

function toConfidence(value: number | null): Prisma.Decimal | null {
  if (value == null) return null;
  return new Prisma.Decimal(Math.max(0, Math.min(1, value)).toFixed(4));
}

/**
 * Persist Graph folders under /Projects and match against existing Jobs.
 * Directory discovery ONLY — never lists folder messages, creates EmailMessage,
 * classifies, or enqueues attachments. Idempotent on
 * (workspaceId, mailboxEmail, providerFolderId).
 */
export async function scanNativeProjectFolders(input: {
  prisma: PrismaClient;
  workspaceId: string;
  connectionId: string;
  decryptRefreshToken: (encrypted: string) => string;
  env: OutlookTokenEnv;
  actorUserId?: string;
}): Promise<ProjectFolderScanSummary> {
  const connection = await input.prisma.inboxConnection.findFirst({
    where: {
      id: input.connectionId,
      workspaceId: input.workspaceId,
      status: { in: ["ACTIVE", "PAUSED", "ERROR", "REQUIRES_REAUTH"] },
    },
    select: {
      id: true,
      provider: true,
      email: true,
      encryptedRefreshToken: true,
      status: true,
    },
  });

  if (!connection) {
    throw new ProjectFolderScanError(
      "CONNECTION_NOT_FOUND",
      "Mailbox connection not found in this workspace"
    );
  }
  if (connection.provider !== "OUTLOOK") {
    throw new ProjectFolderScanError(
      "NOT_OUTLOOK",
      "Project folder discovery currently supports Outlook only"
    );
  }
  if (!connection.encryptedRefreshToken) {
    throw new ProjectFolderScanError(
      "NOT_AUTHORIZED",
      "Mailbox is not authorized — reconnect OAuth before scanning"
    );
  }

  const refreshToken = input.decryptRefreshToken(connection.encryptedRefreshToken);
  const accessToken = await refreshOutlookAccessToken({
    refreshToken,
    env: input.env,
  });

  let graphFolders: DiscoveredGraphFolder[];
  let projectsRoot: { id: string; path: string; displayName: string };

  try {
    const resolved = await resolveProjectsRoot(
      accessToken,
      PROJECTS_ROOT_DISPLAY_NAME
    );
    if (resolved.status === "not_found") {
      throw new ProjectFolderScanError("PROJECTS_NOT_FOUND", resolved.message);
    }
    if (resolved.status === "ambiguous") {
      throw new ProjectFolderScanError(
        "PROJECTS_AMBIGUOUS",
        resolved.message,
        { candidates: resolved.candidates }
      );
    }
    projectsRoot = {
      id: resolved.root.id,
      path: resolved.path,
      displayName: resolved.root.displayName,
    };
    graphFolders = await discoverFoldersUnderProjectsRoot(
      accessToken,
      resolved.root,
      resolved.path
    );
  } catch (e) {
    if (e instanceof ProjectFolderScanError) throw e;
    throw new ProjectFolderScanError(
      "GRAPH_FAILED",
      e instanceof Error ? e.message : "Graph folder discovery failed"
    );
  }

  const mailboxEmail = connection.email.toLowerCase();

  // Ensure a Projects JobFolderRoot exists for this workspace (config + future filters).
  const projectsNormalized = normalizeName(PROJECTS_ROOT_DISPLAY_NAME);
  await input.prisma.jobFolderRoot.upsert({
    where: {
      workspaceId_normalizedName: {
        workspaceId: input.workspaceId,
        normalizedName: projectsNormalized,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      rootName: PROJECTS_ROOT_DISPLAY_NAME,
      normalizedName: projectsNormalized,
      mailboxEmail,
      provider: "OUTLOOK",
      providerFolderId: projectsRoot.id,
      folderPath: projectsRoot.path,
      folderName: projectsRoot.displayName,
      active: true,
      isActive: true,
      createdByUserId: input.actorUserId ?? null,
    },
    update: {
      mailboxEmail,
      providerFolderId: projectsRoot.id,
      folderPath: projectsRoot.path,
      folderName: projectsRoot.displayName,
      active: true,
      isActive: true,
    },
  });

  const jobs = await input.prisma.job.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: { in: ["ACTIVE", "ON_HOLD"] },
    },
    select: {
      id: true,
      jobNumber: true,
      name: true,
      normalizedName: true,
      customer: { select: { name: true } },
    },
  });
  const jobCandidates: JobMatchCandidate[] = jobs.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    name: j.name,
    normalizedName: j.normalizedName,
    customerName: j.customer?.name ?? null,
  }));

  const aliasesRaw = await input.prisma.entityAlias.findMany({
    where: {
      workspaceId: input.workspaceId,
      entityType: "JOB",
      jobId: { not: null },
    },
    select: { jobId: true, normalizedAlias: true, source: true },
  });
  const aliases: JobAliasCandidate[] = aliasesRaw
    .filter((a): a is typeof a & { jobId: string } => Boolean(a.jobId))
    .map((a) => ({
      jobId: a.jobId,
      normalizedAlias: a.normalizedAlias,
      source: a.source,
    }));

  const candidates = graphFolders.filter((f) => !f.isRoot);
  const seenProviderIds = new Set(graphFolders.map((f) => f.id));

  let created = 0;
  let updated = 0;
  let verified = 0;
  let suggested = 0;
  let unmatched = 0;

  const now = new Date();

  for (const folder of candidates) {
    const match = matchFolderToExistingJobs({
      folderName: folder.displayName,
      jobs: jobCandidates,
      aliases,
    });

    if (match.status === "APPROVED") verified += 1;
    else if (match.status === "MATCHED") suggested += 1;
    else unmatched += 1;

    const existing =
      (await input.prisma.discoveredFolder.findUnique({
        where: {
          workspaceId_mailboxEmail_providerFolderId: {
            workspaceId: input.workspaceId,
            mailboxEmail,
            providerFolderId: folder.id,
          },
        },
      })) ??
      // Legacy / casing variants: same provider folder for this mailbox, possibly
      // with NULL inboxConnectionId or non-normalized mailboxEmail.
      (await input.prisma.discoveredFolder.findFirst({
        where: {
          workspaceId: input.workspaceId,
          providerFolderId: folder.id,
          OR: [
            { inboxConnectionId: connection.id },
            {
              inboxConnectionId: null,
              mailboxEmail: { equals: mailboxEmail, mode: "insensitive" },
            },
          ],
        },
      }));

    const scalarFields = {
      inboxConnectionId: connection.id,
      mailboxEmail,
      provider: "OUTLOOK" as const,
      parentProviderFolderId: folder.parentFolderId,
      folderPath: folder.path,
      rawFolderName: folder.displayName,
      normalizedFolderName: normalizeName(folder.displayName),
      detectedJobNumber: match.detectedJobNumber,
      detectedJobName: match.detectedJobName,
      childFolderCount: folder.childFolderCount,
      lastSeenAt: now,
      missingFromProvider: false,
    };

    if (existing) {
      // Preserve manual VERIFIED / IGNORED / user MATCHED unless still DISCOVERED.
      const preserveMatch =
        existing.status === "APPROVED" ||
        existing.status === "IGNORED" ||
        (existing.status === "MATCHED" && Boolean(existing.matchedJobId));

      const updateData: Prisma.DiscoveredFolderUpdateInput = {
        ...scalarFields,
      };

      if (!preserveMatch) {
        updateData.matchedJob =
          match.matchedJobId == null
            ? { disconnect: true }
            : {
                connect: {
                  workspaceId_id: {
                    workspaceId: input.workspaceId,
                    id: match.matchedJobId,
                  },
                },
              };
        updateData.status = match.status;
        updateData.matchConfidence = toConfidence(match.confidence);
        updateData.matchReason = match.reason;
        if (match.status === "APPROVED") {
          updateData.approvedAt = now;
          updateData.approvedByUserId = input.actorUserId ?? null;
        }
      }

      await input.prisma.discoveredFolder.update({
        where: { id: existing.id },
        data: updateData,
      });

      const effectiveJobId = preserveMatch
        ? existing.matchedJobId
        : match.matchedJobId;
      const effectiveStatus = preserveMatch ? existing.status : match.status;
      if (effectiveJobId && effectiveStatus === "APPROVED") {
        await input.prisma.entityAlias.upsert({
          where: {
            workspaceId_entityType_normalizedAlias: {
              workspaceId: input.workspaceId,
              entityType: "JOB",
              normalizedAlias: normalizeName(folder.displayName),
            },
          },
          update: { jobId: effectiveJobId, source: "OUTLOOK_FOLDER" },
          create: {
            workspaceId: input.workspaceId,
            entityType: "JOB",
            jobId: effectiveJobId,
            alias: folder.displayName,
            normalizedAlias: normalizeName(folder.displayName),
            source: "OUTLOOK_FOLDER",
          },
        });
      }

      updated += 1;
    } else {
      await input.prisma.discoveredFolder.create({
        data: {
          workspaceId: input.workspaceId,
          providerFolderId: folder.id,
          matchedJobId: match.matchedJobId,
          status: match.status,
          matchConfidence: toConfidence(match.confidence),
          matchReason: match.reason,
          approvedAt: match.status === "APPROVED" ? now : null,
          approvedByUserId:
            match.status === "APPROVED" ? input.actorUserId ?? null : null,
          firstSeenAt: now,
          ...scalarFields,
        },
      });

      if (match.matchedJobId && match.status === "APPROVED") {
        await input.prisma.entityAlias.upsert({
          where: {
            workspaceId_entityType_normalizedAlias: {
              workspaceId: input.workspaceId,
              entityType: "JOB",
              normalizedAlias: normalizeName(folder.displayName),
            },
          },
          update: { jobId: match.matchedJobId, source: "OUTLOOK_FOLDER" },
          create: {
            workspaceId: input.workspaceId,
            entityType: "JOB",
            jobId: match.matchedJobId,
            alias: folder.displayName,
            normalizedAlias: normalizeName(folder.displayName),
            source: "OUTLOOK_FOLDER",
          },
        });
      }

      created += 1;
    }
  }

  // Soft-mark folders under this mailbox that vanished from Projects tree
  // (scoped connection rows + legacy NULL inboxConnectionId for same mailbox).
  const missingResult = await input.prisma.discoveredFolder.updateMany({
    where: {
      workspaceId: input.workspaceId,
      providerFolderId: { notIn: [...seenProviderIds] },
      status: { notIn: ["IGNORED", "ARCHIVED"] },
      missingFromProvider: false,
      folderPath: { startsWith: `${projectsRoot.path}/` },
      OR: [
        { inboxConnectionId: connection.id },
        {
          inboxConnectionId: null,
          mailboxEmail: { equals: mailboxEmail, mode: "insensitive" },
        },
      ],
    },
    data: {
      missingFromProvider: true,
      status: "ARCHIVED",
    },
  });

  return {
    projectsRoot,
    totalUnderProjects: graphFolders.length,
    candidates: candidates.length,
    created,
    updated,
    missingMarked: missingResult.count,
    verified,
    suggested,
    unmatched,
  };
}

/**
 * Domain helper for the next "analyze folder emails" phase.
 * Only VERIFIED (APPROVED) folders with a matched Job.
 */
export async function getVerifiedProjectFolders(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    inboxConnectionId?: string;
    mailboxEmail?: string;
  }
) {
  const mailboxEmail = input.mailboxEmail?.toLowerCase();
  return prisma.discoveredFolder.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: "APPROVED",
      matchedJobId: { not: null },
      missingFromProvider: false,
      ...(input.inboxConnectionId && mailboxEmail
        ? {
            OR: [
              { inboxConnectionId: input.inboxConnectionId },
              {
                inboxConnectionId: null,
                mailboxEmail: { equals: mailboxEmail, mode: "insensitive" },
              },
            ],
          }
        : input.inboxConnectionId
          ? { inboxConnectionId: input.inboxConnectionId }
          : mailboxEmail
            ? { mailboxEmail: { equals: mailboxEmail, mode: "insensitive" } }
            : {}),
    },
    orderBy: { folderPath: "asc" },
    include: {
      matchedJob: {
        select: { id: true, name: true, jobNumber: true, status: true },
      },
    },
  });
}
