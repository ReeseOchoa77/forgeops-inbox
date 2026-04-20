import type { FastifyInstance } from "fastify";

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
