# File Structure and Project Scope

## File Structure

```text
forgeops-inbox/
├── .env                                         Root environment variables (DB, Redis, Google, Outlook, encryption)
├── .env.example                                 Template for .env with all required variable names
├── .gitignore                                   Excludes node_modules, dist, .env, coverage, logs
├── README.md                                    Onboarding guide, endpoint list, OAuth testing walkthrough
├── docker-compose.yml                           Postgres 16 + Redis 7 with healthchecks and named volumes
├── package.json                                 Monorepo root: npm workspaces, build/typecheck/dev scripts
├── tsconfig.base.json                           Shared TS config: ES2022, NodeNext, strict, path aliases
├── tsconfig.projects.json                       Solution-style project references across all packages
│
├── docs/
│   ├── architecture.md                          Provider abstraction model, async flow, DB notes, Outlook guide
│   ├── product-spec.md                          Product vision: unified inbox, classification, task extraction
│   ├── project-rules.md                         Non-negotiable backend rules: tenant isolation, no outbound email
│   └── file-structure.md                        This file
│
├── packages/
│   ├── shared/                                  Cross-package types and utilities
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                         Barrel export for all shared modules
│   │       ├── constants/
│   │       │   └── queues.ts                    Queue name constants: inbox-sync, inbox-analysis, ai-extraction
│   │       ├── providers/
│   │       │   └── provider-registry.ts         ProviderRegistry class: typed maps for OAuth + sync providers
│   │       ├── security/
│   │       │   └── token-cipher.ts              AES-256-GCM encrypt/decrypt for OAuth tokens at rest
│   │       └── types/
│   │           ├── inbox.ts                     EmailCategory, PriorityLevel, ExtractedTask, EmailExtraction
│   │           ├── jobs.ts                      InboxSyncJobPayload, InboxSyncResult, InboxAnalysisJobPayload
│   │           ├── provider.ts                  InboxOAuthProvider, InboxSyncProvider, canonical snapshot types
│   │           └── tenant.ts                    TenantContext interface
│   │
│   ├── db/                                      Prisma schema and shared database client
│   │   ├── .env / .env.example                  DATABASE_URL and DIRECT_URL for Prisma
│   │   ├── package.json                         Prisma generate/migrate/studio scripts
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── client.ts                        Singleton PrismaClient with dev logging
│   │   │   └── index.ts                         Re-exports client
│   │   └── prisma/
│   │       ├── schema.prisma                    Full data model: 13 models, 8 enums, workspace-scoped relations
│   │       └── migrations/
│   │           ├── migration_lock.toml
│   │           ├── 20260323214212_init/          Base schema: workspaces, users, connections, threads, messages
│   │           ├── 20260324043316_gmail_ingestion/  historyId, labelIds, attachmentMetadata on messages
│   │           ├── 20260324220729_inbox_analysis_pipeline/  NormalizedEmail, task fields, unique constraints
│   │           ├── 20260418000000_add_outlook_provider/  OUTLOOK added to InboxProvider enum
│   │           └── 20260418010000_add_provider_neutral_id_columns/  providerThreadId, providerMessageId columns
│   │
│   └── ai/                                      OpenAI integration boundary
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                         Barrel export
│           ├── openai/
│           │   ├── openai-client.ts             createOpenAIClient factory (returns null if no API key)
│           │   └── inbox-classifier.ts          OpenAIInboxClassifier: placeholder extraction (API not wired)
│           └── prompts/
│               └── inbox-classification.prompt.ts  System prompt template for future LLM classification
│
├── apps/
│   ├── api/                                     Fastify HTTP API
│   │   ├── .env / .env.example                  API-specific overrides (port, Google, Outlook, session)
│   │   ├── package.json                         Fastify, BullMQ, googleapis, ioredis, zod
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts                          Entrypoint: builds server, listens on HOST:API_PORT
│   │       ├── config/
│   │       │   └── env.ts                       Zod-validated env schema with provider-neutral aliases
│   │       ├── domain/
│   │       │   ├── auth/
│   │       │   │   └── auth-session.ts          Zod schema for Redis session payload (userId, email)
│   │       │   ├── google/
│   │       │   │   └── oauth-state.ts           OAuth state schema: app-auth vs inbox-connect with provider field
│   │       │   └── services/
│   │       │       └── inbox-sync-dispatcher.ts Interface for enqueueing sync jobs
│   │       ├── application/
│   │       │   ├── use-cases/
│   │       │   │   └── request-inbox-sync.ts    Thin use case: dispatches sync command to queue
│   │       │   └── services/
│   │       │       ├── workspace-access.ts      requireWorkspaceMembership, listUserMemberships
│   │       │       ├── dev-workspace-provisioner.ts  Auto-create workspace on first login (dev mode)
│   │       │       └── audit-event-logger.ts    Persists AuditEvent with request IP/UA/metadata
│   │       ├── infrastructure/
│   │       │   ├── google/
│   │       │   │   └── google-oauth-service.ts  Google OAuth for app login: auth URL, code exchange, profile
│   │       │   ├── providers/
│   │       │   │   ├── gmail/
│   │       │   │   │   └── gmail-provider.ts    GmailOAuthProvider: implements InboxOAuthProvider via GoogleOAuthService
│   │       │   │   └── outlook/
│   │       │   │       └── outlook-provider.ts  OutlookOAuthProvider: Azure AD OAuth, Graph /me profile
│   │       │   ├── queues/
│   │       │   │   ├── bullmq-inbox-sync-dispatcher.ts   BullMQ job dispatch for inbox-sync queue
│   │       │   │   └── bullmq-inbox-analysis-dispatcher.ts  Job options for inbox-analysis queue
│   │       │   ├── redis/
│   │       │   │   └── connection.ts            ioredis client + BullMQ connection factory
│   │       │   └── session/
│   │       │       ├── redis-session-store.ts   Session CRUD in Redis with TTL
│   │       │       └── google-oauth-state-store.ts  One-time OAuth state create/consume in Redis
│   │       └── interfaces/
│   │           └── http/
│   │               ├── server.ts                Registers plugins, constructs all services, wires routes
│   │               ├── authentication.ts        Signed cookie read/write/clear for session ID
│   │               ├── fastify.d.ts             Augments FastifyInstance.services with all injected deps
│   │               └── routes/
│   │                   ├── auth.route.ts         Google sign-in start/callback, session, logout
│   │                   ├── dev.route.ts          POST dev workspace bootstrap (dev mode only)
│   │                   ├── inbox-connection.route.ts  Gmail + Outlook start, callback, reconnect, disconnect
│   │                   ├── gmail.route.ts        Gmail config, POST sync, dev sync/analyze with wait
│   │                   ├── health.route.ts       /health with DB, Redis, provider, OpenAI checks
│   │                   └── inbox-read.route.ts   Connections, messages, review queue, tasks (paginated)
│   │
│   └── worker/                                  BullMQ background job processor
│       ├── .env / .env.example                  Worker-specific overrides (concurrency, Google, Outlook)
│       ├── package.json                         BullMQ, googleapis, ioredis, zod
│       ├── tsconfig.json
│       └── src/
│           ├── main.ts                          Entrypoint: starts sync + analysis workers, graceful shutdown
│           ├── config/
│           │   └── env.ts                       Zod-validated worker env with provider-neutral aliases
│           ├── domain/
│           │   ├── inbox-sync-context.ts         InboxSyncContext: job payload + jobId
│           │   └── inbox-analysis-context.ts     InboxAnalysisContext: job payload + jobId
│           ├── jobs/
│           │   ├── inbox-sync.worker.ts          BullMQ worker: creates provider registry, routes to processor
│           │   └── inbox-analysis.worker.ts      BullMQ worker: creates processor, routes analysis jobs
│           ├── application/
│           │   ├── processors/
│           │   │   ├── inbox-sync.processor.ts   Resolves provider from DB, decrypts tokens, syncs, imports
│           │   │   └── inbox-analysis.processor.ts  Runs analysis pipeline with audit logging
│           │   └── services/
│           │       ├── import-provider-mailbox.ts  Provider-neutral import: canonical types → DB rows (dual-write)
│           │       ├── import-gmail-mailbox.ts     Legacy Gmail-specific import (dead code, kept for reference)
│           │       ├── analyze-inbox-connection.ts  Orchestrates normalize → classify → extract per message
│           │       ├── normalize-email-message.ts   Cleans body, extracts participants, builds label/category hints
│           │       ├── classify-normalized-email.ts  Heuristic keyword/score classification into 7 categories
│           │       ├── extract-task-candidate.ts     Heuristic task title/assignee/due date extraction
│           │       └── email-analysis.schemas.ts     Zod schemas for NormalizedEmail, ClassifiedEmail, TaskCandidate
│           └── infrastructure/
│               ├── gmail/
│               │   └── gmail-client.ts           Gmail API: threads.list, history.list (incremental), full thread fetch
│               ├── providers/
│               │   ├── gmail/
│               │   │   ├── gmail-client.ts       Re-export of ../../gmail/gmail-client.ts
│               │   │   └── gmail-provider.ts     GmailSyncProvider: implements InboxSyncProvider, maps to canonical
│               │   └── outlook/
│               │       ├── outlook-client.ts     Graph API: inbox delta sync, token refresh, attachment metadata
│               │       └── outlook-provider.ts   OutlookSyncProvider: implements InboxSyncProvider, maps to canonical
│               └── redis/
│                   └── connection.ts             ioredis + BullMQ connection factory (same as API)
```

