import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
});

const patchBodySchema = z.object({
  pinnedInboxConnectionId: z.string().min(1).nullable(),
});

/**
 * Per-user workspace preferences (pinned default mailbox, etc.).
 */
export const registerWorkspacePreferencesRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/me/preferences",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      return reply.send({
        pinnedInboxConnectionId: membership.pinnedInboxConnectionId ?? null,
      });
    }
  );

  app.patch(
    "/api/v1/workspaces/:workspaceId/me/preferences",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const body = patchBodySchema.parse(request.body ?? {});
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      if (body.pinnedInboxConnectionId) {
        const connection = await app.services.prisma.inboxConnection.findFirst({
          where: {
            id: body.pinnedInboxConnectionId,
            workspaceId: params.workspaceId,
          },
          select: { id: true },
        });
        if (!connection) {
          return reply.code(404).send({ message: "Inbox connection not found" });
        }
      }

      const updated = await app.services.prisma.membership.update({
        where: { id: membership.id },
        data: { pinnedInboxConnectionId: body.pinnedInboxConnectionId },
        select: { pinnedInboxConnectionId: true },
      });

      return reply.send({
        pinnedInboxConnectionId: updated.pinnedInboxConnectionId ?? null,
      });
    }
  );
};
