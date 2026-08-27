import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { listUserMemberships } from "../../../application/services/workspace-access.js";
import {
  clearSessionCookie,
  getSessionFromRequest,
  readSessionIdFromRequest,
  setSessionCookie
} from "../authentication.js";

const googleAuthStartQuerySchema = z.object({
  redirect: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
});

const googleAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional()
});

const microsoftAuthStartQuerySchema = z.object({
  redirect: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true")
});

const microsoftAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional()
});

const upsertGoogleUser = async (
  app: FastifyInstance,
  profile: {
    subject: string;
    email: string;
    name: string | null;
    picture: string | null;
  }
) => {
  const existingBySubject = await app.services.prisma.user.findUnique({
    where: {
      googleSubject: profile.subject
    }
  });

  if (existingBySubject) {
    return app.services.prisma.user.update({
      where: {
        id: existingBySubject.id
      },
      data: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
        lastLoginAt: new Date()
      }
    });
  }

  const existingByEmail = await app.services.prisma.user.findUnique({
    where: {
      email: profile.email
    }
  });

  if (existingByEmail) {
    if (
      existingByEmail.googleSubject &&
      existingByEmail.googleSubject !== profile.subject
    ) {
      throw new Error("Google account is already linked to a different user");
    }

    return app.services.prisma.user.update({
      where: {
        id: existingByEmail.id
      },
      data: {
        googleSubject: profile.subject,
        name: profile.name,
        avatarUrl: profile.picture,
        lastLoginAt: new Date()
      }
    });
  }

  return app.services.prisma.user.create({
    data: {
      googleSubject: profile.subject,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      lastLoginAt: new Date()
    }
  });
};

const upsertMicrosoftUser = async (
  app: FastifyInstance,
  profile: {
    subject: string;
    email: string;
    name: string | null;
    picture: string | null;
  }
) => {
  const existingBySubject = await app.services.prisma.user.findUnique({
    where: {
      microsoftSubject: profile.subject
    }
  });

  if (existingBySubject) {
    return app.services.prisma.user.update({
      where: {
        id: existingBySubject.id
      },
      data: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture ?? existingBySubject.avatarUrl,
        lastLoginAt: new Date()
      }
    });
  }

  const existingByEmail = await app.services.prisma.user.findUnique({
    where: {
      email: profile.email
    }
  });

  if (existingByEmail) {
    if (
      existingByEmail.microsoftSubject &&
      existingByEmail.microsoftSubject !== profile.subject
    ) {
      throw new Error("Microsoft account is already linked to a different user");
    }

    return app.services.prisma.user.update({
      where: {
        id: existingByEmail.id
      },
      data: {
        microsoftSubject: profile.subject,
        name: profile.name ?? existingByEmail.name,
        avatarUrl: profile.picture ?? existingByEmail.avatarUrl,
        lastLoginAt: new Date()
      }
    });
  }

  return app.services.prisma.user.create({
    data: {
      microsoftSubject: profile.subject,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      lastLoginAt: new Date()
    }
  });
};

const destroySession = async (
  app: FastifyInstance,
  request: Parameters<typeof readSessionIdFromRequest>[0],
  reply: Parameters<typeof clearSessionCookie>[1]
) => {
  const sessionId = readSessionIdFromRequest(request);
  if (sessionId) {
    await app.services.sessionStore.delete(sessionId);
  }
  clearSessionCookie(request, reply);
};

