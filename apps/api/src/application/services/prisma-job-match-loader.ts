import type { PrismaClient } from "@prisma/client";
import {
  authoritativeEmailAssignmentOr,
  extractDomain,
  JobMatcherService,
  normalizeEmail,
  selectActiveContactHits,
  selectAuthoritativeThreadHits,
  type JobMatchDataLoader,
} from "@forgeops/shared";

const EXCLUDED_JOB_STATUSES = ["ARCHIVED", "CANCELLED"] as const;

/**
 * Prisma-backed loader for JobMatcherService (API + worker).
 * Active jobs: archivedAt IS NULL and status not ARCHIVED/CANCELLED.
 */
export function createPrismaJobMatchLoader(
  prisma: PrismaClient
): JobMatchDataLoader {
  return {
    async loadActiveJobs(workspaceId) {
      const jobs = await prisma.job.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          status: { notIn: [...EXCLUDED_JOB_STATUSES] },
        },
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
      });
      return jobs;
    },

    async loadJobAliases(workspaceId) {
      const aliases = await prisma.entityAlias.findMany({
        where: {
          workspaceId,
          entityType: "JOB",
          jobId: { not: null },
        },
        select: {
          jobId: true,
          alias: true,
          normalizedAlias: true,
        },
      });
      return aliases
        .filter((a): a is typeof a & { jobId: string } => Boolean(a.jobId))
        .map((a) => ({
          jobId: a.jobId,
          alias: a.alias,
          normalizedAlias: a.normalizedAlias,
        }));
    },

    async loadSenderCustomerJobIds(workspaceId, senderEmail) {
      const ids = new Set<string>();
      if (!senderEmail) return ids;

      const domain = extractDomain(senderEmail);
      const normalized = normalizeEmail(senderEmail);

      const customers = await prisma.customer.findMany({
        where: {
          workspaceId,
          OR: [
            ...(domain
              ? [{ domain: { equals: domain, mode: "insensitive" as const } }]
              : []),
            {
              primaryEmail: {
                equals: normalized,
                mode: "insensitive" as const,
              },
            },
          ],
        },
        select: { id: true },
        take: 20,
      });

      if (customers.length === 0) return ids;

      const jobs = await prisma.job.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          status: { notIn: [...EXCLUDED_JOB_STATUSES] },
          customerId: { in: customers.map((c) => c.id) },
        },
        select: { id: true },
      });
      for (const j of jobs) ids.add(j.id);
      return ids;
    },

    async loadThreadJobHint(workspaceId, threadId) {
      if (!threadId) return null;
      const prior = await prisma.emailMessage.findFirst({
        where: {
          workspaceId,
          threadId,
          jobId: { not: null },
        },
        orderBy: { receivedAt: "desc" },
        select: { jobId: true },
      });
      return prior?.jobId ?? null;
    },

    async loadActiveExactContactJobs(input) {
      const sender = input.senderEmail?.trim()
        ? normalizeEmail(input.senderEmail)
        : "";
      if (!sender) return [];
      const [manuals, emails] = await Promise.all([
        prisma.jobEmailContact.findMany({
          where: {
            workspaceId: input.workspaceId,
            source: "MANUAL",
            contact: {
              OR: [
                { normalizedEmail: sender },
                { email: { equals: sender, mode: "insensitive" } },
              ],
            },
          },
          select: {
            jobId: true,
            source: true,
            contact: { select: { email: true, normalizedEmail: true } },
          },
        }),
        prisma.emailMessage.findMany({
          where: {
            workspaceId: input.workspaceId,
            jobId: { not: null },
            senderEmail: { equals: sender, mode: "insensitive" },
            ...(input.excludeEmailMessageId
              ? { id: { not: input.excludeEmailMessageId } }
              : {}),
            OR: authoritativeEmailAssignmentOr(),
          },
          select: {
            id: true,
            jobId: true,
            senderEmail: true,
            jobAssignmentIsManual: true,
            jobAssignmentSource: true,
          },
          take: 500,
        }),
      ]);
      return selectActiveContactHits({
        senderEmail: sender,
        excludeEmailMessageId: input.excludeEmailMessageId ?? null,
        eligibleJobs: input.eligibleJobs,
        manualContacts: manuals.map((row) => ({
          jobId: row.jobId,
          source: row.source,
          email: row.contact.email,
          normalizedEmail: row.contact.normalizedEmail,
        })),
        authoritativeEmails: emails,
      });
    },

    async loadAuthoritativeThreadJobs(input) {
      const connectionId = input.inboxConnectionId?.trim() || "";
      const providerThreadId = input.providerThreadId?.trim() || "";
      if (!connectionId || !providerThreadId) return [];
      const messages = await prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          inboxConnectionId: connectionId,
          providerThreadId,
          jobId: { not: null },
          ...(input.excludeEmailMessageId
            ? { id: { not: input.excludeEmailMessageId } }
            : {}),
          OR: authoritativeEmailAssignmentOr(),
        },
        select: {
          id: true,
          jobId: true,
          inboxConnectionId: true,
          providerThreadId: true,
          jobAssignmentIsManual: true,
          jobAssignmentSource: true,
        },
        take: 500,
      });
      return selectAuthoritativeThreadHits({
        inboxConnectionId: connectionId,
        providerThreadId,
        excludeEmailMessageId: input.excludeEmailMessageId ?? null,
        eligibleJobs: input.eligibleJobs,
        messages,
      });
    },
  };
}

export function createJobMatcherService(prisma: PrismaClient): JobMatcherService {
  return new JobMatcherService(createPrismaJobMatchLoader(prisma));
}
