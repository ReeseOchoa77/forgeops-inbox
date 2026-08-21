import type { InboxConnectionStatus } from "@prisma/client";
import type { InboxProviderKind } from "@forgeops/shared";
import { normalizeEmail, providerKindFromEnum, providerKindToEnum } from "@forgeops/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import {
  assertTargetedMailboxEmailMatch,
  buildAuthorizationFields,
  validateAuthorizeExistingTarget,
} from "../../../application/services/inbox-authorization-status.js";
import {
  coalesceMicrosoftGrantedScopes,
  findMissingOutlookRequiredScopes,
} from "../../../infrastructure/providers/outlook/outlook-provider.js";
import { getSessionFromRequest } from "../authentication.js";

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const workspaceConnectionParamsSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1)
});

const startInboxConnectionBodySchema = z.object({}).strict();

const developmentInboxConnectionStartQuerySchema = z.object({
  redirect: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false")
});

const inboxConnectionCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional()
});

const resolveOAuthProvider = (app: FastifyInstance, kind: InboxProviderKind) =>
  app.services.providerRegistry.getOAuthProvider(kind);

const serializeConnection = (connection: {
  id: string;
  workspaceId: string;
  provider: string;
  email: string;
  displayName: string | null;
  status: InboxConnectionStatus;
  grantedScopes: string[];
  providerAccountId: string | null;
  accessTokenExpiresAt: Date | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  lastSyncedAt: Date | null;
  encryptedRefreshToken?: string | null;
}) => {
  const auth = buildAuthorizationFields({
    provider: connection.provider,
    status: connection.status,
    hasRefreshToken: Boolean(connection.encryptedRefreshToken),
    grantedScopes: connection.grantedScopes,
  });

  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    provider: connection.provider.toLowerCase(),
    email: connection.email,
    displayName: connection.displayName,
    status: connection.status,
    grantedScopes: connection.grantedScopes,
    providerAccountId: connection.providerAccountId,
    accessTokenExpiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    disconnectedAt: connection.disconnectedAt?.toISOString() ?? null,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    authorizationStatus: auth.authorizationStatus,
    capabilities: auth.capabilities,
  };
};

type SerializedConnection = ReturnType<typeof serializeConnection>;

const requireAuthenticatedWorkspaceAccess = async (
  app: FastifyInstance,
  request: FastifyRequest,
  workspaceId: string
) => {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return { session: null, membership: null };
  }

  const membership = await requireWorkspaceMembership(
    app.services.prisma,
    session.userId,
    workspaceId
  );

  return { session, membership };
};

const buildAuditMetadata = (
  extra: Record<string, unknown>
): Record<string, unknown> => extra;

const isDevelopmentRouteEnabled = (app: FastifyInstance): boolean =>
  app.services.env.NODE_ENV !== "production" &&
  app.services.env.DEV_ENABLE_BOOTSTRAP_ROUTES;

interface PreparedInboxAuthorization {
  authorizationUrl: string;
  requestedScopes: string[];
  written: boolean;
}

const prepareInboxAuthorization = async (input: {
  app: FastifyInstance;
  request: FastifyRequest;
  workspaceId: string;
  userId: string;
  reconnect: boolean;
  authorizeExisting?: boolean;
  connectionId?: string;
  providerKind: InboxProviderKind;
}): Promise<PreparedInboxAuthorization> => {
  const provider = resolveOAuthProvider(input.app, input.providerKind);

  const stateWriteResult = await input.app.services.oauthStateStore.create({
    flow: "inbox-connect",
    provider: input.providerKind,
    workspaceId: input.workspaceId,
    userId: input.userId,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    reconnect: input.reconnect,
    authorizeExisting: input.authorizeExisting ?? false,
    createdAt: new Date().toISOString()
  });
  const authorizationUrl = provider.getAuthorizationUrl({
    state: stateWriteResult.stateId
  });

  return {
    authorizationUrl,
    requestedScopes: [...provider.getRequiredScopes()],
    written: stateWriteResult.written
  };
};

const buildInboxAuthorizationResponse = (input: {
  workspaceId: string;
  flow: "inbox-connect" | "inbox-reconnect" | "inbox-authorize";
  authorization: PreparedInboxAuthorization;
  connection?: SerializedConnection;
}) => ({
  status: "authorization_required" as const,
  flow: input.flow,
  authorizationUrl: input.authorization.authorizationUrl,
  requestedScopes: input.authorization.requestedScopes,
  workspaceId: input.workspaceId,
  ...(input.connection ? { connection: input.connection } : {})
});

