import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthSession } from "../../domain/auth/auth-session.js";

const sessionCookieOptions = (request: FastifyRequest) => {
  const isProduction = request.server.services.env.NODE_ENV === "production";
  const frontendUrl = request.server.services.env.FRONTEND_URL;
  const apiHost = request.hostname;

  const crossOrigin =
    isProduction &&
    frontendUrl &&
    !frontendUrl.includes(apiHost);

  return {
    path: "/",
    httpOnly: true,
    sameSite: crossOrigin ? ("none" as const) : ("lax" as const),
    secure: isProduction,
    signed: true,
    maxAge: request.server.services.env.SESSION_TTL_SECONDS
  };
};

export const readSessionIdFromRequest = (
  request: FastifyRequest
): string | null => {
  const cookieName = request.server.services.env.SESSION_COOKIE_NAME;
  const rawCookie = request.cookies[cookieName];

  if (!rawCookie) {
    return null;
  }

  const parsed = request.unsignCookie(rawCookie);

  if (!parsed.valid) {
    return null;
  }

  return parsed.value;
};

export const getSessionFromRequest = async (
  request: FastifyRequest
): Promise<AuthSession | null> => {
  const sessionId = readSessionIdFromRequest(request);

  if (!sessionId) {
    return null;
  }

  return request.server.services.sessionStore.get(sessionId);
};

export const setSessionCookie = (
  request: FastifyRequest,
  reply: FastifyReply,
  sessionId: string
): void => {
  reply.setCookie(
    request.server.services.env.SESSION_COOKIE_NAME,
    sessionId,
    sessionCookieOptions(request)
  );
};

export const clearSessionCookie = (
  request: FastifyRequest,
  reply: FastifyReply
): void => {
  reply.clearCookie(
    request.server.services.env.SESSION_COOKIE_NAME,
    sessionCookieOptions(request)
  );
};
