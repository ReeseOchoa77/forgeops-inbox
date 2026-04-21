import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { OpenAIInboxClassifier, createOpenAIClient } from "@forgeops/ai";
import { prisma } from "@forgeops/db";
import {
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type InboxSyncJobPayload,
  type InboxSyncResult
} from "@forgeops/shared";
import Fastify from "fastify";
import { Queue, QueueEvents } from "bullmq";
import { ZodError } from "zod";

import { AuditEventLogger } from "../../application/services/audit-event-logger.js";
import { RequestInboxSyncUseCase } from "../../application/use-cases/request-inbox-sync.js";
import { loadApiEnv } from "../../config/env.js";
import { GoogleOAuthService } from "../../infrastructure/google/google-oauth-service.js";
import { GmailOAuthProvider } from "../../infrastructure/providers/gmail/gmail-provider.js";
import { OutlookOAuthProvider } from "../../infrastructure/providers/outlook/outlook-provider.js";
import { inboxAnalysisJobOptions } from "../../infrastructure/queues/bullmq-inbox-analysis-dispatcher.js";
import { BullMQInboxSyncDispatcher } from "../../infrastructure/queues/bullmq-inbox-sync-dispatcher.js";
import {
  createBullMqConnection,
  createRedisConnection
} from "../../infrastructure/redis/connection.js";
import { GoogleOAuthStateStore } from "../../infrastructure/session/google-oauth-state-store.js";
import { RedisSessionStore } from "../../infrastructure/session/redis-session-store.js";
import { registerAuthRoutes } from "./routes/auth.route.js";
import { registerDevRoutes } from "./routes/dev.route.js";
import { registerGmailRoutes } from "./routes/gmail.route.js";
import { registerHealthRoute } from "./routes/health.route.js";
import { registerInboxConnectionRoutes } from "./routes/inbox-connection.route.js";
import { registerInboxReadRoutes } from "./routes/inbox-read.route.js";
import { registerReviewActionRoutes } from "./routes/review-action.route.js";
import { registerAllowlistRoutes } from "./routes/allowlist.route.js";
import { registerInboxActionsRoutes } from "./routes/inbox-actions.route.js";
import { registerImportRoutes } from "./routes/import.route.js";
import { registerAiImportRoutes } from "./routes/ai-import.route.js";
import { registerSendRoutes } from "./routes/send.route.js";

export const buildServer = async () => {
  const env = loadApiEnv();
  const app = Fastify({
    logger: true,
    trustProxy: env.NODE_ENV === "production",
    bodyLimit: 10_485_760
  });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : String(body);
    if (!text || text.trim().length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  await app.register(cookie, {
    secret: env.SESSION_COOKIE_SECRET
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true
  });

  const redis = createRedisConnection(env.REDIS_URL);
  const inboxSyncQueue = new Queue<InboxSyncJobPayload, InboxSyncResult>(
    QueueNames.INBOX_SYNC,
    {
      connection: createBullMqConnection(env.REDIS_URL)
    }
  );
  const inboxAnalysisQueue = new Queue<
    InboxAnalysisJobPayload,
    InboxAnalysisResult
  >(QueueNames.INBOX_ANALYSIS, {
    connection: createBullMqConnection(env.REDIS_URL),
    defaultJobOptions: inboxAnalysisJobOptions
  });
  const inboxSyncQueueEvents = new QueueEvents(QueueNames.INBOX_SYNC, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  const inboxAnalysisQueueEvents = new QueueEvents(QueueNames.INBOX_ANALYSIS, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  await inboxSyncQueueEvents.waitUntilReady();
  await inboxAnalysisQueueEvents.waitUntilReady();

  const requestInboxSync = new RequestInboxSyncUseCase(
    new BullMQInboxSyncDispatcher(inboxSyncQueue)
  );

  const aiClassifier = new OpenAIInboxClassifier(
    createOpenAIClient({
      ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {})
    }),
    env.OPENAI_MODEL
  );

  const googleOAuthConfig = {
    ...(env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : {}),
    ...(env.GOOGLE_CLIENT_SECRET
      ? { clientSecret: env.GOOGLE_CLIENT_SECRET }
      : {}),
    ...(env.GOOGLE_AUTH_REDIRECT_URI
      ? { authRedirectUri: env.GOOGLE_AUTH_REDIRECT_URI }
      : {}),
    ...(env.GOOGLE_INBOX_REDIRECT_URI
      ? { inboxRedirectUri: env.GOOGLE_INBOX_REDIRECT_URI }
      : {})
  };

  const googleOAuthService = new GoogleOAuthService(googleOAuthConfig);

  const providerRegistry = new ProviderRegistry();
  providerRegistry.registerOAuthProvider(new GmailOAuthProvider(googleOAuthConfig));
  providerRegistry.registerOAuthProvider(
    new OutlookOAuthProvider({
      ...(env.OUTLOOK_CLIENT_ID ? { clientId: env.OUTLOOK_CLIENT_ID } : {}),
      ...(env.OUTLOOK_CLIENT_SECRET
        ? { clientSecret: env.OUTLOOK_CLIENT_SECRET }
        : {}),
      ...(env.OUTLOOK_REDIRECT_URI
        ? { redirectUri: env.OUTLOOK_REDIRECT_URI }
        : {}),
      tenantId: env.OUTLOOK_TENANT_ID
    })
  );

  const sessionStore = new RedisSessionStore(redis, {
    ttlSeconds: env.SESSION_TTL_SECONDS
  });

  const oauthStateStore = new GoogleOAuthStateStore(redis, {
    ttlSeconds: env.INBOX_OAUTH_STATE_TTL_SECONDS
  });

  const tokenCipher = new TokenCipher(env.TOKEN_ENCRYPTION_SECRET);
  const auditEventLogger = new AuditEventLogger(prisma);

  app.decorate("services", {
    env,
    prisma,
    redis,
    requestInboxSync,
    aiClassifier,
    inboxSyncQueue,
    inboxSyncQueueEvents,
    inboxAnalysisQueue,
    inboxAnalysisQueueEvents,
    googleOAuthService,
    providerRegistry,
    sessionStore,
    oauthStateStore,
    tokenCipher,
    auditEventLogger
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: "Invalid request payload",
        issues: error.issues
      });
    }

    app.log.error(error);

    return reply.status(500).send({
      message: "Unexpected server error"
    });
  });

  await registerAuthRoutes(app);
  await registerDevRoutes(app);
  await registerInboxConnectionRoutes(app);
  await registerInboxReadRoutes(app);
  await registerHealthRoute(app);
  await registerGmailRoutes(app);
  await registerReviewActionRoutes(app);
  await registerAllowlistRoutes(app);
  await registerInboxActionsRoutes(app);
  await registerImportRoutes(app);

  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_req, body, done) => {
    done(null, body);
  });

  await registerAiImportRoutes(app);
  await registerSendRoutes(app);

  app.addHook("onClose", async () => {
    await inboxAnalysisQueueEvents.close();
    await inboxAnalysisQueue.close();
    await inboxSyncQueueEvents.close();
    await inboxSyncQueue.close();
    await redis.quit();
    await prisma.$disconnect();
  });

  return app;
};
