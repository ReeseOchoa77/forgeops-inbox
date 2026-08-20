import type { PrismaClient } from "@prisma/client";
import { normalizeEmail, extractDomain } from "@forgeops/shared";
import {
  JobMatcherService,
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
  };
}

export function createJobMatcherService(prisma: PrismaClient): JobMatcherService {
  return new JobMatcherService(createPrismaJobMatchLoader(prisma));
}
