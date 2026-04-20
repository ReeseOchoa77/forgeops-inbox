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
      }
    };
  });
};
