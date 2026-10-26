import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { searchEmailParticipants } from "../../../application/services/search-email-participants.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const paramsSchema = z.object({
  workspaceId: z.string().min(1),
});

const querySchema = z.object({
  q: z.string().min(1).max(200),
  role: z.enum(["sender", "recipient"]).default("sender"),
  limit: z.coerce.number().int().min(1).max(10).default(8),
});

export const registerEmailParticipantRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/email-participants/search",
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const query = querySchema.parse(request.query);
      const session = await getSessionFromRequest(request);
      if (!session) {
        return reply.code(401).send({ message: "Authentication required" });
      }

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        params.workspaceId
      );
      if (!membership) {
        return reply.code(403).send({ message: "Workspace access denied" });
      }

      const participants = await searchEmailParticipants(app.services.prisma, {
        workspaceId: params.workspaceId,
        q: query.q,
        role: query.role,
        limit: query.limit,
      });

      return reply.send({ participants });
    }
  );
};