---

## Project Scope — Current Position

### What This System Is

ForgeOps Inbox is a **multi-tenant backend engine** for ingesting email from connected inboxes, normalizing the content, classifying it by type, and extracting actionable tasks. It is designed as the data layer and processing pipeline behind a future inbox operations dashboard.

There is **no frontend**. The system exposes a Fastify REST API and processes work asynchronously via BullMQ workers backed by Redis and PostgreSQL.

---

### What Is Fully Implemented and Working

#### Multi-Provider Inbox Architecture

The system supports **two inbox providers** through a split-interface abstraction:

- **Gmail** — OAuth connection via Google, mailbox sync via Gmail API (`threads.list` for initial sync, `history.list` for incremental sync), full thread/message parsing, attachment metadata extraction.
- **Outlook** — OAuth connection via Azure AD, mailbox sync via Microsoft Graph (`/mailFolders/inbox/messages/delta` for inbox-scoped delta sync), conversation grouping, attachment metadata via Graph, token rotation handling, throttle retry (429 with `Retry-After`).

Both providers map their native data into **canonical types** (`ProviderThreadSnapshot`, `ProviderMessageSnapshot`) before reaching the application layer. The sync processor, import pipeline, and analysis pipeline are completely provider-agnostic.

| Capability | Gmail | Outlook |
|-----------|-------|---------|
| OAuth connect/reconnect/disconnect | Yes | Yes |
| Initial full sync | Yes (100 inbox threads) | Yes (100 inbox messages, delta endpoint) |
| Incremental sync via cursor | Yes (history API + startHistoryId) | Yes (delta link, inbox-scoped) |
| Expired cursor fallback to full sync | Yes (404 detection) | Yes (410/404 detection) |
| Token refresh | Yes (googleapis handles implicitly) | Yes (explicit refresh + rotation detection) |
| Auth error detection (REQUIRES_REAUTH) | Yes (Google error patterns) | Yes (Microsoft AADSTS patterns) |
| Attachment metadata | Yes (MIME part traversal) | Yes (Graph attachments endpoint) |
| API throttle handling | No (not needed for googleapis) | Yes (429 retry with Retry-After) |

