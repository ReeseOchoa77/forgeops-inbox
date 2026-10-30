import type { PrismaClient } from "@prisma/client";
import {
  authoritativeEmailAssignmentOr,
  type HistoricalEvalDatasetSummary,
  type JobMatchEvalSnapshot,
  type JobRecordForMatch,
} from "@forgeops/shared";

export type JobMatchEvalReadDb = {
  workspace: Pick<PrismaClient["workspace"], "findFirst">;
  emailMessage: Pick<PrismaClient["emailMessage"], "count" | "findMany" | "groupBy">;
  job: Pick<PrismaClient["job"], "findFirst" | "findMany">;
  entityAlias: Pick<PrismaClient["entityAlias"], "findMany">;
  jobEmailContact: Pick<PrismaClient["jobEmailContact"], "findMany">;
};

export type HistoricalEvalEmailRecord = {
  id: string;
  subject: string | null;
  snippet: string | null;
  cleanBody: string | null;
  senderEmail: string;
  direction: string | null;
  inboxConnectionId: string;
  providerThreadId: string | null;
  jobId: string;
  jobAssignmentIsManual: boolean;
  jobAssignmentSource: string | null;
  hasAttachments: boolean;
};

const PAGE_SIZE = 500;

async function paginateById<T extends { id: string }>(
  query: (page: {
    take: number;
    skip?: number;
    cursor?: { id: string };
  }) => Promise<T[]>
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await query({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    rows.push(...batch);
    cursor = batch[batch.length - 1]!.id;
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function findEvalWorkspace(
  db: JobMatchEvalReadDb,
  workspaceId: string
): Promise<{ id: string; name: string } | null> {
  return db.workspace.findFirst({
    where: { id: workspaceId },
    select: { id: true, name: true },
  });
}

export async function findEvalJobInWorkspace(
  db: JobMatchEvalReadDb,
  workspaceId: string,
  jobId: string
): Promise<{ id: string } | null> {
  return db.job.findFirst({
    where: { id: jobId, workspaceId },
    select: { id: true },
  });
}

export async function loadHistoricalEvalDatasetSummary(
  db: JobMatchEvalReadDb,
  workspace: { id: string; name: string }
): Promise<HistoricalEvalDatasetSummary> {
  const workspaceId = workspace.id;
  const authOr = authoritativeEmailAssignmentOr();
  const [
    totalEmails,
    jobLinkedEmails,
    authoritativeEmails,
    manualAssignmentCount,
    verifiedProjectFolderCount,
    sourceGroups,
    directionGroups,
    inboxGroups,
    authoritativeJobGroups,
    workspaceJobs,
  ] = await Promise.all([
    db.emailMessage.count({ where: { workspaceId } }),
    db.emailMessage.count({ where: { workspaceId, jobId: { not: null } } }),
    db.emailMessage.count({
      where: { workspaceId, jobId: { not: null }, OR: authOr },
    }),
    db.emailMessage.count({
      where: { workspaceId, jobId: { not: null }, jobAssignmentIsManual: true },
    }),
    db.emailMessage.count({
      where: {
        workspaceId,
        jobId: { not: null },
        jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
      },
    }),
    db.emailMessage.groupBy({
      by: ["jobAssignmentSource"],
      where: { workspaceId, jobId: { not: null } },
      _count: { _all: true },
    }),
    db.emailMessage.groupBy({
      by: ["direction"],
      where: { workspaceId, jobId: { not: null }, OR: authOr },
      _count: { _all: true },
    }),
    db.emailMessage.groupBy({
      by: ["inboxConnectionId"],
      where: { workspaceId, jobId: { not: null }, OR: authOr },
      _count: { _all: true },
    }),
    db.emailMessage.groupBy({
      by: ["jobId"],
      where: { workspaceId, jobId: { not: null }, OR: authOr },
      _count: { _all: true },
    }),
    paginateById((page) =>
      db.job.findMany({
        where: { workspaceId },
        select: { id: true, status: true },
        orderBy: { id: "asc" },
        ...page,
      })
    ),
  ]);

  const jobIds = authoritativeJobGroups
    .map((row) => row.jobId)
    .filter((id): id is string => Boolean(id));
  const statusByJob = new Map(workspaceJobs.map((job) => [job.id, job.status]));
  const countsByJobStatus: Record<string, number> = {};
  for (const jobId of jobIds) {
    const status = statusByJob.get(jobId) ?? "MISSING";
    countsByJobStatus[status] = (countsByJobStatus[status] ?? 0) + 1;
  }

  const countsByAssignmentSource: Record<string, number> = {};
  for (const row of sourceGroups) {
    countsByAssignmentSource[row.jobAssignmentSource ?? "(null)"] = row._count._all;
  }

  let sentCount = 0;
  let receivedCount = 0;
  let unknownDirectionCount = 0;
  for (const row of directionGroups) {
    if (row.direction === "SENT") sentCount += row._count._all;
    else if (row.direction === "RECEIVED") receivedCount += row._count._all;
    else unknownDirectionCount += row._count._all;
  }

  return {
    workspaceId,
    workspaceName: workspace.name,
    totalEmails,
    jobLinkedEmails,
    authoritativeEmails,
    nonAuthoritativeJobLinkedEmails: jobLinkedEmails - authoritativeEmails,
    distinctAuthoritativeJobs: jobIds.length,
    countsByJobStatus,
    countsByAssignmentSource,
    manualAssignmentCount,
    verifiedProjectFolderCount,
    sentCount,
    receivedCount,
    unknownDirectionCount,
    distinctInboxConnections: inboxGroups.length,
  };
}

export async function loadJobMatchEvalSnapshot(
  db: JobMatchEvalReadDb,
  workspaceId: string
): Promise<JobMatchEvalSnapshot> {
  const [jobs, aliases, contacts, authoritativeEmails] = await Promise.all([
    paginateById((page) =>
      db.job.findMany({
        where: { workspaceId },
        select: {
          id: true,
          jobNumber: true,
          name: true,
          normalizedName: true,
          customerId: true,
          externalRef: true,
          siteName: true,
          description: true,
          status: true,
        },
        orderBy: { id: "asc" },
        ...page,
      })
    ),
    paginateById((page) =>
      db.entityAlias.findMany({
        where: { workspaceId, entityType: "JOB", jobId: { not: null } },
        select: { id: true, jobId: true, alias: true, normalizedAlias: true },
        orderBy: { id: "asc" },
        ...page,
      })
    ),
    paginateById((page) =>
      db.jobEmailContact.findMany({
        where: { workspaceId, source: "MANUAL" },
        select: {
          id: true,
          jobId: true,
          source: true,
          contact: { select: { email: true, normalizedEmail: true } },
        },
        orderBy: { id: "asc" },
        ...page,
      })
    ),
    paginateById((page) =>
      db.emailMessage.findMany({
        where: {
          workspaceId,
          jobId: { not: null },
          OR: authoritativeEmailAssignmentOr(),
        },
        select: {
          id: true,
          jobId: true,
          senderEmail: true,
          inboxConnectionId: true,
          providerThreadId: true,
          jobAssignmentIsManual: true,
          jobAssignmentSource: true,
        },
        orderBy: { id: "asc" },
        ...page,
      })
    ),
  ]);

  return {
    workspaceId,
    jobs: jobs as JobRecordForMatch[],
    aliases: aliases
      .filter((row): row is typeof row & { jobId: string } => Boolean(row.jobId))
      .map((row) => ({
        jobId: row.jobId,
        alias: row.alias,
        normalizedAlias: row.normalizedAlias,
      })),
    manualContacts: contacts.map((row) => ({
      jobId: row.jobId,
      source: row.source,
      email: row.contact.email,
      normalizedEmail: row.contact.normalizedEmail,
    })),
    authoritativeEmails: authoritativeEmails
      .filter((row): row is typeof row & { jobId: string } => Boolean(row.jobId))
      .map((row) => ({
        id: row.id,
        jobId: row.jobId,
        senderEmail: row.senderEmail,
        inboxConnectionId: row.inboxConnectionId,
        providerThreadId: row.providerThreadId,
        jobAssignmentIsManual: row.jobAssignmentIsManual,
        jobAssignmentSource: row.jobAssignmentSource,
      })),
  };
}

export async function loadHistoricalEvalEmailsPage(
  db: JobMatchEvalReadDb,
  input: {
    workspaceId: string;
    jobId?: string | null | undefined;
    cursor?: string | undefined;
    take: number;
  }
): Promise<HistoricalEvalEmailRecord[]> {
  const rows = await db.emailMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId ? input.jobId : { not: null },
      OR: authoritativeEmailAssignmentOr(),
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
    },
    select: {
      id: true,
      subject: true,
      snippet: true,
      senderEmail: true,
      direction: true,
      inboxConnectionId: true,
      providerThreadId: true,
      jobId: true,
      jobAssignmentIsManual: true,
      jobAssignmentSource: true,
      hasAttachments: true,
      normalizedEmail: { select: { cleanTextBody: true } },
    },
    orderBy: { id: "asc" },
    take: input.take,
  });
  return rows
    .filter((row): row is typeof row & { jobId: string } => Boolean(row.jobId))
    .map((row) => ({
      id: row.id,
      subject: row.subject,
      snippet: row.snippet,
      cleanBody: row.normalizedEmail?.cleanTextBody ?? row.snippet ?? "",
      senderEmail: row.senderEmail,
      direction: row.direction,
      inboxConnectionId: row.inboxConnectionId,
      providerThreadId: row.providerThreadId,
      jobId: row.jobId,
      jobAssignmentIsManual: row.jobAssignmentIsManual,
      jobAssignmentSource: row.jobAssignmentSource,
      hasAttachments: row.hasAttachments,
    }));
}
