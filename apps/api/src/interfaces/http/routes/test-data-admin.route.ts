import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { getSessionFromRequest } from "../authentication.js";

async function requirePlatformAdminForRoute(app: FastifyInstance, request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const session = await getSessionFromRequest(request);
  if (!session) { reply.code(401).send({ message: "Authentication required" }); return null; }
  const user = await app.services.prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, platformRole: true } });
  if (!user || user.platformRole !== "PLATFORM_ADMIN") { reply.code(403).send({ message: "Platform admin required" }); return null; }
  return { userId: user.id, email: user.email };
}

const archiveSchema = z.object({
  workspaceId: z.string().min(1),
  mode: z.enum(["before_date", "test_data", "all"]),
  beforeDate: z.string().datetime().optional(),
  dryRun: z.boolean().default(true),
  includeCorrections: z.boolean().default(false)
});

const deleteSchema = z.object({
  workspaceId: z.string().min(1),
  onlyArchived: z.boolean().default(true),
  confirmPhrase: z.literal("PERMANENTLY DELETE"),
  includeCorrections: z.boolean().default(false)
});

const restoreSchema = z.object({
  workspaceId: z.string().min(1),
  messageIds: z.array(z.string()).max(500).optional()
});

export const registerTestDataAdminRoutes = async (app: FastifyInstance): Promise<void> => {

  app.post("/api/v1/admin/test-data/preview", async (request, reply) => {
    const admin = await requirePlatformAdminForRoute(app, request, reply);
    if (!admin) return;

    const body = archiveSchema.parse(request.body);

    const where: Record<string, unknown> = { workspaceId: body.workspaceId, isArchived: false };
    if (body.mode === "before_date" && body.beforeDate) {
      where.receivedAt = { lt: new Date(body.beforeDate) };
    } else if (body.mode === "test_data") {
      where.isTestData = true;
    }

    const [emailCount, taskCount, classificationCount, attachmentCount] = await Promise.all([
      app.services.prisma.emailMessage.count({ where: where as import("@prisma/client").Prisma.EmailMessageWhereInput }),
      app.services.prisma.task.count({
        where: { workspaceId: body.workspaceId, sourceMessage: { ...(body.mode === "test_data" ? { isTestData: true } : {}), isArchived: false } }
      }),
      app.services.prisma.classification.count({
        where: { workspaceId: body.workspaceId, message: { ...(body.mode === "test_data" ? { isTestData: true } : {}), isArchived: false } }
      }),
      app.services.prisma.emailAttachment.count({
        where: { workspaceId: body.workspaceId, emailMessage: { ...(body.mode === "test_data" ? { isTestData: true } : {}), isArchived: false } }
      })
    ]);

    return reply.send({
      dryRun: true,
      mode: body.mode,
      workspaceId: body.workspaceId,
      affected: { emails: emailCount, tasks: taskCount, classifications: classificationCount, attachments: attachmentCount },
      preserving: ["users", "workspaces", "customers", "vendors", "jobs", "aliases", "sender_evidence", "configuration"]
    });
  });

  app.post("/api/v1/admin/test-data/archive", async (request, reply) => {
    const admin = await requirePlatformAdminForRoute(app, request, reply);
    if (!admin) return;

    const body = archiveSchema.parse(request.body);
    if (body.dryRun) return reply.code(400).send({ message: "Use /preview for dry run" });

    const where: Record<string, unknown> = { workspaceId: body.workspaceId, isArchived: false };
    if (body.mode === "before_date" && body.beforeDate) {
      where.receivedAt = { lt: new Date(body.beforeDate) };
    } else if (body.mode === "test_data") {
      where.isTestData = true;
    }

    const now = new Date();

    const archived = await app.services.prisma.emailMessage.updateMany({
      where: where as import("@prisma/client").Prisma.EmailMessageWhereInput,
      data: { isArchived: true, archivedAt: now }
    });

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: admin.userId,
      entityType: "TEST_DATA",
      entityId: body.workspaceId,
      action: "test_data.archived",
      metadata: { mode: body.mode, archivedCount: archived.count, beforeDate: body.beforeDate ?? null },
      request
    });

    return reply.send({ status: "archived", archivedCount: archived.count });
  });

  app.post("/api/v1/admin/test-data/restore", async (request, reply) => {
    const admin = await requirePlatformAdminForRoute(app, request, reply);
    if (!admin) return;

    const body = restoreSchema.parse(request.body);

    const where: import("@prisma/client").Prisma.EmailMessageWhereInput = {
      workspaceId: body.workspaceId,
      isArchived: true,
      ...(body.messageIds ? { id: { in: body.messageIds } } : {})
    };

    const restored = await app.services.prisma.emailMessage.updateMany({
      where,
      data: { isArchived: false, archivedAt: null }
    });

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: admin.userId,
      entityType: "TEST_DATA",
      entityId: body.workspaceId,
      action: "test_data.restored",
      metadata: { restoredCount: restored.count },
      request
    });

    return reply.send({ status: "restored", restoredCount: restored.count });
  });

  app.post("/api/v1/admin/test-data/delete", async (request, reply) => {
    const admin = await requirePlatformAdminForRoute(app, request, reply);
    if (!admin) return;

    const body = deleteSchema.parse(request.body);

    const where: import("@prisma/client").Prisma.EmailMessageWhereInput = {
      workspaceId: body.workspaceId,
      ...(body.onlyArchived ? { isArchived: true } : {})
    };

    const messageIds = (await app.services.prisma.emailMessage.findMany({
      where,
      select: { id: true }
    })).map(m => m.id);

    if (messageIds.length === 0) {
      return reply.send({ status: "nothing_to_delete", deletedCount: 0 });
    }

    await app.services.prisma.$transaction(async (tx) => {
      await tx.emailAttachment.deleteMany({ where: { emailMessageId: { in: messageIds } } });
      await tx.task.deleteMany({ where: { sourceMessageId: { in: messageIds } } });
      if (body.includeCorrections) {
        const classIds = (await tx.classification.findMany({
          where: { messageId: { in: messageIds } },
          select: { id: true }
        })).map(c => c.id);
        if (classIds.length > 0) {
          await tx.classificationCorrection.deleteMany({ where: { classificationId: { in: classIds } } });
        }
      }
      await tx.classification.deleteMany({ where: { messageId: { in: messageIds } } });
      await tx.normalizedEmail.deleteMany({ where: { messageId: { in: messageIds } } });
      await tx.emailMessage.deleteMany({ where: { id: { in: messageIds } } });
    }, { timeout: 120_000 });

    const threadIds = (await app.services.prisma.emailThread.findMany({
      where: { workspaceId: body.workspaceId, messages: { none: {} } },
      select: { id: true }
    })).map(t => t.id);

    if (threadIds.length > 0) {
      await app.services.prisma.emailThread.deleteMany({ where: { id: { in: threadIds } } });
    }

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: admin.userId,
      entityType: "TEST_DATA",
      entityId: body.workspaceId,
      action: "test_data.permanently_deleted",
      metadata: { deletedMessages: messageIds.length, orphanThreadsRemoved: threadIds.length, includeCorrections: body.includeCorrections },
      request
    });

    return reply.send({ status: "deleted", deletedMessages: messageIds.length, orphanThreadsRemoved: threadIds.length });
  });
};
