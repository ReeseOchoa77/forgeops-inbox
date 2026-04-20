import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const addApprovedAccessBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]).default("MEMBER")
});

const updateApprovedAccessBodySchema = z.object({
  status: z.enum(["ACTIVE", "REVOKED"]).optional(),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]).optional()
});

const accessEntryParamsSchema = z.object({
  workspaceId: z.string().min(1),
  accessId: z.string().min(1)
});

const requireAdmin = async (app: FastifyInstance, request: { headers: Record<string, unknown> } & Parameters<typeof getSessionFromRequest>[0], workspaceId: string) => {
  const session = await getSessionFromRequest(request);
  if (!session) return { session: null, membership: null };

  const membership = await requireWorkspaceMembership(
    app.services.prisma,
    session.userId,
    workspaceId
  );

  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return { session, membership: null };
  }

  return { session, membership };
};

export const registerAllowlistRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/approved-access",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);

      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      const entries = await app.services.prisma.approvedAccess.findMany({
        where: { workspaceId: params.workspaceId },
        orderBy: { createdAt: "desc" },
        include: {
          invitedByUser: {
            select: { id: true, email: true, name: true }
          }
        }
      });

      return reply.send({
        workspaceId: params.workspaceId,
        entries: entries.map(e => ({
          id: e.id,
          email: e.email,
          role: e.role,
          status: e.status,
          invitedBy: e.invitedByUser
            ? { id: e.invitedByUser.id, email: e.invitedByUser.email, name: e.invitedByUser.name }
            : null,
          createdAt: e.createdAt.toISOString(),
          updatedAt: e.updatedAt.toISOString()
        }))
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/approved-access",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const body = addApprovedAccessBodySchema.parse(request.body);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);

      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      const normalizedEmail = body.email.toLowerCase().trim();

      const existing = await app.services.prisma.approvedAccess.findUnique({
        where: {
          workspaceId_email: {
            workspaceId: params.workspaceId,
            email: normalizedEmail
          }
        }
      });

      if (existing) {
        if (existing.status === "ACTIVE") {
          return reply.code(409).send({
            message: "Email is already approved for this workspace",
            existingEntry: { id: existing.id, email: existing.email, role: existing.role, status: existing.status }
          });
        }

        const reactivated = await app.services.prisma.approvedAccess.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            role: body.role,
            invitedByUserId: session.userId
          }
        });

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          actorUserId: session.userId,
          entityType: "APPROVED_ACCESS",
          entityId: reactivated.id,
          action: "approved_access.reactivated",
          metadata: { email: normalizedEmail, role: body.role },
          request
        });

        return reply.code(200).send({
          status: "reactivated",
          entry: { id: reactivated.id, email: reactivated.email, role: reactivated.role, status: reactivated.status }
        });
      }

      const entry = await app.services.prisma.approvedAccess.create({
        data: {
          email: normalizedEmail,
          workspaceId: params.workspaceId,
          role: body.role,
          status: "ACTIVE",
          invitedByUserId: session.userId
        }
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "APPROVED_ACCESS",
        entityId: entry.id,
        action: "approved_access.created",
        metadata: { email: normalizedEmail, role: body.role },
        request
      });

      return reply.code(201).send({
        status: "created",
        entry: { id: entry.id, email: entry.email, role: entry.role, status: entry.status }
      });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/approved-access/:accessId",
    async (request, reply) => {
      const params = accessEntryParamsSchema.parse(request.params);
      const body = updateApprovedAccessBodySchema.parse(request.body);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);

      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      const entry = await app.services.prisma.approvedAccess.findFirst({
        where: { id: params.accessId, workspaceId: params.workspaceId }
      });

      if (!entry) return reply.code(404).send({ message: "Approved access entry not found" });

      const updated = await app.services.prisma.approvedAccess.update({
        where: { id: entry.id },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.role ? { role: body.role } : {})
        }
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "APPROVED_ACCESS",
        entityId: entry.id,
        action: body.status === "REVOKED" ? "approved_access.revoked" : "approved_access.updated",
        metadata: { email: entry.email, changes: body },
        request
      });

      return reply.send({
        status: "updated",
        entry: { id: updated.id, email: updated.email, role: updated.role, status: updated.status }
      });
    }
  );
};
