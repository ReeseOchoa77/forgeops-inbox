import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const wsParams = z.object({ workspaceId: z.string().min(1) });
const eventParams = z.object({
  workspaceId: z.string().min(1),
  eventId: z.string().min(1),
});

const rangeQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

const eventTypeValues = ["MEETING", "EVENT", "NOTE", "DEADLINE"] as const;

const createEventSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).nullable().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().nullable().optional(),
  allDay: z.boolean().optional(),
  type: z.enum(eventTypeValues).default("EVENT"),
  linkedJobId: z.string().min(1).nullable().optional(),
  linkedTaskId: z.string().min(1).nullable().optional(),
  linkedEmailMessageId: z.string().min(1).nullable().optional(),
});

const updateEventSchema = createEventSchema.partial();

const EDITOR_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);

async function requireAuth(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }
  const membership = await requireWorkspaceMembership(
    app.services.prisma,
    session.userId,
    workspaceId
  );
  if (!membership) {
    reply.code(403).send({ message: "Workspace access denied" });
    return null;
  }
  return { userId: session.userId, role: membership.role };
}

function serializeEvent(e: {
  id: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  type: string;
  source: string;
  externalEventId: string | null;
  linkedJobId: string | null;
  linkedTaskId: string | null;
  linkedEmailMessageId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  linkedJob?: { id: string; name: string; jobNumber: string | null } | null;
}) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    allDay: e.allDay,
    type: e.type,
    source: e.source,
    externalEventId: e.externalEventId,
    linkedJobId: e.linkedJobId,
    linkedTaskId: e.linkedTaskId,
    linkedEmailMessageId: e.linkedEmailMessageId,
    createdByUserId: e.createdByUserId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    linkedJob: e.linkedJob
      ? {
          id: e.linkedJob.id,
          name: e.linkedJob.name,
          jobNumber: e.linkedJob.jobNumber,
        }
      : null,
  };
}

/**
 * Calendar MVP: ForgeOps-native events + Task.dueAt aggregation.
 * Google/Microsoft calendar sync is intentionally not wired (scopes not expanded).
 */
export const registerCalendarRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/calendar",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const query = rangeQuery.parse(request.query);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;

      const from = new Date(query.from);
      const to = new Date(query.to);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        return reply.code(400).send({ message: "Invalid from/to range" });
      }

      const [events, tasks] = await Promise.all([
        app.services.prisma.calendarEvent.findMany({
          where: {
            workspaceId,
            startAt: { gte: from, lt: to },
          },
          orderBy: { startAt: "asc" },
          include: {
            linkedJob: {
              select: { id: true, name: true, jobNumber: true },
            },
          },
        }),
        app.services.prisma.task.findMany({
          where: {
            workspaceId,
            dueAt: { gte: from, lt: to },
            status: { notIn: ["CANCELLED"] },
            dismissedAt: null,
          },
          orderBy: { dueAt: "asc" },
          select: {
            id: true,
            title: true,
            summary: true,
            dueAt: true,
            status: true,
            priority: true,
            jobId: true,
            sourceMessageId: true,
            job: { select: { id: true, name: true, jobNumber: true } },
          },
        }),
      ]);

      return reply.send({
        from: from.toISOString(),
        to: to.toISOString(),
        events: events.map(serializeEvent),
        taskDueItems: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.summary,
          startAt: t.dueAt!.toISOString(),
          endAt: null,
          allDay: true,
          type: "TASK" as const,
          source: "FORGEOPS" as const,
          linkedJobId: t.jobId,
          linkedTaskId: t.id,
          linkedEmailMessageId: t.sourceMessageId,
          linkedJob: t.job
            ? {
                id: t.job.id,
                name: t.job.name,
                jobNumber: t.job.jobNumber,
              }
            : null,
          taskStatus: t.status,
          taskPriority: t.priority,
        })),
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/calendar/events",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const body = createEventSchema.parse(request.body ?? {});
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!EDITOR_ROLES.has(auth.role)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      if (body.linkedJobId) {
        const job = await app.services.prisma.job.findFirst({
          where: { id: body.linkedJobId, workspaceId },
          select: { id: true },
        });
        if (!job) return reply.code(404).send({ message: "Job not found" });
      }

      const created = await app.services.prisma.calendarEvent.create({
        data: {
          workspaceId,
          title: body.title.trim(),
          description: body.description ?? null,
          startAt: new Date(body.startAt),
          endAt: body.endAt ? new Date(body.endAt) : null,
          allDay: body.allDay ?? false,
          type: body.type,
          source: "FORGEOPS",
          linkedJobId: body.linkedJobId ?? null,
          linkedTaskId: body.linkedTaskId ?? null,
          linkedEmailMessageId: body.linkedEmailMessageId ?? null,
          createdByUserId: auth.userId,
        },
        include: {
          linkedJob: { select: { id: true, name: true, jobNumber: true } },
        },
      });

      return reply.code(201).send({ event: serializeEvent(created) });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/calendar/events/:eventId",
    async (request, reply) => {
      const { workspaceId, eventId } = eventParams.parse(request.params);
      const body = updateEventSchema.parse(request.body ?? {});
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!EDITOR_ROLES.has(auth.role)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      const existing = await app.services.prisma.calendarEvent.findFirst({
        where: { id: eventId, workspaceId },
      });
      if (!existing) return reply.code(404).send({ message: "Event not found" });
      if (existing.source !== "FORGEOPS") {
        return reply
          .code(400)
          .send({ message: "Only ForgeOps-native events can be edited here" });
      }

      if (body.linkedJobId) {
        const job = await app.services.prisma.job.findFirst({
          where: { id: body.linkedJobId, workspaceId },
          select: { id: true },
        });
        if (!job) return reply.code(404).send({ message: "Job not found" });
      }

      const updated = await app.services.prisma.calendarEvent.update({
        where: { id: eventId },
        data: {
          ...(body.title !== undefined ? { title: body.title.trim() } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.startAt !== undefined
            ? { startAt: new Date(body.startAt) }
            : {}),
          ...(body.endAt !== undefined
            ? { endAt: body.endAt ? new Date(body.endAt) : null }
            : {}),
          ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.linkedJobId !== undefined
            ? { linkedJobId: body.linkedJobId }
            : {}),
          ...(body.linkedTaskId !== undefined
            ? { linkedTaskId: body.linkedTaskId }
            : {}),
          ...(body.linkedEmailMessageId !== undefined
            ? { linkedEmailMessageId: body.linkedEmailMessageId }
            : {}),
        },
        include: {
          linkedJob: { select: { id: true, name: true, jobNumber: true } },
        },
      });

      return reply.send({ event: serializeEvent(updated) });
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/calendar/events/:eventId",
    async (request, reply) => {
      const { workspaceId, eventId } = eventParams.parse(request.params);
      const auth = await requireAuth(app, request, reply, workspaceId);
      if (!auth) return;
      if (!EDITOR_ROLES.has(auth.role)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      const existing = await app.services.prisma.calendarEvent.findFirst({
        where: { id: eventId, workspaceId },
      });
      if (!existing) return reply.code(404).send({ message: "Event not found" });
      if (existing.source !== "FORGEOPS") {
        return reply
          .code(400)
          .send({ message: "Only ForgeOps-native events can be deleted here" });
      }

      await app.services.prisma.calendarEvent.delete({ where: { id: eventId } });
      return reply.code(204).send();
    }
  );
};
