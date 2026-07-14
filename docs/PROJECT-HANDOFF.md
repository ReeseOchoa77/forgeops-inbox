# ForgeOps Inbox — Complete Project Documentation

## What It Is

ForgeOps Inbox is a **private-access, multi-tenant email operations platform** that connects Gmail and Outlook inboxes, syncs messages in real-time, classifies them automatically, extracts actionable tasks, and provides a Gmail-like web interface for reading, replying, and managing email. It's designed as an internal tool for teams that need structured email processing — not a consumer email client.

Only allowlisted users can access the app. Authentication is via Google OAuth. Email providers (Gmail/Outlook) are connected separately as inbox data sources.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | npm workspaces, TypeScript project references |
| API | Fastify (Node.js HTTP framework) |
| Worker | BullMQ (Redis-backed job queues) |
| Database | PostgreSQL via Prisma ORM |
| Cache/Queue | Redis (sessions, OAuth state, BullMQ backend) |
| Frontend | React + Vite (no framework — plain SPA) |
| Rich Text | TipTap editor |
| HTML Sanitization | DOMPurify |
| Deployment | Vercel (frontend), Railway (API + Worker + DB + Redis) |
| Domain | forgeops-inbox.com (Vercel) + api.forgeops-inbox.com (Railway) |

---

## Project Structure with File Descriptions

```
forgeops-inbox/
```

### Root

| File | Purpose |
|------|---------|
| `package.json` | Workspace root — defines npm workspaces, dev scripts (`dev:api`, `dev:worker`, `dev:web`) |
| `tsconfig.base.json` | Shared TypeScript compiler options (strict mode, ESM, exactOptionalPropertyTypes) |
| `tsconfig.projects.json` | Project references linking all packages and apps |
| `docker-compose.yml` | Local dev: Postgres 16 + Redis 7 containers |
| `.env.example` | Template for all environment variables |

### `packages/shared/` — Shared Types and Utilities

The contract layer. Every type that crosses the API/Worker boundary lives here.

| File | Purpose |
|------|---------|
| `src/index.ts` | Barrel export for the package |
| `src/constants/queues.ts` | Queue name constants: `inbox-sync`, `inbox-analysis`, `ai-extraction` |
| `src/types/provider.ts` | **Core provider abstraction**: `InboxOAuthProvider` (API-side auth), `InboxSyncProvider` (worker-side sync), `ProviderMessageSnapshot`, `ProviderThreadSnapshot`, `ProviderMailboxSyncResult`. This is what makes Gmail and Outlook interchangeable. |
| `src/types/jobs.ts` | BullMQ job payload/result types: `InboxSyncJobPayload`, `InboxSyncResult`, `InboxAnalysisJobPayload`, `InboxAnalysisResult` |
| `src/types/inbox.ts` | Inbox-related shared types |
| `src/types/tenant.ts` | `TenantContext` type for multi-tenant scoping |
| `src/providers/provider-registry.ts` | `ProviderRegistry` class — maps provider kind ("gmail"/"outlook") to OAuth and Sync provider instances |
| `src/security/token-cipher.ts` | `TokenCipher` — AES-256-GCM encryption for OAuth tokens stored in DB |

### `packages/db/` — Database Layer

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | **Complete database schema** — 16 models including `Workspace`, `User`, `Membership`, `ApprovedAccess`, `InboxConnection`, `EmailThread`, `EmailMessage`, `NormalizedEmail`, `Classification`, `Task`, `Customer`, `Vendor`, `Job`, `RoutingRule`, `WorkspaceSetting`, `AuditEvent` |
| `prisma/seed-approved-access.ts` | Seeds the allowlist with initial approved emails |
| `prisma/migrations/` | 11 SQL migrations from initial schema through push subscription support |
| `src/client.ts` | Prisma client singleton |
| `src/index.ts` | Re-exports the client |

