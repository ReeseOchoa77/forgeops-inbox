import type { PrismaClient } from "@prisma/client";
import type { OpenAIInboxClassifier } from "@forgeops/ai";
import type {
  AttachmentIngestJobPayload,
  AttachmentIngestResult,
  ProviderRegistry,
  TokenCipher,
} from "@forgeops/shared";
import type { Queue, QueueEvents } from "bullmq";
import type { Redis } from "ioredis";

import type { AuditEventLogger } from "../../application/services/audit-event-logger.js";
import type { RequestInboxSyncUseCase } from "../../application/use-cases/request-inbox-sync.js";
import type { ApiEnv } from "../../config/env.js";
import type { GoogleOAuthService } from "../../infrastructure/google/google-oauth-service.js";
import type { GoogleOAuthStateStore } from "../../infrastructure/session/google-oauth-state-store.js";
import type { RedisSessionStore } from "../../infrastructure/session/redis-session-store.js";
import type { AttachmentStorage } from "../../infrastructure/storage/attachment-storage.js";

declare module "fastify" {
  interface FastifyInstance {
    services: {
      env: ApiEnv;
      prisma: PrismaClient;
      redis: Redis;
      requestInboxSync: RequestInboxSyncUseCase;
      aiClassifier: OpenAIInboxClassifier;
      inboxSyncQueue: Queue;
      inboxSyncQueueEvents: QueueEvents;
      inboxAnalysisQueue: Queue;
      inboxAnalysisQueueEvents: QueueEvents;
      attachmentIngestQueue: Queue<AttachmentIngestJobPayload, AttachmentIngestResult>;
      googleOAuthService: GoogleOAuthService;
      providerRegistry: ProviderRegistry;
      sessionStore: RedisSessionStore;
      oauthStateStore: GoogleOAuthStateStore;
      tokenCipher: TokenCipher;
      auditEventLogger: AuditEventLogger;
      attachmentStorage: AttachmentStorage;
      registerScheduledSync: (workspaceId: string, connectionId: string) => Promise<void>;
      removeScheduledSync: (connectionId: string) => Promise<void>;
    };
  }
}
