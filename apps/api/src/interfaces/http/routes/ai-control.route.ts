import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  getAiControlCenterDto,
  updateAiControlCenter,
} from "../../../application/services/ai-control-center.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  MEMBER: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

function hasMinRole(current: string, required: string): boolean {
  return (ROLE_RANK[current] ?? -1) >= (ROLE_RANK[required] ?? 999);
}

const wsParams = z.object({ workspaceId: z.string().min(1) });

const patchBody = z.object({
  confirm: z.literal(true),
  expectedConfigVersion: z.number().int().nonnegative().nullable().optional(),
  subsystems: z.record(
    z.string(),
    z
      .object({
        enabled: z.boolean().optional(),
        productionModelId: z.string().min(1).optional(),
      })
      .strict()
  ),
});

async function requireAdmin(
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
  if (!hasMinRole(membership.role, "ADMIN")) {
    reply.code(403).send({ message: "ADMIN or OWNER required" });
    return null;
  }
  return { userId: session.userId, role: membership.role };
}

export async function registerAiControlRoutes(app: FastifyInstance) {
  app.get(
    "/api/v1/workspaces/:workspaceId/ai-control",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireAdmin(app, request, reply, workspaceId);
      if (!auth) return;
      const dto = await getAiControlCenterDto(app.services.prisma, workspaceId);
      return reply.send(dto);
    }
  );

  app.put(
    "/api/v1/workspaces/:workspaceId/ai-control",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireAdmin(app, request, reply, workspaceId);
      if (!auth) return;
      const body = patchBody.parse(request.body ?? {});
      try {
        const patch: Record<
          string,
          { enabled?: boolean; productionModelId?: string }
        > = {};
        for (const [id, partial] of Object.entries(body.subsystems)) {
          const next: { enabled?: boolean; productionModelId?: string } = {};
          if (typeof partial.enabled === "boolean") next.enabled = partial.enabled;
          if (typeof partial.productionModelId === "string") {
            next.productionModelId = partial.productionModelId;
          }
          patch[id] = next;
        }
        const config = await updateAiControlCenter({
          prisma: app.services.prisma,
          workspaceId,
          userId: auth.userId,
          patch,
          confirm: body.confirm,
          expectedConfigVersion: body.expectedConfigVersion ?? null,
        });
        return reply.send({
          config,
          note: "Changes apply to future eligible processing only. Historical records are not rewritten.",
        });
      } catch (err) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode: number }).statusCode)
            : 500;
        return reply
          .code(status)
          .send({ message: err instanceof Error ? err.message : "Failed" });
      }
    }
  );
}