**Key schema concepts:**
- `InboxConnection` stores OAuth tokens (encrypted), sync cursor, push subscription state, per-provider
- `EmailMessage` has `bodyText`, `bodyHtml`, `isRead`, `isImportant`, `isSpam`, `isTrashed`, `labelIds[]`, `attachmentMetadata` (JSON)
- `Classification` links to a message with `businessCategory` (BUSINESS/NON_BUSINESS), `emailType`, `priority`, `confidence`, `requiresReview`
- `Task` extracted from messages with `title`, `summary`, `assigneeGuess`, `dueAt`, `priority`, `confidence`
- Everything is workspace-scoped via `workspaceId` foreign keys

### `packages/ai/` — AI Classification (Stub)

| File | Purpose |
|------|---------|
| `src/openai/inbox-classifier.ts` | `OpenAIInboxClassifier` — **currently a placeholder** that returns fixed low-confidence results. Not wired into the analysis pipeline. |
| `src/openai/openai-client.ts` | OpenAI client factory |
| `src/prompts/inbox-classification.prompt.ts` | Prompt template for future LLM classification |

### `apps/api/` — HTTP API Service

The API handles authentication, OAuth flows, reading data, sending email, and webhook endpoints.

#### Config & Entry

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point — builds server, listens on `0.0.0.0:PORT` |
| `src/config/env.ts` | Zod-validated environment variables (Google OAuth, Outlook OAuth, Redis, session config, Pub/Sub) |

#### Application Layer

| File | Purpose |
|------|---------|
| `src/application/services/audit-event-logger.ts` | Writes `AuditEvent` records for every significant action |
| `src/application/services/workspace-access.ts` | `requireWorkspaceMembership()` — checks user has access to a workspace |
| `src/application/services/dev-workspace-provisioner.ts` | Auto-creates workspace on first login (dev mode) |
| `src/application/use-cases/request-inbox-sync.ts` | Use case wrapper for dispatching sync jobs |

#### Domain

| File | Purpose |
|------|---------|
| `src/domain/auth/auth-session.ts` | Session type definition |
| `src/domain/google/oauth-state.ts` | OAuth state schema stored in Redis during auth flows (includes `provider` field for multi-provider) |
| `src/domain/services/inbox-sync-dispatcher.ts` | Interface for sync job dispatching |

#### Infrastructure

| File | Purpose |
|------|---------|
| `src/infrastructure/google/google-oauth-service.ts` | Google OAuth client — generates auth URLs, exchanges codes, fetches user profiles. Used for **app login** (Google Sign-In). |
| `src/infrastructure/providers/gmail/gmail-provider.ts` | `GmailOAuthProvider` — implements `InboxOAuthProvider` for Gmail inbox connections |
| `src/infrastructure/providers/outlook/outlook-provider.ts` | `OutlookOAuthProvider` — implements `InboxOAuthProvider` for Outlook inbox connections |
| `src/infrastructure/queues/bullmq-inbox-sync-dispatcher.ts` | BullMQ adapter for dispatching sync jobs |
| `src/infrastructure/queues/bullmq-inbox-analysis-dispatcher.ts` | Job options for analysis queue |
| `src/infrastructure/redis/connection.ts` | Redis/BullMQ connection factories |
| `src/infrastructure/session/redis-session-store.ts` | Redis-backed session store (signed HTTP-only cookies) |
| `src/infrastructure/session/google-oauth-state-store.ts` | Redis-backed OAuth state store with TTL |

#### HTTP Routes

