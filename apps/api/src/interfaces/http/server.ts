import cookie from "@fastify/cookie";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { OpenAIInboxClassifier, createOpenAIClient } from "@forgeops/ai";
import { prisma } from "@forgeops/db";
import {
  ProviderRegistry,
  QueueNames,
  TokenCipher,
  NATIVE_INBOX_SYNC_INTERVAL_MS,
  scheduledInboxSyncJobId,
  shouldScheduleNativeInboxSync,
  type AttachmentIngestJobPayload,
  type AttachmentIngestResult,
  type InboxAnalysisJobPayload,
  type InboxAnalysisResult,
  type InboxSyncJobPayload,
  type InboxSyncResult,
  type MailboxClassifyJobPayload,
  type MailboxClassifyJobResult,
  type MailboxHistoricalImportJobPayload,
  type MailboxHistoricalImportJobResult,
  type ProjectFolderEmailAnalyzeJobPayload,
  type ProjectFolderEmailAnalyzeJobResult,
  type MailboxReclassifyJobPayload,
  type MailboxReclassifyJobResult,
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
import { registerMailboxControlRoutes } from "./routes/mailbox-control.route.js";
import { registerInboxReadRoutes } from "./routes/inbox-read.route.js";
import { registerReviewActionRoutes } from "./routes/review-action.route.js";
import { registerClassificationAuditRoutes } from "./routes/classification-audit.route.js";
import { registerAllowlistRoutes } from "./routes/allowlist.route.js";
import { registerInboxActionsRoutes } from "./routes/inbox-actions.route.js";
import { registerImportRoutes } from "./routes/import.route.js";
import { registerAiImportRoutes } from "./routes/ai-import.route.js";
import { registerSendRoutes } from "./routes/send.route.js";
import { registerEmailContactRoutes } from "./routes/email-contacts.route.js";
import { registerAttachmentRoutes } from "./routes/attachment.route.js";
import { registerWebhookRoutes } from "./routes/webhook.route.js";
import { registerN8nIngestRoutes } from "./routes/n8n-ingest.route.js";
import { registerPlatformAdminRoutes } from "./routes/platform-admin.route.js";
import { registerReferenceDataRoutes } from "./routes/reference-data.route.js";
import { registerDocumentImportRoutes } from "./routes/document-import.route.js";
import { registerClassificationEngineRoutes } from "./routes/classification-engine.route.js";
import { registerRetryClassificationRoutes } from "./routes/retry-classification.route.js";
import { registerMailboxReclassifyRoutes } from "./routes/mailbox-reclassify.route.js";
import { registerFolderDiscoveryRoutes } from "./routes/folder-discovery.route.js";
import { registerSenderEvidenceRoutes } from "./routes/sender-evidence.route.js";
import { registerEmailAttachmentRoutes } from "./routes/email-attachment.route.js";
import { registerTestDataAdminRoutes } from "./routes/test-data-admin.route.js";
import { registerJobsRoutes } from "./routes/jobs.route.js";
import { registerTaskBulkRoutes } from "./routes/task-bulk.route.js";
import { registerJobFilesRoutes } from "./routes/job-files.route.js";
import { registerWorkspacePreferencesRoutes } from "./routes/workspace-preferences.route.js";
import { registerDocumentLibraryRoutes } from "./routes/document-library.route.js";
import { registerCalendarRoutes } from "./routes/calendar.route.js";
import { registerJobImportRoutes } from "./routes/job-import.route.js";
import { registerDashboardRoutes } from "./routes/dashboard.route.js";
import { S3AttachmentStorage } from "../../infrastructure/storage/attachment-storage.js";

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

  await app.register(compress);

  await app.register(cookie, {
    secret: env.SESSION_COOKIE_SECRET
  });

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true
  });

  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 10 }
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
  const attachmentIngestQueue = new Queue<
    AttachmentIngestJobPayload,
    AttachmentIngestResult
  >(QueueNames.ATTACHMENT_INGEST, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  const mailboxHistoricalImportQueue = new Queue<
    MailboxHistoricalImportJobPayload,
    MailboxHistoricalImportJobResult
  >(QueueNames.MAILBOX_HISTORICAL_IMPORT, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  const mailboxClassifyQueue = new Queue<
    MailboxClassifyJobPayload,
    MailboxClassifyJobResult
  >(QueueNames.MAILBOX_CLASSIFY, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  const projectFolderEmailAnalyzeQueue = new Queue<
    ProjectFolderEmailAnalyzeJobPayload,
    ProjectFolderEmailAnalyzeJobResult
  >(QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  const mailboxReclassifyQueue = new Queue<
    MailboxReclassifyJobPayload,
    MailboxReclassifyJobResult
  >(QueueNames.MAILBOX_RECLASSIFY, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  if (attachmentIngestQueue.name !== QueueNames.ATTACHMENT_INGEST) {
    throw new Error(
      `ATTACHMENT_INGEST queue name mismatch: expected ${QueueNames.ATTACHMENT_INGEST}, got ${attachmentIngestQueue.name}`
    );
  }
  const inboxSyncQueueEvents = new QueueEvents(QueueNames.INBOX_SYNC, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  const inboxAnalysisQueueEvents = new QueueEvents(QueueNames.INBOX_ANALYSIS, {
    connection: createBullMqConnection(env.REDIS_URL)
  });
  await inboxSyncQueueEvents.waitUntilReady();
  await inboxAnalysisQueueEvents.waitUntilReady();
  await attachmentIngestQueue.waitUntilReady();

  app.log.info({
    event: "queues_initialized",
    redisConfigured: Boolean(env.REDIS_URL),
    attachmentIngestQueueAvailable: true,
    attachmentIngestQueueName: attachmentIngestQueue.name,
    inboxSyncQueueName: inboxSyncQueue.name,
    inboxAnalysisQueueName: inboxAnalysisQueue.name,
  });

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
  const attachmentStorage = new S3AttachmentStorage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT,
  });

  const removeScheduledSync = async (connectionId: string): Promise<void> => {
    const jobId = scheduledInboxSyncJobId(connectionId);
    const legacyJobId = `scheduled-sync:${connectionId}`;
    try {
      await inboxSyncQueue.removeRepeatableByKey(
        `${QueueNames.INBOX_SYNC}:${jobId}:::${NATIVE_INBOX_SYNC_INTERVAL_MS}`
      );
    } catch {
      /* fall through */
    }
    try {
      await inboxSyncQueue.removeRepeatableByKey(
        `${QueueNames.INBOX_SYNC}:${legacyJobId}:::${NATIVE_INBOX_SYNC_INTERVAL_MS}`
      );
    } catch {
      /* fall through */
    }
    const jobs = await inboxSyncQueue.getRepeatableJobs();
    const match = jobs.find(
      (j) =>
        j.id === jobId ||
        j.id === legacyJobId ||
        j.key?.includes(connectionId)
    );
    if (match) {
      await inboxSyncQueue.removeRepeatableByKey(match.key);
    }
  };

  const registerScheduledSync = async (workspaceId: string, connectionId: string): Promise<void> => {
    const connection = await prisma.inboxConnection.findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        status: true,
        ingestionSource: true,
        nativeListeningEnabled: true,
      },
    });

    if (!connection || !shouldScheduleNativeInboxSync(connection)) {
      // Ensure stale schedules are cleared if OAuth reconnects without listener ON
      await removeScheduledSync(connectionId);
      console.info("native-sync-schedule-skipped", {
        workspaceId,
        inboxConnectionId: connectionId,
        reason: "listener_or_mode_gate",
        ingestionSource: connection?.ingestionSource ?? null,
        nativeListeningEnabled: connection?.nativeListeningEnabled ?? null,
        status: connection?.status ?? null,
      });
      return;
    }

    const jobId = scheduledInboxSyncJobId(connectionId);
    await inboxSyncQueue.add(
      QueueNames.INBOX_SYNC,
      { workspaceId, inboxConnectionId: connectionId },
      {
        jobId,
        repeat: { every: NATIVE_INBOX_SYNC_INTERVAL_MS },
        attempts: 2,
        backoff: { type: "exponential", delay: 10000 },
        removeOnComplete: { count: 5 },
        removeOnFail: { count: 10 }
      }
    );
  };

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
      attachmentIngestQueue,
      mailboxHistoricalImportQueue,
      mailboxClassifyQueue,
      projectFolderEmailAnalyzeQueue,
      mailboxReclassifyQueue,
      googleOAuthService,
    providerRegistry,
    sessionStore,
    oauthStateStore,
    tokenCipher,
    auditEventLogger,
    attachmentStorage,
    registerScheduledSync,
    removeScheduledSync
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
  await registerMailboxControlRoutes(app);
  await registerInboxReadRoutes(app);
  await registerHealthRoute(app);
  await registerGmailRoutes(app);
  await registerReviewActionRoutes(app);
  await registerClassificationAuditRoutes(app);
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
  await registerEmailContactRoutes(app);
  await registerAttachmentRoutes(app);
  await registerWebhookRoutes(app);
  await registerN8nIngestRoutes(app);
  await registerPlatformAdminRoutes(app);
  await registerReferenceDataRoutes(app);
  await registerDocumentImportRoutes(app);
  await registerDocumentLibraryRoutes(app);
  await registerClassificationEngineRoutes(app);
  await registerRetryClassificationRoutes(app);
  await registerMailboxReclassifyRoutes(app);
  await registerFolderDiscoveryRoutes(app);
  await registerSenderEvidenceRoutes(app);
  await registerEmailAttachmentRoutes(app);
  await registerTestDataAdminRoutes(app);
  await registerJobsRoutes(app);
  await registerTaskBulkRoutes(app);
  await registerJobFilesRoutes(app);
  await registerWorkspacePreferencesRoutes(app);
  await registerCalendarRoutes(app);
  await registerJobImportRoutes(app);
  await registerDashboardRoutes(app);

  const PUSH_RENEWAL_INTERVAL_MS = 60 * 60 * 1000;
  let pushRenewalTimer: ReturnType<typeof setInterval> | null = null;

  const renewExpiringPushSubscriptions = async (): Promise<void> => {
    try {
      const soonExpiring = await prisma.inboxConnection.findMany({
        where: {
          status: "ACTIVE",
          pushExpiresAt: { not: null, lt: new Date(Date.now() + 12 * 60 * 60 * 1000) }
        },
        select: { id: true, provider: true, email: true }
      });

      for (const conn of soonExpiring) {
        try {
          const internalRes = await app.inject({
            method: "POST",
            url: `/api/v1/webhooks/register-push/${conn.id}`
          });
          app.log.info({
            event: "push_renewal",
            connectionId: conn.id,
            provider: conn.provider,
            status: internalRes.statusCode
          });
        } catch (e) {
          app.log.warn({
            event: "push_renewal_failed",
            connectionId: conn.id,
            error: e instanceof Error ? e.message : "unknown"
          });
        }
      }
    } catch (e) {
      app.log.error({ event: "push_renewal_scan_failed", error: e instanceof Error ? e.message : "unknown" });
    }
  };

  app.addHook("onReady", async () => {
    pushRenewalTimer = setInterval(() => {
      void renewExpiringPushSubscriptions();
    }, PUSH_RENEWAL_INTERVAL_MS);

    setTimeout(() => void renewExpiringPushSubscriptions(), 30_000);
  });

  app.addHook("onClose", async () => {
    if (pushRenewalTimer) clearInterval(pushRenewalTimer);
    await inboxAnalysisQueueEvents.close();
    await inboxAnalysisQueue.close();
    await inboxSyncQueueEvents.close();
    await inboxSyncQueue.close();
    await mailboxHistoricalImportQueue.close();
    await mailboxClassifyQueue.close();
    await projectFolderEmailAnalyzeQueue.close();
    await mailboxReclassifyQueue.close();
    await attachmentIngestQueue.close();
    await redis.quit();
    await prisma.$disconnect();
  });

  return app;
};
