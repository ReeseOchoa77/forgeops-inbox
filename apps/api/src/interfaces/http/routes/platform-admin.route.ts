import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

import { getSessionFromRequest } from "../authentication.js";

async function requirePlatformAdminAccess(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ userId: string; email: string } | null> {
  const session = await getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }

  const user = await app.services.prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, platformRole: true }
  });

  if (!user || user.platformRole !== "PLATFORM_ADMIN") {
    reply.code(403).send({ message: "Platform admin access required" });
    return null;
  }

  return { userId: user.id, email: user.email };
}

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  timezone: z.string().default("UTC")
});

const registerMailboxSchema = z.object({
  workspaceId: z.string().min(1),
  provider: z.enum(["GMAIL", "OUTLOOK"]),
  email: z.string().email(),
  displayName: z.string().max(200).optional(),
  ingestionSource: z.enum(["NATIVE", "N8N"]).default("N8N")
});

export const registerPlatformAdminRoutes = async (
  app: FastifyInstance
): Promise<void> => {

  app.get("/api/v1/admin/workspaces", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const workspaces = await app.services.prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, slug: true, timezone: true, createdAt: true,
        _count: { select: { memberships: true, inboxConnections: true, emailMessages: true } }
      }
    });

    return reply.send({
      workspaces: workspaces.map(w => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        timezone: w.timezone,
        createdAt: w.createdAt.toISOString(),
        counts: {
          members: w._count.memberships,
          connections: w._count.inboxConnections,
          messages: w._count.emailMessages
        }
      }))
    });
  });

  app.post("/api/v1/admin/workspaces", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const body = createWorkspaceSchema.parse(request.body);

    const existing = await app.services.prisma.workspace.findUnique({
      where: { slug: body.slug },
      select: { id: true }
    });

    if (existing) {
      return reply.code(409).send({ message: `Workspace with slug "${body.slug}" already exists` });
    }

    const workspace = await app.services.prisma.workspace.create({
      data: { name: body.name, slug: body.slug, timezone: body.timezone }
    });

    await app.services.auditEventLogger.log({
      workspaceId: workspace.id,
      actorUserId: admin.userId,
      entityType: "WORKSPACE",
      entityId: workspace.id,
      action: "admin.workspace_created",
      metadata: { name: body.name, slug: body.slug },
      request
    });

    return reply.code(201).send({ workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } });
  });

  app.delete("/api/v1/admin/workspaces/:workspaceId", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);

    const workspace = await app.services.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true }
    });

    if (!workspace) {
      return reply.code(404).send({ message: "Workspace not found" });
    }

    await app.services.prisma.workspace.delete({ where: { id: workspaceId } });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: admin.userId,
      entityType: "WORKSPACE",
      entityId: workspaceId,
      action: "admin.workspace_deleted",
      metadata: { name: workspace.name },
      request
    });

    return reply.send({ status: "deleted" });
  });

  app.get("/api/v1/admin/mailboxes", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const connections = await app.services.prisma.inboxConnection.findMany({
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true, workspaceId: true, provider: true, email: true, displayName: true,
        status: true, ingestionSource: true, connectedAt: true,
        lastSyncedAt: true, lastReceivedAt: true, lastProcessedAt: true,
        lastSyncError: true, lastErrorMessage: true,
        workspace: { select: { name: true, slug: true } },
        _count: { select: { messages: true, threads: true } }
      }
    });

    return reply.send({
      mailboxes: connections.map(c => ({
        id: c.id,
        workspaceId: c.workspaceId,
        workspaceName: c.workspace.name,
        workspaceSlug: c.workspace.slug,
        provider: c.provider,
        email: c.email,
        displayName: c.displayName,
        status: c.status,
        ingestionMode: c.ingestionSource,
        connectedAt: c.connectedAt?.toISOString() ?? null,
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        lastReceivedAt: c.lastReceivedAt?.toISOString() ?? null,
        lastProcessedAt: c.lastProcessedAt?.toISOString() ?? null,
        lastError: c.lastSyncError ?? c.lastErrorMessage ?? null,
        counts: { messages: c._count.messages, threads: c._count.threads }
      }))
    });
  });

  app.post("/api/v1/admin/mailboxes", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const body = registerMailboxSchema.parse(request.body);
    const normalizedEmail = body.email.toLowerCase();

    const workspace = await app.services.prisma.workspace.findUnique({
      where: { id: body.workspaceId },
      select: { id: true }
    });

    if (!workspace) {
      return reply.code(404).send({ message: "Workspace not found" });
    }

    const existing = await app.services.prisma.inboxConnection.findFirst({
      where: { provider: body.provider, email: normalizedEmail },
      select: { id: true, workspaceId: true, status: true, ingestionSource: true }
    });

    if (existing) {
      if (existing.workspaceId !== body.workspaceId) {
        return reply.code(409).send({
          message: `Mailbox ${normalizedEmail} is already registered in another workspace. Remove it there first.`
        });
      }
      return reply.code(409).send({
        message: `Mailbox ${normalizedEmail} already exists in this workspace (status: ${existing.status}, mode: ${existing.ingestionSource}).`
      });
    }

    const connection = await app.services.prisma.inboxConnection.create({
      data: {
        workspaceId: body.workspaceId,
        provider: body.provider,
        email: normalizedEmail,
        displayName: body.displayName ?? normalizedEmail,
        status: "ACTIVE",
        ingestionSource: body.ingestionSource,
        connectedAt: new Date()
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: admin.userId,
      entityType: "INBOX_CONNECTION",
      entityId: connection.id,
      action: "admin.mailbox_registered",
      metadata: { provider: body.provider, email: normalizedEmail, ingestionSource: body.ingestionSource },
      request
    });

    return reply.code(201).send({
      mailbox: {
        id: connection.id,
        workspaceId: connection.workspaceId,
        provider: connection.provider,
        email: connection.email,
        status: connection.status,
        ingestionMode: connection.ingestionSource
      }
    });
  });

  app.patch("/api/v1/admin/mailboxes/:mailboxId/pause", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { mailboxId } = z.object({ mailboxId: z.string().min(1) }).parse(request.params);

    const connection = await app.services.prisma.inboxConnection.findUnique({
      where: { id: mailboxId },
      select: { id: true, workspaceId: true, email: true, status: true }
    });

    if (!connection) return reply.code(404).send({ message: "Mailbox not found" });

    await app.services.prisma.inboxConnection.update({
      where: { id: mailboxId },
      data: { status: "PAUSED" }
    });

    await app.services.auditEventLogger.log({
      workspaceId: connection.workspaceId,
      actorUserId: admin.userId,
      entityType: "INBOX_CONNECTION",
      entityId: mailboxId,
      action: "admin.mailbox_paused",
      metadata: { email: connection.email },
      request
    });

    return reply.send({ status: "paused" });
  });

  app.patch("/api/v1/admin/mailboxes/:mailboxId/resume", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { mailboxId } = z.object({ mailboxId: z.string().min(1) }).parse(request.params);

    const connection = await app.services.prisma.inboxConnection.findUnique({
      where: { id: mailboxId },
      select: { id: true, workspaceId: true, email: true }
    });

    if (!connection) return reply.code(404).send({ message: "Mailbox not found" });

    await app.services.prisma.inboxConnection.update({
      where: { id: mailboxId },
      data: { status: "ACTIVE" }
    });

    await app.services.auditEventLogger.log({
      workspaceId: connection.workspaceId,
      actorUserId: admin.userId,
      entityType: "INBOX_CONNECTION",
      entityId: mailboxId,
      action: "admin.mailbox_resumed",
      metadata: { email: connection.email },
      request
    });

    return reply.send({ status: "active" });
  });

  app.patch("/api/v1/admin/mailboxes/:mailboxId/ingestion-mode", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { mailboxId } = z.object({ mailboxId: z.string().min(1) }).parse(request.params);
    const body = z.object({ ingestionSource: z.enum(["NATIVE", "N8N"]) }).parse(request.body);

    const connection = await app.services.prisma.inboxConnection.findUnique({
      where: { id: mailboxId },
      select: { id: true, workspaceId: true, email: true, ingestionSource: true }
    });

    if (!connection) return reply.code(404).send({ message: "Mailbox not found" });

    await app.services.prisma.inboxConnection.update({
      where: { id: mailboxId },
      data: { ingestionSource: body.ingestionSource }
    });

    await app.services.auditEventLogger.log({
      workspaceId: connection.workspaceId,
      actorUserId: admin.userId,
      entityType: "INBOX_CONNECTION",
      entityId: mailboxId,
      action: "admin.mailbox_ingestion_mode_changed",
      metadata: {
        email: connection.email,
        from: connection.ingestionSource,
        to: body.ingestionSource
      },
      request
    });

    return reply.send({ status: "updated", ingestionMode: body.ingestionSource });
  });

  app.get("/api/v1/admin/workspaces/:workspaceId/members", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);

    const members = await app.services.prisma.membership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, role: true, workspaceRole: true, createdAt: true,
        user: { select: { id: true, email: true, name: true, lastLoginAt: true, isPlatformAdmin: true, platformRole: true } }
      }
    });

    return reply.send({
      members: members.map(m => ({
        membershipId: m.id,
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        workspaceRole: m.workspaceRole,
        isPlatformAdmin: m.user.isPlatformAdmin,
        platformRole: m.user.platformRole,
        lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
        memberSince: m.createdAt.toISOString()
      }))
    });
  });

  app.get("/api/v1/admin/approved-users", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const entries = await app.services.prisma.approvedAccess.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, email: true, workspaceId: true, role: true, workspaceRole: true,
        status: true, createdAt: true,
        workspace: { select: { name: true } },
        invitedByUser: { select: { email: true } }
      }
    });

    return reply.send({ entries });
  });

  app.post("/api/v1/admin/approved-users", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const body = z.object({
      email: z.string().email(),
      workspaceId: z.string().min(1),
      workspaceRole: z.enum(["OWNER", "EDITOR", "VIEWER"]).default("VIEWER")
    }).parse(request.body);

    const entry = await app.services.prisma.approvedAccess.upsert({
      where: { workspaceId_email: { workspaceId: body.workspaceId, email: body.email.toLowerCase() } },
      update: { status: "ACTIVE", workspaceRole: body.workspaceRole, role: body.workspaceRole === "OWNER" ? "OWNER" : body.workspaceRole === "EDITOR" ? "MEMBER" : "VIEWER" },
      create: {
        email: body.email.toLowerCase(),
        workspaceId: body.workspaceId,
        workspaceRole: body.workspaceRole,
        role: body.workspaceRole === "OWNER" ? "OWNER" : body.workspaceRole === "EDITOR" ? "MEMBER" : "VIEWER",
        status: "ACTIVE",
        invitedByUserId: admin.userId
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: admin.userId,
      entityType: "APPROVED_ACCESS",
      entityId: entry.id,
      action: "admin.user_approved",
      metadata: { email: body.email, workspaceRole: body.workspaceRole },
      request
    });

    return reply.code(201).send({ entry });
  });

  app.patch("/api/v1/admin/approved-users/:accessId/revoke", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { accessId } = z.object({ accessId: z.string().min(1) }).parse(request.params);

    await app.services.prisma.approvedAccess.update({
      where: { id: accessId },
      data: { status: "REVOKED" }
    });

    return reply.send({ status: "revoked" });
  });

  app.patch("/api/v1/admin/users/:userId/platform-role", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { userId } = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = z.object({ platformRole: z.enum(["PLATFORM_ADMIN", "STANDARD_USER"]) }).parse(request.body);

    if (userId === admin.userId && body.platformRole === "STANDARD_USER") {
      return reply.code(400).send({ message: "Cannot revoke your own platform admin role" });
    }

    await app.services.prisma.user.update({
      where: { id: userId },
      data: {
        platformRole: body.platformRole,
        isPlatformAdmin: body.platformRole === "PLATFORM_ADMIN"
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: "platform",
      actorUserId: admin.userId,
      entityType: "USER",
      entityId: userId,
      action: "admin.platform_role_changed",
      metadata: { newRole: body.platformRole },
      request
    });

    return reply.send({ status: "updated", platformRole: body.platformRole });
  });

  app.get("/api/v1/admin/workspace-mailboxes", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const mailboxes = await app.services.prisma.workspaceMailbox.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        workspace: { select: { name: true, slug: true } }
      }
    });

    return reply.send({ mailboxes });
  });

  app.post("/api/v1/admin/workspace-mailboxes", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const body = z.object({
      workspaceId: z.string().min(1),
      emailAddress: z.string().email(),
      provider: z.enum(["GMAIL", "OUTLOOK"]).default("OUTLOOK"),
      displayName: z.string().max(200).optional(),
      ingestionMode: z.enum(["NATIVE", "N8N"]).default("N8N")
    }).parse(request.body);

    const normalized = body.emailAddress.toLowerCase();

    const mailbox = await app.services.prisma.workspaceMailbox.create({
      data: {
        workspaceId: body.workspaceId,
        emailAddress: body.emailAddress,
        normalizedEmail: normalized,
        provider: body.provider,
        displayName: body.displayName ?? body.emailAddress,
        status: "ACTIVE",
        ingestionMode: body.ingestionMode
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId: body.workspaceId,
      actorUserId: admin.userId,
      entityType: "WORKSPACE_MAILBOX",
      entityId: mailbox.id,
      action: "admin.workspace_mailbox_created",
      metadata: { email: normalized, provider: body.provider, ingestionMode: body.ingestionMode },
      request
    });

    return reply.code(201).send({ mailbox });
  });

  app.patch("/api/v1/admin/workspace-mailboxes/:mailboxId/pause", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { mailboxId } = z.object({ mailboxId: z.string().min(1) }).parse(request.params);
    await app.services.prisma.workspaceMailbox.update({ where: { id: mailboxId }, data: { status: "PAUSED" } });
    return reply.send({ status: "paused" });
  });

  app.patch("/api/v1/admin/workspace-mailboxes/:mailboxId/resume", async (request, reply) => {
    const admin = await requirePlatformAdminAccess(app, request, reply);
    if (!admin) return;

    const { mailboxId } = z.object({ mailboxId: z.string().min(1) }).parse(request.params);
    await app.services.prisma.workspaceMailbox.update({ where: { id: mailboxId }, data: { status: "ACTIVE" } });
    return reply.send({ status: "active" });
  });
};