#### Identity and Tenancy

- Google OAuth sign-in for platform login (separate from inbox providers)
- Redis-backed sessions via signed HTTP-only cookies
- Multi-tenant workspace model with role-based memberships (OWNER, ADMIN, MANAGER, MEMBER, VIEWER)
- Dev auto-provisioning: workspace created on first login when enabled
- Manual workspace bootstrap via dev route
- Strict workspace isolation enforced on all inbox-domain queries

#### Email Processing Pipeline

Every synced message flows through a three-stage analysis pipeline:

1. **Normalization** (`normalize-email-message.ts`) — strips quoted replies, marketing footers, collapses whitespace, extracts sender/recipients, builds label hints and category hints from provider labels.

2. **Classification** (`classify-normalized-email.ts`) — heuristic keyword/score classifier into 7 categories: ACTIONABLE_REQUEST, FYI_UPDATE, SALES_MARKETING, SUPPORT_CUSTOMER_ISSUE, RECRUITING_HIRING, INTERNAL_COORDINATION, NEEDS_REVIEW. Produces priority, confidence score, and review flags.

3. **Task Extraction** (`extract-task-candidate.ts`) — detects action requests, infers task title from subject, guesses assignee from workspace members, parses explicit due dates (ISO, US, month-name, "tomorrow", "by EOD"). Produces task candidates with confidence and review flags.

