import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createDevelopmentWorkspace } from "../../../application/services/dev-workspace-provisioner.js";
import { getSessionFromRequest } from "../authentication.js";

const bootstrapWorkspaceBodySchema = z.object({
  name: z.string().min(2).max(80),
  timezone: z.string().min(2).max(80).optional()
});

export const registerDevRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post("/api/v1/dev/bootstrap/workspace", async (request, reply) => {
    const enabled =
      app.services.env.NODE_ENV !== "production" &&
      app.services.env.DEV_ENABLE_BOOTSTRAP_ROUTES;

    if (!enabled) {
      return reply.code(404).send({
        message: "Development bootstrap routes are disabled"
      });
    }

    const session = await getSessionFromRequest(request);

    if (!session) {
      return reply.code(401).send({
        message: "Authentication required"
      });
    }

    const body = bootstrapWorkspaceBodySchema.parse(request.body);

    const workspace = await createDevelopmentWorkspace(app.services.prisma, {
      userId: session.userId,
      name: body.name,
      ...(body.timezone ? { timezone: body.timezone } : {})
    });

    await app.services.auditEventLogger.log({
      workspaceId: workspace.id,
      actorUserId: session.userId,
      entityType: "WORKSPACE",
      entityId: workspace.id,
      action: "workspace.dev_bootstrap_created",
      metadata: {
        name: workspace.name,
        timezone: workspace.timezone
      },
      request
    });

    return reply.code(201).send({
      status: "workspace_created",
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        timezone: workspace.timezone
      }
    });
  });
};
