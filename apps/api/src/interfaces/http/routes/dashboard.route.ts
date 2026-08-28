import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const wsParams = z.object({ workspaceId: z.string().min(1) });
const summaryQuery = z.object({
  inboxConnectionId: z.string().min(1),
});

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfTodayUtc(): Date {
  const start = startOfTodayUtc();
  return new Date(start.getTime() + 86_400_000);
}

/**
 * Lightweight Dashboard above-the-fold aggregates.
 * Does not return full task/message rows.
 */
export const registerDashboardRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/dashboard-summary",
    async (request, reply) => {
      const t0 = performance.now();
      const { workspaceId } = wsParams.parse(request.params);
      const query = summaryQuery.parse(request.query);

      const session = await getSessionFromRequest(request);
      if (!session) {
        return reply.code(401).send({ message: "Authentication required" });
      }
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        workspaceId
      );
      if (!membership) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: { id: query.inboxConnectionId, workspaceId },
        select: { id: true, email: true },
      });
      if (!connection) {
        return reply.code(404).send({ message: "Inbox connection not found" });
      }

      const monitoredEmails = (
        await app.services.prisma.inboxConnection.findMany({
          where: { workspaceId },
          select: { email: true },
        })
      ).map((c) => c.email.toLowerCase());

      const now = new Date();
      const todayStart = startOfTodayUtc();
      const todayEnd = endOfTodayUtc();
      const openStatuses = ["OPEN", "IN_PROGRESS"] as const;
      const activeStatuses = ["OPEN", "IN_PROGRESS", "BLOCKED"] as const;

      const taskBase = {
        workspaceId,
        sourceThread: { inboxConnectionId: connection.id },
      };

      const inboxSenderFilter =
        monitoredEmails.length > 0
          ? {
              OR: [
                { sourceMessageId: null },
                {
                  sourceMessage: {
                    senderEmail: { notIn: monitoredEmails },
                  },
                },
              ],
            }
          : {};

      const requestSenderFilter =
        monitoredEmails.length > 0
          ? {
              sourceMessage: {
                senderEmail: { in: monitoredEmails },
              },
            }
          : { id: "__never__" };

      const tDb = performance.now();
      const [
        openTasks,
        overdueTasks,
        dueToday,
        openRequests,
        unreadBusiness,
        activeJobs,
        reviewCount,
      ] = await Promise.all([
        app.services.prisma.task.count({
          where: {
            ...taskBase,
            status: { in: [...openStatuses] },
            ...inboxSenderFilter,
          },
        }),
        app.services.prisma.task.count({
          where: {
            ...taskBase,
            status: { in: [...activeStatuses] },
            dueAt: { lt: now },
            ...inboxSenderFilter,
          },
        }),
        app.services.prisma.task.count({
          where: {
            ...taskBase,
            status: { in: [...activeStatuses] },
            dueAt: { gte: todayStart, lt: todayEnd },
            ...inboxSenderFilter,
          },
        }),
        monitoredEmails.length
          ? app.services.prisma.task.count({
              where: {
                ...taskBase,
                status: { in: [...openStatuses] },
                ...requestSenderFilter,
              },
            })
          : Promise.resolve(0),
        app.services.prisma.emailMessage.count({
          where: {
            workspaceId,
            inboxConnectionId: connection.id,
            isTrashed: false,
            isArchived: false,
            isRead: false,
            mailboxCategory: "BUSINESS",
            ...(monitoredEmails.length
              ? { senderEmail: { notIn: monitoredEmails } }
              : {}),
          },
        }),
        app.services.prisma.job.count({
          where: {
            workspaceId,
            archivedAt: null,
            status: { in: ["ACTIVE", "AWARDED", "BIDDING", "LEAD"] },
          },
        }),
        app.services.prisma.emailMessage.count({
          where: {
            workspaceId,
            inboxConnectionId: connection.id,
            isTrashed: false,
            itemStatus: "NEEDS_REVIEW",
          },
        }),
      ]);
      const dbMs = Math.round(performance.now() - tDb);

      const body = {
        openTasks,
        overdueTasks,
        dueToday,
        openRequests,
        unreadBusiness,
        activeJobs,
        reviewCount,
      };

      const payload = JSON.stringify(body);
      request.log.info({
        event: "api-performance",
        route: "dashboard-summary",
        totalMs: Math.round(performance.now() - t0),
        dbMs,
        resultCount: 1,
        payloadBytes: Buffer.byteLength(payload),
      });

      return reply.send(body);
    }
  );
};