Low-confidence items are flagged with `requiresReview = true` and routed to review queues.

#### Persistence Model

13 Prisma models across the workspace-scoped schema:

| Model | Purpose |
|-------|---------|
| Workspace | Tenant boundary |
| User | Platform user with Google subject |
| Membership | User-to-workspace with roles |
| InboxConnection | OAuth connection per provider (Gmail/Outlook) with encrypted tokens |
| EmailThread | Provider conversation/thread with metadata |
| EmailMessage | Individual message with full content |
| NormalizedEmail | Cleaned canonical form per message |
| Classification | Category, priority, confidence, review state per message |
| Task | Extracted task candidate linked to source message and thread |
| RoutingRule | Configurable rule engine (schema exists, logic not implemented) |
| WorkspaceSetting | Per-workspace thresholds and defaults |
| AuditEvent | Durable audit trail for all critical actions |

Provider-neutral columns (`providerThreadId`, `providerMessageId`) are dual-written alongside the legacy `gmailThreadId`/`gmailMessageId` columns.

#### API Surface

**App Authentication:**
- `GET /api/v1/auth/google/start` — initiate Google sign-in
- `GET /api/v1/auth/google/callback` — handle Google OAuth callback
- `GET /api/v1/auth/session` — get current session and memberships
- `POST /api/v1/auth/logout` — destroy session

**Inbox Connections (provider-specific start, provider-neutral callback):**
- `POST /api/v1/workspaces/:id/inbox-connections/google/start` — start Gmail connection
- `POST /api/v1/workspaces/:id/inbox-connections/outlook/start` — start Outlook connection
- `GET /api/v1/inbox-connections/google/callback` — handle OAuth callback (resolves provider from state)
- `POST /api/v1/workspaces/:id/inbox-connections/:id/reconnect` — reconnect any provider
- `DELETE /api/v1/workspaces/:id/inbox-connections/:id` — disconnect any provider

**Sync and Analysis:**
- `POST /api/v1/integrations/gmail/sync` — queue sync job
- `GET /api/v1/integrations/gmail/config` — Gmail provider configuration status

**Read Endpoints (provider-agnostic):**
- `GET /api/v1/workspaces/:id/inbox-connections` — list all connections
- `GET /api/v1/workspaces/:id/inbox-connections/:id` — connection detail with counts
- `GET /api/v1/workspaces/:id/inbox-connections/:id/messages` — paginated messages with filters
- `GET /api/v1/workspaces/:id/inbox-connections/:id/messages/:messageId` — full message detail
- `GET /api/v1/workspaces/:id/inbox-connections/:id/review` — review queue
- `GET /api/v1/workspaces/:id/inbox-connections/:id/tasks` — extracted tasks

**Dev/Debug (dev mode only):**
- `POST /api/v1/dev/bootstrap/workspace` — create workspace manually
- `GET /api/v1/dev/workspaces/:id/inbox-connections/google/start` — browser-friendly Gmail connect
- `GET /api/v1/dev/workspaces/:id/inbox-connections/outlook/start` — browser-friendly Outlook connect
- `GET /api/v1/dev/workspaces/:id/inbox-connections/:id/sync` — sync with optional wait
- `GET /api/v1/dev/workspaces/:id/inbox-connections/:id/analyze` — analyze with optional wait