| File | Key Endpoints | Purpose |
|------|--------------|---------|
| `routes/auth.route.ts` | `GET /auth/google/start`, `GET /auth/google/callback`, `GET /auth/session`, `POST /auth/logout` | Google Sign-In for app access. Checks allowlist on callback. |
| `routes/inbox-connection.route.ts` | `POST .../inbox-connections/google/start`, `POST .../outlook/start`, `GET .../google/callback`, `DELETE .../inbox-connections/:id`, `POST .../reconnect` | OAuth flows for connecting Gmail/Outlook inboxes. Registers scheduled sync + push on connect. |
| `routes/inbox-read.route.ts` | `GET .../messages`, `GET .../messages/:id`, `GET .../threads/:threadId/messages`, `GET .../tasks`, `GET .../review`, `PATCH .../messages/:id/read`, `PATCH .../messages/:id/trash`, `PATCH .../messages/:id/untrash` | **Largest route file.** All read operations. Supports filtering by `businessCategory`, `classificationType`, `category` (important/spam/trash), `search`, pagination. Thread endpoint returns all messages in a conversation. |
| `routes/inbox-actions.route.ts` | `POST .../sync`, `POST .../analyze` | Manual sync/analyze triggers with optional `wait=true` |
| `routes/send.route.ts` | `POST .../send` | Send email: reply, forward, or new compose. Supports HTML body + file attachments (multipart/form-data). Gmail sends via MIME, Outlook via Graph API with 3-step reply flow. |
| `routes/attachment.route.ts` | `GET .../attachments/:id/download` | Proxy endpoint — fetches attachment bytes from Gmail/Outlook API on demand, streams to browser |
| `routes/webhook.route.ts` | `POST /webhooks/gmail`, `POST /webhooks/outlook`, `POST /webhooks/register-push/:connectionId` | Real-time push notification handlers. Gmail via Pub/Sub, Outlook via Graph subscriptions. |
| `routes/allowlist.route.ts` | `GET/POST/PATCH .../approved-access` | Admin-only approved email management |
| `routes/review-action.route.ts` | `PATCH .../classifications/:id/review`, `PATCH .../tasks/:id/review` | Approve/reject classifications and tasks |
| `routes/import.route.ts` | `POST .../import/customers\|vendors\|jobs` | CSV/JSON bulk import for domain entities |
| `routes/ai-import.route.ts` | `POST .../import/extract` | AI-assisted extraction from CSV/PDF/TXT files via OpenAI |
| `routes/health.route.ts` | `GET /health` | Health check with config diagnostics |
| `routes/gmail.route.ts` | Legacy Gmail-specific routes (dev use) |
| `routes/dev.route.ts` | Dev-only bootstrap routes |

#### Server Setup (`server.ts`)

Wires everything together: registers Fastify plugins (cookie, CORS, multipart), creates Redis connections, BullMQ queues, OAuth services, provider registry, session store. Decorates `app.services` with all dependencies. Sets up push subscription renewal on hourly interval.

### `apps/worker/` — Background Job Processor

The worker processes async jobs from BullMQ queues. It never handles HTTP requests.

#### Entry & Config

| File | Purpose |
|------|---------|
| `src/main.ts` | Starts sync + analysis workers, registers BullMQ repeatable jobs (5-min sync for all active connections), handles graceful shutdown |
| `src/config/env.ts` | Worker-specific env validation |

#### Processors

| File | Purpose |
|------|---------|
| `src/application/processors/inbox-sync.processor.ts` | **Sync orchestrator.** Loads connection, decrypts tokens, calls provider `syncMailbox()`, runs `importProviderMailbox()`, updates sync cursor/tokens, classifies failures (REQUIRES_REAUTH vs transient), auto-queues analysis if new messages imported. |
| `src/application/processors/inbox-analysis.processor.ts` | **Analysis orchestrator.** Runs all messages through normalize → classify → extract tasks pipeline. |

#### Services (Analysis Pipeline)

| File | Purpose |
|------|---------|
| `src/application/services/import-provider-mailbox.ts` | **Provider-agnostic import.** Takes `ProviderMailboxSyncResult`, upserts threads and messages into DB. Sets `isRead`, `isImportant`, `isSpam` from provider labels. Batches 25 threads per transaction. |
| `src/application/services/normalize-email-message.ts` | Normalizes raw email into `NormalizedEmail` — clean text body, sender/recipient parsing, label hints, category hints, domain extraction |
| `src/application/services/classify-normalized-email.ts` | **Heuristic classifier.** Scores emails against 7 types (ACTIONABLE_REQUEST, FYI_UPDATE, SALES_MARKETING, etc.) using keyword matching. Determines businessCategory (BUSINESS vs NON_BUSINESS), priority, confidence, requiresReview. |
| `src/application/services/extract-task-candidate.ts` | **Heuristic task extractor.** Extracts title, summary, assignee guess, due date from actionable emails. |
| `src/application/services/analyze-inbox-connection.ts` | Runs the full pipeline: normalize → classify → extract tasks for all messages in a connection. Batched in transactions of 25. |
| `src/application/services/email-analysis.schemas.ts` | Zod schemas for analysis output validation |
| `src/application/services/import-gmail-mailbox.ts` | Legacy Gmail-specific import (superseded by provider-agnostic version) |