/** Ensure WorkspaceMailbox for this Outlook email points at the canonical connection. */
async function linkWorkspaceMailboxToConnection(input: {
  app: FastifyInstance;
  workspaceId: string;
  provider: "OUTLOOK" | "GMAIL";
  mailboxEmail: string;
  inboxConnectionId: string;
}): Promise<void> {
  const normalized = normalizeEmail(input.mailboxEmail);
  await input.app.services.prisma.workspaceMailbox.updateMany({
    where: {
      workspaceId: input.workspaceId,
      provider: input.provider,
      normalizedEmail: normalized,
    },
    data: {
      inboxConnectionId: input.inboxConnectionId,
    },
  });
}

export const registerInboxConnectionRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/google/start",
    async (request, reply) => {
      const gmailProvider = resolveOAuthProvider(app, "gmail");
      if (!gmailProvider.isConfigured()) {
        return reply.code(503).send({
          message: "Google OAuth is not configured"
        });
      }

      const params = workspaceParamsSchema.parse(request.params);
      startInboxConnectionBodySchema.parse(request.body ?? {});

      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const authorization = await prepareInboxAuthorization({
        app,
        request,
        workspaceId: params.workspaceId,
        userId: session.userId,
        reconnect: false,
        providerKind: "gmail"
      });

      if (!authorization.written) {
        return reply.code(500).send({
          message: "Failed to persist inbox connection state"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: "pending",
        action: "inbox_connection.connect_requested",
        metadata: buildAuditMetadata({
          reconnect: false,
          provider: "gmail",
          scopes: authorization.requestedScopes
        }),
        request
      });

      return reply.send(
        buildInboxAuthorizationResponse({
          workspaceId: params.workspaceId,
          flow: "inbox-connect",
          authorization
        })
      );
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/outlook/start",
    async (request, reply) => {
      const outlookProvider = resolveOAuthProvider(app, "outlook");
      if (!outlookProvider.isConfigured()) {
        return reply.code(503).send({
          message: "Outlook OAuth is not configured"
        });
      }

      const params = workspaceParamsSchema.parse(request.params);
      startInboxConnectionBodySchema.parse(request.body ?? {});

      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const authorization = await prepareInboxAuthorization({
        app,
        request,
        workspaceId: params.workspaceId,
        userId: session.userId,
        reconnect: false,
        providerKind: "outlook"
      });

      if (!authorization.written) {
        return reply.code(500).send({
          message: "Failed to persist inbox connection state"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: "pending",
        action: "inbox_connection.connect_requested",
        metadata: buildAuditMetadata({
          reconnect: false,
          provider: "outlook",
          scopes: authorization.requestedScopes
        }),
        request
      });

      return reply.send(
        buildInboxAuthorizationResponse({
          workspaceId: params.workspaceId,
          flow: "inbox-connect",
          authorization
        })
      );
    }
  );

  app.get(
    "/api/v1/dev/workspaces/:workspaceId/inbox-connections/outlook/start",
    async (request, reply) => {
      if (!isDevelopmentRouteEnabled(app)) {
        return reply.code(404).send({
          message: "Development inbox connection routes are disabled"
        });
      }

      const outlookProvider = resolveOAuthProvider(app, "outlook");
      if (!outlookProvider.isConfigured()) {
        return reply.code(503).send({
          message: "Outlook OAuth is not configured"
        });
      }

      const params = workspaceParamsSchema.parse(request.params);
      const query = developmentInboxConnectionStartQuerySchema.parse(
        request.query
      );
      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const authorization = await prepareInboxAuthorization({
        app,
        request,
        workspaceId: params.workspaceId,
        userId: session.userId,
        reconnect: false,
        providerKind: "outlook"
      });

      if (!authorization.written) {
        return reply.code(500).send({
          message: "Failed to persist inbox connection state"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: "pending",
        action: "inbox_connection.connect_requested",
        metadata: buildAuditMetadata({
          reconnect: false,
          provider: "outlook",
          scopes: authorization.requestedScopes,
          launchedFrom: "dev_browser_route"
        }),
        request
      });

      if (query.redirect) {
        return reply.redirect(authorization.authorizationUrl);
      }

      return reply.send(
        buildInboxAuthorizationResponse({
          workspaceId: params.workspaceId,
          flow: "inbox-connect",
          authorization
        })
      );
    }
  );

  app.get(
    "/api/v1/dev/workspaces/:workspaceId/inbox-connections/google/start",
    async (request, reply) => {
      if (!isDevelopmentRouteEnabled(app)) {
        return reply.code(404).send({
          message: "Development inbox connection routes are disabled"
        });
      }

      const gmailProvider = resolveOAuthProvider(app, "gmail");
      if (!gmailProvider.isConfigured()) {
        return reply.code(503).send({
          message: "Google OAuth is not configured"
        });
      }

      const params = workspaceParamsSchema.parse(request.params);
      const query = developmentInboxConnectionStartQuerySchema.parse(
        request.query
      );
      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const authorization = await prepareInboxAuthorization({
        app,
        request,
        workspaceId: params.workspaceId,
        userId: session.userId,
        reconnect: false,
        providerKind: "gmail"
      });

      if (!authorization.written) {
        return reply.code(500).send({
          message: "Failed to persist inbox connection state"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: "pending",
        action: "inbox_connection.connect_requested",
        metadata: buildAuditMetadata({
          reconnect: false,
          provider: "gmail",
          scopes: authorization.requestedScopes,
          launchedFrom: "dev_browser_route"
        }),
        request
      });

      if (query.redirect) {
        return reply.redirect(authorization.authorizationUrl);
      }

      return reply.send(
        buildInboxAuthorizationResponse({
          workspaceId: params.workspaceId,
          flow: "inbox-connect",
          authorization
        })
      );
    }
  );

  app.get("/api/v1/inbox-connections/google/callback", async (request, reply) => {
    const query = inboxConnectionCallbackQuerySchema.parse(request.query);
    const stateId = query.state;
    const stateReadResult = stateId
      ? await app.services.oauthStateStore.consume("inbox-connect", stateId)
      : null;
    const storedState = stateReadResult?.state ?? null;

    if (!storedState || storedState.flow !== "inbox-connect") {
      return reply.code(400).send({
        message: "Invalid or expired inbox connection state"
      });
    }

    if (query.error || !query.code) {
      await app.services.auditEventLogger.log({
        workspaceId: storedState.workspaceId,
        actorUserId: storedState.userId,
        entityType: "INBOX_CONNECTION",
        entityId: storedState.connectionId ?? "pending",
        action: "inbox_connection.callback_failed",
        metadata: buildAuditMetadata({
          reconnect: storedState.reconnect,
          provider: storedState.provider,
          error: query.error ?? "missing_code"
        }),
        request
      });

      const errorMsg = encodeURIComponent(
        query.error_description ?? query.error ?? "Authorization was denied"
      );

      return reply.redirect(
        `${app.services.env.FRONTEND_URL}/?connection_error=${errorMsg}`
      );
    }

    const currentSession = await getSessionFromRequest(request);
    if (!currentSession) {
      await app.services.auditEventLogger.log({
        workspaceId: storedState.workspaceId,
        actorUserId: storedState.userId,
        entityType: "INBOX_CONNECTION",
        entityId: storedState.connectionId ?? "pending",
        action: "inbox_connection.callback_failed",
        metadata: buildAuditMetadata({
          reconnect: storedState.reconnect,
          error: "missing_authenticated_session"
        }),
        request
      });

      return reply.code(401).send({
        message: "Authentication required for inbox connection callback"
      });
    }

    if (currentSession.userId !== storedState.userId) {
      await app.services.auditEventLogger.log({
        workspaceId: storedState.workspaceId,
        actorUserId: storedState.userId,
        entityType: "INBOX_CONNECTION",
        entityId: storedState.connectionId ?? "pending",
        action: "inbox_connection.callback_failed",
        metadata: buildAuditMetadata({
          reconnect: storedState.reconnect,
          error: "authenticated_user_mismatch"
        }),
        request
      });

      return reply.code(403).send({
        message: "Authenticated user does not match the OAuth state"
      });
    }

    const providerKind: InboxProviderKind = storedState.provider;
    const dbProviderEnum = providerKindToEnum(providerKind);
    const provider = resolveOAuthProvider(app, providerKind);

    try {
      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        storedState.userId,
        storedState.workspaceId
      );

      if (!membership) {
        throw new Error("Workspace access no longer exists for this user");
      }

      const tokens = await provider.exchangeCode(query.code);

      if (!tokens.accessToken) {
        throw new Error("Provider did not return an access token");
      }

      const hasRefreshToken = Boolean(tokens.refreshToken);
      const hasIdToken = Boolean(tokens.idToken);

      // Temporary SAFE diagnostics — scope names + booleans only; never tokens/codes.
      request.log.info({
        event: "inbox_oauth_scope_validation",
        validator: "inbox-connection.route.ts:/api/v1/inbox-connections/google/callback",
        provider: providerKind,
        authorizeExisting: Boolean(storedState.authorizeExisting),
        reconnect: Boolean(storedState.reconnect),
        connectionIdPresent: Boolean(storedState.connectionId),
        returnedScopes: tokens.grantedScopes,
        hasRefreshToken,
        hasIdToken,
      });

      let scopesForValidation = tokens.grantedScopes;
      if (providerKind === "outlook") {
        // Belt-and-suspenders: coalesce again at the only live validator so we
        // do not depend solely on tokenResponse.scope echoing offline_access.
        scopesForValidation = coalesceMicrosoftGrantedScopes({
          scope: tokens.grantedScopes.join(" "),
          refreshToken: tokens.refreshToken,
          idToken: tokens.idToken,
        });
      }

      const normalizedGrantedScopes = provider.normalizeGrantedScopes(
        scopesForValidation
      );
      const requiredScopes = new Set(provider.getRequiredScopes());
      const missingRequiredScopes =
        providerKind === "outlook"
          ? findMissingOutlookRequiredScopes({
              grantedScopes: tokens.grantedScopes,
              hasRefreshToken,
              hasIdToken,
            })
          : [...requiredScopes].filter(
              (scope) => !normalizedGrantedScopes.includes(scope)
            );

      if (missingRequiredScopes.length > 0) {
        request.log.warn({
          event: "inbox_oauth_scope_validation_failed",
          validator: "inbox-connection.route.ts:/api/v1/inbox-connections/google/callback",
          provider: providerKind,
          returnedScopes: tokens.grantedScopes,
          coalescedScopes: scopesForValidation,
          normalizedGrantedScopes,
          missingRequiredScopes,
          hasRefreshToken,
          hasIdToken,
        });
        throw new Error(
          `Missing required scopes: ${missingRequiredScopes.join(", ")}`
        );
      }

      const profile = await provider.fetchUserProfile(tokens.accessToken);

      if (!profile.emailVerified) {
        throw new Error("Inbox account email must be verified");
      }

      const microsoftEmail = normalizeEmail(profile.email);
      const authorizeExisting = Boolean(storedState.authorizeExisting);
      const isTargetedFlow = Boolean(storedState.reconnect || authorizeExisting);

      let existingConnection =
        storedState.connectionId
          ? await app.services.prisma.inboxConnection.findFirst({
              where: {
                id: storedState.connectionId,
                workspaceId: storedState.workspaceId
              }
            })
          : null;

      // Untargeted connect may reconcile by workspace+provider+email.
      // Targeted flows must never fall back to Microsoft email lookup.
      if (!isTargetedFlow && !existingConnection) {
        existingConnection =
          await app.services.prisma.inboxConnection.findUnique({
            where: {
              workspaceId_provider_email: {
                workspaceId: storedState.workspaceId,
                provider: dbProviderEnum as "GMAIL" | "OUTLOOK",
                email: microsoftEmail
              }
            }
          });
      }

      if (isTargetedFlow && !storedState.connectionId) {
        throw new Error(
          storedState.reconnect
            ? "Reconnect target inbox connection is missing from OAuth state"
            : "Authorization target inbox connection is missing from OAuth state"
        );
      }

      if (isTargetedFlow && !existingConnection) {
        throw new Error(
          storedState.reconnect
            ? "Reconnect target inbox connection no longer exists"
            : "Authorization target inbox connection no longer exists"
        );
      }

      if (isTargetedFlow && existingConnection) {
        const mismatch = assertTargetedMailboxEmailMatch({
          expectedEmail: existingConnection.email,
          microsoftEmail,
        });
        if (mismatch) {
          throw new Error(mismatch);
        }
      }

      // Targeted upgrade must never create a different mailbox connection
      if (authorizeExisting && !existingConnection) {
        throw new Error("Authorization target inbox connection no longer exists");
      }

      const encryptedAccessToken = app.services.tokenCipher.encrypt(
        tokens.accessToken
      );
      const encryptedRefreshToken = tokens.refreshToken
        ? app.services.tokenCipher.encrypt(tokens.refreshToken)
        : existingConnection?.encryptedRefreshToken ?? null;

      if (!encryptedRefreshToken) {
        throw new Error(
          "Provider did not return a refresh token and no existing refresh token is stored"
        );
      }

      const now = new Date();
      const connectionCreated = !existingConnection;
      const connection = existingConnection
        ? await app.services.prisma.inboxConnection.update({
            where: {
              id: existingConnection.id
            },
            data: {
              email: microsoftEmail,
              displayName: profile.name,
              providerAccountId: profile.subject,
              grantedScopes: normalizedGrantedScopes,
              encryptedAccessToken,
              encryptedRefreshToken,
              accessTokenExpiresAt: tokens.accessTokenExpiresAt,
              connectedAt: now,
              disconnectedAt: null,
              status: "ACTIVE",
              lastSyncError: null,
              lastSyncErrorAt: null
            }
          })
        : await app.services.prisma.inboxConnection.create({
            data: {
              workspaceId: storedState.workspaceId,
              provider: dbProviderEnum as "GMAIL" | "OUTLOOK",
              email: microsoftEmail,
              displayName: profile.name,
              providerAccountId: profile.subject,
              grantedScopes: normalizedGrantedScopes,
              encryptedAccessToken,
              encryptedRefreshToken,
              accessTokenExpiresAt: tokens.accessTokenExpiresAt,
              status: "ACTIVE",
              connectedAt: now
            }
          });

      await linkWorkspaceMailboxToConnection({
        app,
        workspaceId: storedState.workspaceId,
        provider: dbProviderEnum as "GMAIL" | "OUTLOOK",
        mailboxEmail: connection.email,
        inboxConnectionId: connection.id,
      });

      await app.services.auditEventLogger.log({
        workspaceId: storedState.workspaceId,
        actorUserId: storedState.userId,
        entityType: "INBOX_CONNECTION",
        entityId: connection.id,
        action: storedState.reconnect
          ? "inbox_connection.reconnect_succeeded"
          : authorizeExisting
            ? "inbox_connection.authorize_succeeded"
            : "inbox_connection.connect_succeeded",
        metadata: buildAuditMetadata({
          email: connection.email,
          provider: providerKind,
          grantedScopes: tokens.grantedScopes,
          normalizedGrantedScopes,
          hasRefreshToken: Boolean(tokens.refreshToken),
          refreshTokenStored: Boolean(encryptedRefreshToken),
          reconnect: storedState.reconnect,
          authorizeExisting,
          connectionCreated,
        }),
        request
      });

      app.services.registerScheduledSync(storedState.workspaceId, connection.id).catch(e => {
        request.log.warn({ event: "scheduled_sync_registration_failed", error: e instanceof Error ? e.message : "unknown" });
      });

      app.inject({ method: "POST", url: `/api/v1/webhooks/register-push/${connection.id}` }).catch(e => {
        request.log.warn({ event: "push_registration_on_connect_failed", error: e instanceof Error ? e.message : "unknown" });
      });

      return reply.redirect(
        `${app.services.env.FRONTEND_URL}/?connected=${connection.id}`
      );
    } catch (error) {
      await app.services.auditEventLogger.log({
        workspaceId: storedState.workspaceId,
        actorUserId: storedState.userId,
        entityType: "INBOX_CONNECTION",
        entityId: storedState.connectionId ?? "pending",
        action: "inbox_connection.callback_failed",
        metadata: buildAuditMetadata({
          reconnect: storedState.reconnect,
          authorizeExisting: Boolean(storedState.authorizeExisting),
          provider: providerKind,
          error: error instanceof Error ? error.message : "Unknown callback error"
        }),
        request
      });

      request.log.error(error);

      const errorMsg = encodeURIComponent(
        error instanceof Error ? error.message : "Connection failed"
      );

      return reply.redirect(
        `${app.services.env.FRONTEND_URL}/?connection_error=${errorMsg}`
      );
    }
  });

  /**
   * Authorize an existing tokenless Outlook InboxConnection (e.g. n8n-created)
   * by running the standard Microsoft OAuth flow against that exact mailbox.
   * Does not replace reconnect — REQUIRES_REAUTH must use /reconnect.
   */
  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/authorize",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: {
          id: params.id,
          workspaceId: params.workspaceId
        }
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const targetCheck = validateAuthorizeExistingTarget(connection);
      if (!targetCheck.ok) {
        return reply.code(targetCheck.statusCode).send({
          message: targetCheck.message
        });
      }

      const providerKind = providerKindFromEnum(connection.provider);
      const provider = resolveOAuthProvider(app, providerKind);

      if (!provider.isConfigured()) {
        return reply.code(503).send({
          message: "Provider OAuth is not configured for this connection"
        });
      }

      const authorization = await prepareInboxAuthorization({
        app,
        request,
        workspaceId: params.workspaceId,
        userId: session.userId,
        connectionId: connection.id,
        reconnect: false,
        authorizeExisting: true,
        providerKind
      });

      if (!authorization.written) {
        return reply.code(500).send({
          message: "Failed to persist inbox authorize state"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: connection.id,
        action: "inbox_connection.authorize_requested",
        metadata: buildAuditMetadata({
          email: connection.email,
          provider: providerKind,
          scopes: authorization.requestedScopes,
          authorizeExisting: true
        }),
        request
      });

      return reply.send(
        buildInboxAuthorizationResponse({
          workspaceId: params.workspaceId,
          flow: "inbox-authorize",
          authorization,
          connection: serializeConnection(connection)
        })
      );
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id/reconnect",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: {
          id: params.id,
          workspaceId: params.workspaceId
        }
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const providerKind = providerKindFromEnum(connection.provider);
      const provider = resolveOAuthProvider(app, providerKind);

      if (!provider.isConfigured()) {
        return reply.code(503).send({
          message: "Provider OAuth is not configured for this connection"
        });
      }

      const authorization = await prepareInboxAuthorization({
        app,
        request,
        workspaceId: params.workspaceId,
        userId: session.userId,
        connectionId: connection.id,
        reconnect: true,
        providerKind
      });

      if (!authorization.written) {
        return reply.code(500).send({
          message: "Failed to persist inbox reconnect state"
        });
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: connection.id,
        action: "inbox_connection.reconnect_requested",
        metadata: buildAuditMetadata({
          email: connection.email,
          provider: providerKind,
          scopes: authorization.requestedScopes
        }),
        request
      });

      return reply.send(
        buildInboxAuthorizationResponse({
          workspaceId: params.workspaceId,
          flow: "inbox-reconnect",
          authorization,
          connection: serializeConnection(connection)
        })
      );
    }
  );

  app.delete(
    "/api/v1/workspaces/:workspaceId/inbox-connections/:id",
    async (request, reply) => {
      const params = workspaceConnectionParamsSchema.parse(request.params);
      const { session, membership } = await requireAuthenticatedWorkspaceAccess(
        app,
        request,
        params.workspaceId
      );

      if (!session) {
        return reply.code(401).send({
          message: "Authentication required"
        });
      }

      if (!membership) {
        return reply.code(403).send({
          message: "Workspace access denied"
        });
      }

      const connection = await app.services.prisma.inboxConnection.findFirst({
        where: {
          id: params.id,
          workspaceId: params.workspaceId
        }
      });

      if (!connection) {
        return reply.code(404).send({
          message: "Inbox connection not found"
        });
      }

      const disconnectedConnection =
        await app.services.prisma.inboxConnection.update({
          where: {
            id: connection.id
          },
          data: {
            status: "DISCONNECTED",
            encryptedAccessToken: null,
            encryptedRefreshToken: null,
            accessTokenExpiresAt: null,
            disconnectedAt: new Date()
          }
        });

      app.services.removeScheduledSync(connection.id).catch(e => {
        request.log.warn({ event: "scheduled_sync_removal_failed", error: e instanceof Error ? e.message : "unknown" });
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "INBOX_CONNECTION",
        entityId: connection.id,
        action: "inbox_connection.disconnected",
        metadata: buildAuditMetadata({
          email: connection.email
        }),
        request
      });

      return reply.send({
        status: "disconnected",
        connection: serializeConnection(disconnectedConnection)
      });
    }
  );
};