export const registerAuthRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.get("/api/v1/auth/google/start", async (request, reply) => {
    if (!app.services.googleOAuthService.isConfigured()) {
      return reply.code(503).send({
        message: "Google OAuth is not configured"
      });
    }

    const query = googleAuthStartQuerySchema.parse(request.query);
    const stateWriteResult = await app.services.oauthStateStore.create({
      flow: "app-auth",
      createdAt: new Date().toISOString()
    });

    if (!stateWriteResult.written) {
      return reply.code(500).send({
        message: "Failed to persist Google auth state"
      });
    }

    const authorizationUrl =
      app.services.googleOAuthService.createAppAuthUrl(stateWriteResult.stateId);

    if (query.redirect) {
      return reply.redirect(authorizationUrl);
    }

    return reply.send({
      status: "authorization_required",
      flow: "app-auth",
      authorizationUrl
    });
  });

  app.get("/api/v1/auth/google/callback", async (request, reply) => {
    if (!app.services.googleOAuthService.isConfigured()) {
      return reply.code(503).send({
        message: "Google OAuth is not configured"
      });
    }

    const query = googleAuthCallbackQuerySchema.parse(request.query);

    if (query.error || !query.code || !query.state) {
      if (query.state) {
        await app.services.oauthStateStore.consume("app-auth", query.state);
      }

      return reply.code(400).send({
        message: "Google authentication failed",
        error: query.error ?? "missing_code_or_state",
        errorDescription: query.error_description ?? null
      });
    }

    const stateReadResult = await app.services.oauthStateStore.consume(
      "app-auth",
      query.state
    );

    if (!stateReadResult.found || !stateReadResult.state) {
      return reply.code(400).send({
        message: "Invalid or expired Google auth state"
      });
    }

    try {
      const tokens = await app.services.googleOAuthService.exchangeCode(
        "app-auth",
        query.code
      );

      if (!tokens.accessToken) {
        return reply.code(400).send({
          message: "Google did not return an access token"
        });
      }

      const profile = await app.services.googleOAuthService.fetchUserProfile(
        "app-auth",
        tokens.accessToken
      );

      if (!profile.emailVerified) {
        return reply.code(403).send({
          message: "Google account email must be verified"
        });
      }

      const normalizedEmail = profile.email.toLowerCase().trim();

      const approvedEntries = await app.services.prisma.approvedAccess.findMany({
        where: {
          email: normalizedEmail,
          status: "ACTIVE"
        },
        include: {
          workspace: {
            select: { id: true, name: true, slug: true }
          }
        }
      });

      if (approvedEntries.length === 0) {
        app.log.warn({
          event: "auth.access_denied",
          email: normalizedEmail,
          ip: request.ip
        });

        return reply.redirect(
          `${app.services.env.FRONTEND_URL}/?access=denied`
        );
      }

      const user = await upsertGoogleUser(app, profile);

      for (const entry of approvedEntries) {
        await app.services.prisma.membership.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: entry.workspaceId,
              userId: user.id
            }
          },
          update: {
            role: entry.role
          },
          create: {
            workspaceId: entry.workspaceId,
            userId: user.id,
            role: entry.role
          }
        });
      }

      const sessionId = await app.services.sessionStore.create({
        userId: user.id,
        email: user.email,
        createdAt: new Date().toISOString()
      });

      setSessionCookie(request, reply, sessionId);

      for (const entry of approvedEntries) {
        await app.services.auditEventLogger.log({
          workspaceId: entry.workspaceId,
          actorUserId: user.id,
          entityType: "USER",
          entityId: user.id,
          action: "auth.sign_in_approved",
          metadata: {
            email: user.email,
            role: entry.role,
            approvedAccessId: entry.id
          },
          request
        });
      }

      return reply.redirect(app.services.env.FRONTEND_URL);
    } catch (error) {
      request.log.error(error);

      return reply.code(400).send({
        message: "Google authentication callback failed",
        error:
          error instanceof Error ? error.message : "Unknown authentication error"
      });
    }
  });

  // --- Microsoft OAuth routes ---

  const isMicrosoftAuthConfigured = () =>
    Boolean(
      app.services.env.MICROSOFT_AUTH_CLIENT_ID &&
      app.services.env.MICROSOFT_AUTH_CLIENT_SECRET &&
      app.services.env.MICROSOFT_AUTH_REDIRECT_URI
    );

  app.get("/api/v1/auth/microsoft/start", async (request, reply) => {
    if (!isMicrosoftAuthConfigured()) {
      return reply.code(503).send({
        message: "Microsoft OAuth is not configured"
      });
    }

    const query = microsoftAuthStartQuerySchema.parse(request.query);
    const stateWriteResult = await app.services.oauthStateStore.create({
      flow: "app-auth",
      createdAt: new Date().toISOString()
    });

    if (!stateWriteResult.written) {
      return reply.code(500).send({
        message: "Failed to persist Microsoft auth state"
      });
    }

    const params = new URLSearchParams({
      client_id: app.services.env.MICROSOFT_AUTH_CLIENT_ID!,
      response_type: "code",
      redirect_uri: app.services.env.MICROSOFT_AUTH_REDIRECT_URI!,
      scope: "openid profile email User.Read",
      state: stateWriteResult.stateId,
      prompt: "select_account"
    });

    const authorizationUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;

    if (query.redirect) {
      return reply.redirect(authorizationUrl);
    }

    return reply.send({
      status: "authorization_required",
      flow: "app-auth",
      authorizationUrl
    });
  });

  app.get("/api/v1/auth/microsoft/callback", async (request, reply) => {
    if (!isMicrosoftAuthConfigured()) {
      return reply.code(503).send({
        message: "Microsoft OAuth is not configured"
      });
    }

    const query = microsoftAuthCallbackQuerySchema.parse(request.query);

    if (query.error || !query.code || !query.state) {
      if (query.state) {
        await app.services.oauthStateStore.consume("app-auth", query.state);
      }

      return reply.code(400).send({
        message: "Microsoft authentication failed",
        error: query.error ?? "missing_code_or_state",
        errorDescription: query.error_description ?? null
      });
    }

    const stateReadResult = await app.services.oauthStateStore.consume(
      "app-auth",
      query.state
    );

    if (!stateReadResult.found || !stateReadResult.state) {
      return reply.code(400).send({
        message: "Invalid or expired Microsoft auth state"
      });
    }

    try {
      const tokenResponse = await fetch(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: app.services.env.MICROSOFT_AUTH_CLIENT_ID!,
            client_secret: app.services.env.MICROSOFT_AUTH_CLIENT_SECRET!,
            code: query.code,
            redirect_uri: app.services.env.MICROSOFT_AUTH_REDIRECT_URI!,
            grant_type: "authorization_code",
            scope: "openid profile email User.Read"
          }).toString()
        }
      );

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        request.log.error({ event: "microsoft.token_exchange_failed", body: errorBody });
        return reply.code(400).send({
          message: "Microsoft token exchange failed"
        });
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token?: string;
        id_token?: string;
        token_type?: string;
      };

      if (!tokenData.access_token) {
        return reply.code(400).send({
          message: "Microsoft did not return an access token"
        });
      }

      const meResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`
        }
      });

      if (!meResponse.ok) {
        return reply.code(400).send({
          message: "Failed to fetch Microsoft user profile"
        });
      }

      const meData = (await meResponse.json()) as {
        id?: string;
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      };

      const microsoftSubject = meData.id;
      const email = (meData.mail || meData.userPrincipalName || "").toLowerCase().trim();
      const name = meData.displayName || null;

      if (!microsoftSubject || !email) {
        return reply.code(400).send({
          message: "Microsoft profile is missing required fields (id or email)"
        });
      }

      const normalizedEmail = email.toLowerCase().trim();

      const approvedEntries = await app.services.prisma.approvedAccess.findMany({
        where: {
          email: normalizedEmail,
          status: "ACTIVE"
        },
        include: {
          workspace: {
            select: { id: true, name: true, slug: true }
          }
        }
      });

      if (approvedEntries.length === 0) {
        app.log.warn({
          event: "auth.access_denied",
          email: normalizedEmail,
          provider: "microsoft",
          ip: request.ip
        });

        return reply.redirect(
          `${app.services.env.FRONTEND_URL}/?access=denied`
        );
      }

      const user = await upsertMicrosoftUser(app, {
        subject: microsoftSubject,
        email: normalizedEmail,
        name,
        picture: null
      });

      for (const entry of approvedEntries) {
        await app.services.prisma.membership.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: entry.workspaceId,
              userId: user.id
            }
          },
          update: {
            role: entry.role
          },
          create: {
            workspaceId: entry.workspaceId,
            userId: user.id,
            role: entry.role
          }
        });
      }

      const sessionId = await app.services.sessionStore.create({
        userId: user.id,
        email: user.email,
        createdAt: new Date().toISOString()
      });

      setSessionCookie(request, reply, sessionId);

      for (const entry of approvedEntries) {
        await app.services.auditEventLogger.log({
          workspaceId: entry.workspaceId,
          actorUserId: user.id,
          entityType: "USER",
          entityId: user.id,
          action: "auth.sign_in_approved",
          metadata: {
            email: user.email,
            provider: "microsoft",
            role: entry.role,
            approvedAccessId: entry.id
          },
          request
        });
      }

      return reply.redirect(app.services.env.FRONTEND_URL);
    } catch (error) {
      request.log.error(error);

      return reply.code(400).send({
        message: "Microsoft authentication callback failed",
        error:
          error instanceof Error ? error.message : "Unknown authentication error"
      });
    }
  });

  app.get("/api/v1/auth/session", async (request, reply) => {
    const session = await getSessionFromRequest(request);

    const microsoftAuthAvailable = Boolean(
      app.services.env.MICROSOFT_AUTH_CLIENT_ID &&
      app.services.env.MICROSOFT_AUTH_CLIENT_SECRET &&
      app.services.env.MICROSOFT_AUTH_REDIRECT_URI
    );

    if (!session) {
      return reply.send({
        authenticated: false,
        user: null,
        memberships: [],
        microsoftAuthAvailable
      });
    }

    const user = await app.services.prisma.user.findUnique({
      where: {
        id: session.userId
      }
    });

    if (!user) {
      await destroySession(app, request, reply);
      return reply.send({
        authenticated: false,
        user: null,
        memberships: [],
        microsoftAuthAvailable
      });
    }

    const approvedCount = await app.services.prisma.approvedAccess.count({
      where: {
        email: user.email.toLowerCase(),
        status: "ACTIVE"
      }
    });

    if (approvedCount === 0) {
      await destroySession(app, request, reply);
      return reply.send({
        authenticated: false,
        accessRevoked: true,
        user: null,
        memberships: [],
        microsoftAuthAvailable
      });
    }

    const memberships = await listUserMemberships(app.services.prisma, user.id);

    return reply.send({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
        platformRole: user.platformRole
      },
      memberships: memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        workspaceRole: membership.workspaceRole,
        pinnedInboxConnectionId: membership.pinnedInboxConnectionId ?? null,
        workspace: membership.workspace
      })),
      microsoftAuthAvailable
    });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    await destroySession(app, request, reply);

    return reply.send({
      status: "logged_out"
    });
  });
};