#### Provider Implementations

| File | Purpose |
|------|---------|
| `src/infrastructure/gmail/gmail-client.ts` | **Gmail API client.** Full sync via `threads.list` + `threads.get`, incremental sync via `history.list`. Parses MIME parts, extracts text/HTML body, attachment metadata. |
| `src/infrastructure/providers/gmail/gmail-provider.ts` | `GmailSyncProvider` — implements `InboxSyncProvider`, maps Gmail snapshots to canonical `ProviderMessageSnapshot` |
| `src/infrastructure/providers/outlook/outlook-client.ts` | **Outlook Graph API client.** Inbox-scoped delta sync, folder name resolution (maps Junk Email → spam, Deleted Items → trash), attachment metadata fetch, flag/importance/read state extraction. |
| `src/infrastructure/providers/outlook/outlook-provider.ts` | `OutlookSyncProvider` — implements `InboxSyncProvider`, maps Outlook snapshots to canonical types |

### `apps/web/` — React Frontend

Single-page app with sidebar navigation, app shell, and multiple views.

| File | Purpose |
|------|---------|
| `src/main.tsx` | React entry point |
| `src/App.tsx` | **App shell.** Sidebar nav, topbar with workspace selector, session management, access-denied screen, compose modal. Routes between views. |
| `src/api.ts` | **API client.** All backend calls with typed responses. Session, connections, messages, threads, tasks, review, send, import, attachments. |
| `src/index.css` | Global styles — app layout (100vh locked, no page scroll), sidebar, cards, buttons, email HTML containment |
| `src/env.d.ts` | Vite env type declarations |
| `src/components/Badges.tsx` | Reusable badge components: BusinessBadge, TypeBadge, PriorityBadge, ConfidenceBadge, ReviewStatusBadge, StatusBadge |
| `src/components/ComposeEditor.tsx` | **TipTap rich-text editor** with toolbar (bold, italic, underline, links, lists, blockquote), file attachment upload, recipient fields |
| `src/views/MessagesView.tsx` | **Inbox list.** Tabs: All, Business, Non-Business, Important, Spam, Trash. Type filter chips. Infinite scroll. Search. Read/unread styling. Important star. Trash button. Inline tasks panel. |
| `src/views/MessageDetailView.tsx` | **Conversation thread view.** Loads all messages in thread, expand/collapse cards. HTML email rendering (DOMPurify). Attachment bar with download links. Reply/forward with TipTap editor. |
| `src/views/ConnectionsView.tsx` | Manage inbox connections — add Gmail/Outlook, reconnect, disconnect |
| `src/views/TeamAccessView.tsx` | Allowlist management — add/revoke approved emails |
| `src/views/ReviewQueueView.tsx` | Low-confidence items requiring human review |
| `src/views/TasksView.tsx` | Extracted tasks list (also shown inline in MessagesView) |
| `src/views/DataImportView.tsx` | 5-step AI-assisted file upload → extraction → review → import flow |
| `src/views/SettingsView.tsx` | Placeholder — "Coming soon" |
| `vercel.json` | Rewrites `/api/*` to Railway API for same-origin cookie sharing |

---

## How It Works — Data Flow