**Health:**
- `GET /api/v1/health` — DB, Redis, provider, OpenAI status

#### Security

- OAuth tokens (access + refresh) encrypted at rest via AES-256-GCM (`TokenCipher`)
- Signed session cookies with configurable TTL
- One-time OAuth state tokens consumed on use
- Workspace-scoped authorization on all inbox operations
- No tokens or sync metadata exposed to clients
- Provider-neutral encryption secret (`TOKEN_ENCRYPTION_SECRET`) with legacy fallback

#### Observability

- Structured audit events persisted to `AuditEvent` table for all critical actions
- Console logging of sync lifecycle (start, succeed, fail) with provider and cursor metadata
- Health endpoint reports per-provider configuration status
- Sync failure classification logged with error pattern and resulting connection status

---

### What Is Intentionally Placeholder

| Area | Status |
|------|--------|
| OpenAI classification | `OpenAIInboxClassifier` exists but returns placeholder data; system prompt defined but API not wired |
| Gmail watch/push | Sync is poll-based; `users.watch` not implemented |
| Outlook webhook notifications | No change notifications; delta sync is poll-based |
| Attachment content download | Only metadata is fetched; binary content not downloaded |
| Gmail send | Scope is requested; sending not implemented |
| Routing rules engine | Schema exists (`RoutingRule`); matching/execution logic not built |
| Workspace settings application | `WorkspaceSetting` read in analysis; no CRUD routes |
| Full workspace CRUD | Only dev bootstrap; no rename/delete/invite |
| CSRF protection | Not implemented |
| Rate limiting | Not implemented at API level |
| Test suites | No unit or integration tests |
| Frontend | No UI exists |

---

### Architecture Summary

```text
┌──────────────────────────────────────────────────────────┐
│                      Fastify API                         │
│                                                          │
│  Auth Routes ──── GoogleOAuthService (app login)         │
│                                                          │
│  Inbox Routes ─── ProviderRegistry                       │
│                   ├── GmailOAuthProvider                 │
│                   └── OutlookOAuthProvider                │
│                                                          │
│  Sync Routes ──── BullMQ Queue (inbox-sync)              │
│  Read Routes ──── Prisma (provider-neutral queries)      │
└──────────────────────┬───────────────────────────────────┘
                       │ Redis
┌──────────────────────▼───────────────────────────────────┐
│                    BullMQ Worker                          │
│                                                          │
│  InboxSyncProcessor ─── ProviderRegistry                 │
│                         ├── GmailSyncProvider            │
│                         │   └── GmailClient              │
│                         │       ├── fullSync (threads)    │
│                         │       └── incrementalSync       │
│                         │           (history API)         │
│                         └── OutlookSyncProvider           │
│                             └── OutlookClient             │
│                                 └── delta sync            │
│                                     (inbox-scoped)        │
│                                                          │
│  importProviderMailbox ──► EmailThread + EmailMessage     │
│                                                          │
│  InboxAnalysisProcessor                                  │
│  ├── normalizeEmailMessage                               │
│  ├── classifyNormalizedEmail                              │
│  └── extractTaskCandidate                                │
│       ──► NormalizedEmail + Classification + Task         │
└──────────────────────────────────────────────────────────┘
                       │
                ┌──────▼──────┐
                │  PostgreSQL  │
                │  (Prisma)    │
                │  13 models   │
                └─────────────┘
```

---

### Development Readiness Assessment

The backend engine is **production-architecture complete** for its current scope. Both Gmail and Outlook have real incremental sync, provider-neutral persistence, and a working analysis pipeline. The system is ready for:

1. **Frontend development** — all read/write APIs exist and return structured JSON
2. **OpenAI integration** — classifier scaffold exists; wire the Responses API to replace heuristic classification
3. **Webhook/push notifications** — Gmail watch and Outlook change notifications can be added without architectural changes
4. **Routing rules** — schema exists; implement matching logic against classification output
5. **Production hardening** — CSRF, rate limiting, test suites, observability dashboards
