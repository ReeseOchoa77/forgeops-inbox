import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createOpenAIClient,
  OpenAIBusinessSubtypeClassifier,
} from "@forgeops/ai";
import {
  scoreSubtypeShadow,
  SUBTYPE_AMBIGUITY_REASONS,
  SUBTYPE_ERROR_CATEGORIES,
  SUBTYPE_VALIDATION_TARGET_DEFAULT,
  SUBTYPE_VALIDATION_TARGET_MAX,
} from "@forgeops/shared";

import {
  isBusinessSubtypeKey,
  isSubtypeErrorCategory,
  loadBlindSubtypePacket,
  loadSubtypeValidationCounts,
  loadSubtypeValidationSample,
  loadVerifiedSubtypeLabels,
  recordSubtypeVerification,
  runSubtypeShadowBatch,
  setSubtypeErrorCategory,
} from "../../../application/services/subtype-validation-review.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const ALL_MAILBOXES_CONNECTION_ID = "__all__";
const SHADOW_BATCH_MAX = 15;

function hasMinRole(role: string, min: "ADMIN" | "OWNER"): boolean {
  if (min === "OWNER") return role === "OWNER";
  return role === "OWNER" || role === "ADMIN";
}

function httpError(error: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) {
  const statusCode =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 500;
  const message = error instanceof Error ? error.message : "Subtype validation failed";
  return reply.code(Number.isFinite(statusCode) ? statusCode : 500).send({ message });
}

/**
 * Human subtype labels and shadow scoring.
 * Writes ClassificationCorrection only. Does not update Classification, jobs, tasks, or priority.
 */
export const registerSubtypeValidationRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get(
    "/api/v1/workspaces/:workspaceId/subtype-validation/counts",
    async (request, reply) => {
      const params = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      const counts = await loadSubtypeValidationCounts(app.services.prisma, params.workspaceId);
      return reply.send(counts);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/subtype-validation/verified",
    async (request, reply) => {
      const params = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      const items = await loadVerifiedSubtypeLabels(app.services.prisma, params.workspaceId);
      return reply.send({ total: items.length, items });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:connectionId/subtype-validation/sample",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        connectionId: z.string().min(1),
      }).parse(request.params);
      const query = z.object({
        target: z.coerce.number().int().min(1).max(SUBTYPE_VALIDATION_TARGET_MAX).optional(),
      }).parse(request.query);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      const inboxConnectionId =
        params.connectionId === ALL_MAILBOXES_CONNECTION_ID ? null : params.connectionId;
      if (inboxConnectionId) {
        const connection = await app.services.prisma.inboxConnection.findFirst({
          where: { id: inboxConnectionId, workspaceId: params.workspaceId },
          select: { id: true },
        });
        if (!connection) return reply.code(404).send({ message: "Mailbox not found" });
      }
      const sample = await loadSubtypeValidationSample(app.services.prisma, {
        workspaceId: params.workspaceId,
        inboxConnectionId,
        target: query.target ?? SUBTYPE_VALIDATION_TARGET_DEFAULT,
      });
      return reply.send({
        classificationIds: sample.classificationIds,
        target: sample.target,
        available: sample.available,
        items: sample.items,
        progress: sample.progress,
      });
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/classifications/:classificationId/subtype-validation/packet",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        classificationId: z.string().min(1),
      }).parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      try {
        const packet = await loadBlindSubtypePacket(app.services.prisma, {
          workspaceId: params.workspaceId,
          classificationId: params.classificationId,
        });
        return reply.send(packet);
      } catch (error) {
        return httpError(error, reply);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/classifications/:classificationId/subtype-verification",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        classificationId: z.string().min(1),
      }).parse(request.params);
      const body = z.object({
        action: z.enum(["confirm", "change", "blind", "ambiguous"]),
        businessType: z.string().max(64).optional(),
        ambiguityReason: z.enum(SUBTYPE_AMBIGUITY_REASONS).optional(),
      }).parse(request.body);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      if (body.action === "change" && body.businessType && !isBusinessSubtypeKey(body.businessType)) {
        return reply.code(400).send({ message: "Choose one of the existing subtypes" });
      }
      try {
        const result = await recordSubtypeVerification(app.services.prisma, {
          workspaceId: params.workspaceId,
          classificationId: params.classificationId,
          userId: session.userId,
          action: body.action,
          businessType: body.businessType,
          ambiguityReason: body.ambiguityReason,
        });
        return reply.send({
          status: "verified",
          ...result,
          classificationUnchanged: true,
        });
      } catch (error) {
        return httpError(error, reply);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/classifications/:classificationId/subtype-verification/category",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        classificationId: z.string().min(1),
      }).parse(request.params);
      const body = z.object({
        category: z.enum(SUBTYPE_ERROR_CATEGORIES),
      }).parse(request.body);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      if (!isSubtypeErrorCategory(body.category)) {
        return reply.code(400).send({ message: "Unknown error category" });
      }
      try {
        const result = await setSubtypeErrorCategory(app.services.prisma, {
          workspaceId: params.workspaceId,
          classificationId: params.classificationId,
          category: body.category,
        });
        return reply.send(result);
      } catch (error) {
        return httpError(error, reply);
      }
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/subtype-validation/shadow",
    async (request, reply) => {
      const params = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
      const body = z.object({
        classificationIds: z.array(z.string().min(1)).min(1).max(SHADOW_BATCH_MAX),
      }).parse(request.body);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      const client = createOpenAIClient({
        ...(app.services.env.OPENAI_API_KEY ? { apiKey: app.services.env.OPENAI_API_KEY } : {}),
      });
      if (!client) {
        return reply.code(503).send({ message: "OpenAI is not configured. Shadow evaluation was not run." });
      }
      const classifier = new OpenAIBusinessSubtypeClassifier(client, app.services.env.OPENAI_SUBTYPE_MODEL);
      const result = await runSubtypeShadowBatch(app.services.prisma, {
        workspaceId: params.workspaceId,
        classificationIds: body.classificationIds,
        classify: (email) => classifier.classify(email),
      });
      return reply.send({
        ...result,
        persistedToClassification: false,
        model: classifier.getModel(),
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/subtype-validation/score",
    async (request, reply) => {
      const params = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
      const body = z.object({
        predictions: z.array(z.object({
          classificationId: z.string().min(1),
          expected: z.string(),
          predicted: z.string(),
          confidence: z.number(),
          competingType: z.string().nullable(),
          inputChars: z.number().optional(),
        })).max(SUBTYPE_VALIDATION_TARGET_MAX),
      }).parse(request.body);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      if (!hasMinRole(membership.role, "ADMIN")) {
        return reply.code(403).send({ message: "Subtype validation requires Admin or Owner role" });
      }
      return reply.send(scoreSubtypeShadow(body.predictions));
    }
  );
};