```
User connects Gmail/Outlook via OAuth
    ↓
InboxConnection created in DB (encrypted tokens)
    ↓
BullMQ repeatable job registered (every 5 min)
+ Push notification subscription registered (real-time)
    ↓
Sync trigger (push webhook OR 5-min poll OR manual)
    ↓
Worker: InboxSyncProcessor
    → Provider.syncMailbox() (Gmail API / Graph API)
    → importProviderMailbox() (upsert threads + messages)
    → Sets isRead, isImportant, isSpam from provider labels
    → Stores bodyText + bodyHtml
    ↓
If new messages imported → auto-queue analysis
    ↓
Worker: InboxAnalysisProcessor
    → For each message:
        → normalizeEmailMessage() → NormalizedEmail
        → classifyNormalizedEmail() → Classification (heuristic)
        → extractTaskCandidate() → Task (if actionable)
    → Writes to DB
    ↓
Frontend displays:
    → Inbox list with tabs/filters
    → Conversation thread view with HTML rendering
    → Attachment download (proxy through API)
    → Reply/forward with rich text editor
    → Task list inline
    → Review queue for low-confidence items
```

---

## Authentication & Access Control

1. **App login**: Google OAuth → check `ApprovedAccess` table → create session cookie → redirect to frontend
2. **Session**: Redis-backed, signed HTTP-only cookie, 7-day TTL
3. **Workspace access**: Every API call checks `requireWorkspaceMembership()`
4. **Roles**: OWNER, ADMIN, MEMBER (stored in `Membership`)
5. **Inbox tokens**: AES-256-GCM encrypted in DB via `TokenCipher`

---

## Deployment Architecture

```
Browser → forgeops-inbox.com (Vercel)
    → /api/* proxied to api.forgeops-inbox.com (Railway)
        → Fastify API service
        → PostgreSQL (Railway)
        → Redis (Railway)
    → BullMQ Worker service (Railway, same repo)
```

**Env vars needed** (Railway API service):
- `DATABASE_URL`, `DIRECT_URL` — Postgres
- `REDIS_URL` — Redis
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — App login OAuth
- `GOOGLE_AUTH_REDIRECT_URI` — e.g. `https://forgeops-inbox.com/api/v1/auth/google/callback`
- `GOOGLE_INBOX_REDIRECT_URI` — e.g. `https://forgeops-inbox.com/api/v1/inbox-connections/google/callback`
- `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_TENANT_ID`, `OUTLOOK_REDIRECT_URI`
- `TOKEN_ENCRYPTION_SECRET` — 32+ char secret for token encryption
- `SESSION_COOKIE_SECRET` — 16+ char secret for cookies
- `FRONTEND_URL` — `https://forgeops-inbox.com`
- `GMAIL_PUBSUB_TOPIC` — (optional) for real-time Gmail push
- `PUSH_WEBHOOK_SECRET` — (optional) for Outlook push verification

---

## Current Development Stage

### What Works End-to-End
- Gmail and Outlook inbox connection via OAuth
- Incremental email sync (history-based for Gmail, delta for Outlook)
- Auto-sync every 5 minutes + real-time push notification infrastructure
- Auto-analysis after sync (classify + extract tasks)
- HTML email rendering with DOMPurify sanitization
- Conversation thread view with expand/collapse
- Attachment download proxy (streams from provider APIs)
- Rich-text compose (TipTap) with reply/forward/new compose
- File attachment upload on send
- Read/unread, Important, Spam, Trash categories
- Allowlist-based access control
- Team access management
- CSV/PDF/TXT data import with AI extraction
- Deployed on Vercel + Railway with custom domain

### What Uses Heuristics (Not AI)
- Email classification — keyword/pattern matching, not OpenAI
- Task extraction — rule-based, not LLM
- `packages/ai` exists but the OpenAI classifier is a stub

### What's Not Built Yet
- Real AI classification via OpenAI (Phase 2)
- Entity linking — matching emails to Customers/Vendors/Jobs (Phase 3)
- Settings page — placeholder only
- Routing rules engine — `RoutingRule` model exists but no logic
- Star/flag emails (user-initiated)
- Archive/delete (provider-side)
- Drafts auto-save
- Contact autocomplete
- Keyboard shortcuts
- CI/CD pipeline
- Error tracking (Sentry)
- Monitoring dashboards
