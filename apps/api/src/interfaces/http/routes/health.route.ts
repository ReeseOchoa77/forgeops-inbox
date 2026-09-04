import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

export const registerHealthRoute = async (
  app: FastifyInstance
): Promise<void> => {
  app.get("/api/v1/health", async () => {
    const databaseCheck = app.services.prisma
      .$queryRaw`SELECT 1`
      .then(() => "up")
      .catch(() => "down");

    const redisCheck = app.services.redis
      .ping()
      .then((response: string) => (response === "PONG" ? "up" : "down"))
      .catch(() => "down");

    const [database, redis] = await Promise.all([databaseCheck, redisCheck]);
    const status =
      database === "up" && redis === "up" ? "ok" : "degraded";

    const inboxProviders: Record<string, string> = {};
    for (const kind of app.services.providerRegistry.registeredOAuthKinds) {
      const provider = app.services.providerRegistry.getOAuthProvider(kind);
      inboxProviders[kind] = provider.isConfigured() ? "configured" : "not_configured";
    }

    const env = app.services.env;

    let databaseTarget: {
      host: string | null;
      port: string | null;
      database: string | null;
      schema: string | null;
    } = { host: null, port: null, database: null, schema: null };
    try {
      const raw = process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "";
      const u = new URL(raw);
      databaseTarget = {
        host: u.hostname || null,
        port: u.port || null,
        database: u.pathname.replace(/^\//, "") || null,
        schema: u.searchParams.get("schema") ?? "public",
      };
    } catch {
      /* ignore */
    }

    const folderFields = Prisma.DiscoveredFolderScalarFieldEnum as Record<
      string,
      string
    >;

    return {
      status,
      service: "forgeops-api",
      checks: {
        database,
        redis,
        openai:
          app.services.aiClassifier.isConfigured() ? "configured" : "placeholder",
        googleAppAuth: app.services.googleOAuthService.isConfigured()
          ? "configured"
          : "not_configured",
        inboxProviders
      },
      runtime: {
        databaseTarget,
        deploy: {
          railwayGitCommitSha:
            process.env.RAILWAY_GIT_COMMIT_SHA ??
            process.env.RAILWAY_GIT_COMMIT ??
            null,
          railwayDeploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
          railwayServiceName: process.env.RAILWAY_SERVICE_NAME ?? null,
          nodeEnv: process.env.NODE_ENV ?? null,
        },
        prismaClientFields: {
          inboxConnectionId: Boolean(folderFields.inboxConnectionId),
          matchConfidence: Boolean(folderFields.matchConfidence),
          matchReason: Boolean(folderFields.matchReason),
          missingFromProvider: Boolean(folderFields.missingFromProvider),
        },
      },
      configDiagnostics: {
        google: {
          hasClientId: Boolean(env.GOOGLE_CLIENT_ID),
          hasClientSecret: Boolean(env.GOOGLE_CLIENT_SECRET),
          hasAuthRedirectUri: Boolean(env.GOOGLE_AUTH_REDIRECT_URI),
          hasInboxRedirectUri: Boolean(env.GOOGLE_INBOX_REDIRECT_URI)
        },
        outlook: {
          hasClientId: Boolean(env.OUTLOOK_CLIENT_ID),
          hasClientSecret: Boolean(env.OUTLOOK_CLIENT_SECRET),
          hasRedirectUri: Boolean(env.OUTLOOK_REDIRECT_URI),
          hasTenantId: Boolean(env.OUTLOOK_TENANT_ID)
        },
        queues: {
          redisConfigured: Boolean(env.REDIS_URL),
          attachmentIngestQueueAvailable: Boolean(
            app.services.attachmentIngestQueue
          ),
          attachmentIngestQueueName:
            app.services.attachmentIngestQueue?.name ?? null,
        },
        app: {
          nodeEnv: env.NODE_ENV,
          hasFrontendUrl: Boolean(env.FRONTEND_URL),
          frontendUrl: env.FRONTEND_URL,
          hasSessionSecret: env.SESSION_COOKIE_SECRET !== "development-session-secret-change-me",
          hasTokenEncryption: env.TOKEN_ENCRYPTION_SECRET !== "development-token-encryption-secret"
        }
      }
    };
  });
};
