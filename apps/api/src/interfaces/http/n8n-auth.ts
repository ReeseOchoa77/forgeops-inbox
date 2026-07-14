import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";

export const verifyN8nApiKey = (
  request: FastifyRequest,
  reply: FastifyReply,
  configuredKey: string | undefined,
  integrationEnabled: boolean
): boolean => {
  if (!integrationEnabled || !configuredKey || configuredKey.length < 32) {
    reply.code(503).send({
      message: "n8n integration is not configured or disabled"
    });
    return false;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ message: "Missing or invalid Authorization header" });
    return false;
  }

  const providedKey = authHeader.slice(7);
  if (!providedKey) {
    reply.code(401).send({ message: "Missing API key" });
    return false;
  }

  const a = Buffer.from(configuredKey, "utf-8");
  const b = Buffer.from(providedKey.padEnd(a.length, "\0").slice(0, a.length), "utf-8");

  if (a.length !== b.length || !timingSafeEqual(a, b) || providedKey.length !== configuredKey.length) {
    reply.code(401).send({ message: "Invalid API key" });
    return false;
  }

  return true;
};
