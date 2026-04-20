<<<<<<< HEAD
# ForgeOps Inbox Platform

Backend foundation for a multi-tenant inbox operations SaaS. The scaffold is organized as a TypeScript monorepo with a Fastify API, a BullMQ worker, Prisma for PostgreSQL, Redis-backed job processing, a provider-agnostic inbox architecture, backend-only Google app-auth, Gmail inbox sync, and a normalization/classification/task-extraction pipeline.

## Stack

- Node.js + npm workspaces
- TypeScript project references
- Fastify for the HTTP API
- PostgreSQL + Prisma for persistence
- Redis + BullMQ for async workflows
- OpenAI placeholder package for classification/extraction
- Provider-agnostic inbox abstraction (Gmail implemented; Outlook planned)
- Backend-only Google app-auth and inbox connection OAuth flows

## Project Structure

```text
apps/
  api/        Fastify API entrypoint, HTTP routes, queue dispatch
    src/infrastructure/providers/gmail/   GmailOAuthProvider
  worker/     Background job processing and inbox metadata ingestion
    src/infrastructure/providers/gmail/   GmailSyncProvider + GmailClient
packages/
  ai/         OpenAI integration boundary and prompt scaffolding
  db/         Prisma schema and shared Prisma client
  shared/     Provider interfaces, registry, canonical types, queue contracts
docs/
  architecture.md   Provider architecture, DB notes, adding-a-provider guide
  project-rules.md
  product-spec.md
```

## Provider Architecture

The inbox system is built on a **split-interface provider model**:

- **`InboxOAuthProvider`** (API) — auth URL generation, code exchange, profile fetch, scope management
- **`InboxSyncProvider`** (Worker) — mailbox sync returning canonical `ProviderMailboxSyncResult`
- **`ProviderRegistry`** — keyed lookup of providers by `InboxProviderKind` (`"gmail"` | `"outlook"`)

Gmail is the first implemented provider. Adding Outlook requires implementing both interfaces and registering them — no application-layer changes needed. See `docs/architecture.md` for the full guide.

**App-auth vs inbox-provider OAuth:** Google app login (`/api/v1/auth/google/*`) is handled by `GoogleOAuthService` directly and is separate from the inbox provider abstraction. Inbox connections (`/api/v1/inbox-connections/google/*`) go through `GmailOAuthProvider` via the `ProviderRegistry`.

## Clean Architecture Direction

- `domain`: core contracts and business-oriented interfaces
- `application`: use cases and orchestration logic
- `infrastructure`: databases, queues, third-party clients, **provider implementations**
- `interfaces`: HTTP transport and external adapters

This keeps tenant-aware business logic separated from Fastify, BullMQ, Prisma, and vendor SDK details.

## Project Rules

Project constraints and non-negotiable backend rules are documented in [docs/project-rules.md](/Users/reeseochoa/Desktop/forgeops-inbox/docs/project-rules.md).

## Quick Start

1. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

2. Fill in the required Google OAuth and session variables in `.env`:

   ```bash
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_AUTH_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
   GOOGLE_INBOX_REDIRECT_URI=http://localhost:3000/api/v1/inbox-connections/google/callback
   SESSION_COOKIE_SECRET=replace-with-a-long-random-string
   GOOGLE_TOKEN_ENCRYPTION_SECRET=replace-with-a-different-long-random-string
   DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=true
   DEV_ENABLE_BOOTSTRAP_ROUTES=true
   ```

   `GOOGLE_AUTH_REDIRECT_URI` and `GOOGLE_INBOX_REDIRECT_URI` must exactly match the Authorized redirect URIs configured in Google Cloud for your OAuth web client.

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start PostgreSQL and Redis:

   ```bash
   docker compose up -d
   ```

5. Generate Prisma client:

   ```bash
   npm run db:generate
   ```

6. Run Prisma migrate dev:

   ```bash
   npm run db:migrate -- --name init
   ```

7. Start the API and worker in separate terminals:

   ```bash
   npm run dev:api
   npm run dev:worker
   ```

## Google Cloud Callback URLs

These values must match in two places:

- Google Cloud Console > APIs & Services > Credentials > your OAuth 2.0 Client ID > Authorized redirect URIs
- local `.env` values for `GOOGLE_AUTH_REDIRECT_URI` and `GOOGLE_INBOX_REDIRECT_URI`

Use these exact callback URLs for local development:

   - `http://localhost:3000/api/v1/auth/google/callback`
   - `http://localhost:3000/api/v1/inbox-connections/google/callback`

## Useful Commands

- `npm run build`
- `npm run typecheck`
- `npm run db:generate`
- `npm run db:migrate -- --name init`
- `npm run db:studio`

## Current Backend Endpoints

- `GET /api/v1/auth/google/start`
- `GET /api/v1/auth/google/callback`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`
- `POST /api/v1/dev/bootstrap/workspace`
- `GET /api/v1/dev/workspaces/:workspaceId/inbox-connections/google/start`
- `GET /api/v1/dev/workspaces/:workspaceId/inbox-connections/:id/sync`
- `GET /api/v1/dev/workspaces/:workspaceId/inbox-connections/:id/analyze`
- `GET /api/v1/workspaces/:workspaceId/inbox-connections`
- `GET /api/v1/workspaces/:workspaceId/inbox-connections/:id`
- `GET /api/v1/workspaces/:workspaceId/inbox-connections/:id/messages`
- `GET /api/v1/workspaces/:workspaceId/inbox-connections/:id/messages/:messageId`
- `GET /api/v1/workspaces/:workspaceId/inbox-connections/:id/review`
- `GET /api/v1/workspaces/:workspaceId/inbox-connections/:id/tasks`
- `POST /api/v1/workspaces/:workspaceId/inbox-connections/google/start`
- `GET /api/v1/inbox-connections/google/callback`
- `POST /api/v1/workspaces/:workspaceId/inbox-connections/:id/reconnect`
- `DELETE /api/v1/workspaces/:workspaceId/inbox-connections/:id`
- `GET /api/v1/health`
- `GET /api/v1/integrations/gmail/config`
- `POST /api/v1/integrations/gmail/sync`

## Google OAuth Local Testing

### 1. Configure Google Cloud

- Enable the Google Gmail API.
- Create OAuth credentials for a web application.
- Add both local redirect URIs exactly:
  - `http://localhost:3000/api/v1/auth/google/callback`
  - `http://localhost:3000/api/v1/inbox-connections/google/callback`
- Add your Google account as a test user while the app is in testing mode.
- If your existing Google client JSON still points at `http://localhost:3001/auth/google/callback`, update the OAuth credential in Google Cloud before testing these routes.

### 2. Fill in env vars

At minimum set:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_AUTH_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
GOOGLE_INBOX_REDIRECT_URI=http://localhost:3000/api/v1/inbox-connections/google/callback
SESSION_COOKIE_SECRET=replace-with-a-long-random-string
GOOGLE_TOKEN_ENCRYPTION_SECRET=replace-with-a-different-long-random-string
DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=true
DEV_ENABLE_BOOTSTRAP_ROUTES=true
```

Optional fallback:

```bash
GOOGLE_REDIRECT_URI=
```

`GOOGLE_REDIRECT_URI` is only a fallback. Prefer setting both specific callback env vars directly.

### 3. Sign in with Google in the browser

Open:

```text
http://localhost:3000/api/v1/auth/google/start?redirect=true
```

After the callback completes, the API sets a signed session cookie and returns JSON with your user record and workspace memberships.

### 4. Get your current session and workspace

Open:

```text
http://localhost:3000/api/v1/auth/session
```

If `DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=true` and you have no memberships yet, a development workspace is created automatically on first login.

### 5. Create a workspace manually with the dev bootstrap route

Use this if you want an explicit test workspace without a frontend, or if you disable automatic workspace creation.

```js
fetch("/api/v1/dev/bootstrap/workspace", {
  method: "POST",
  credentials: "include",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    name: "Local Gmail Test Workspace",
    timezone: "America/Chicago"
  })
}).then((response) => response.json()).then(console.log);
```

This route is only available when:

- `NODE_ENV` is not `production`
- `DEV_ENABLE_BOOTSTRAP_ROUTES=true`

### 6. Start inbox connection in the authenticated browser

The easiest local path is to stay in the same browser where `/api/v1/auth/google/callback` already succeeded so the signed session cookie is preserved.

Use the workspace id from `/api/v1/auth/session`, then open:

```text
http://localhost:3000/api/v1/dev/workspaces/<workspaceId>/inbox-connections/google/start
```

That dev-only route uses your existing browser session, creates the Google inbox OAuth state for that workspace, and immediately redirects to Google.

If you want JSON instead of an immediate redirect, open:

```text
http://localhost:3000/api/v1/dev/workspaces/<workspaceId>/inbox-connections/google/start?redirect=false
```

The JSON response includes `authorizationUrl`, `requestedScopes`, and `workspaceId`.

The inbox connection OAuth request should include these scopes:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

It should also include:

- `access_type=offline`
- `prompt=consent`

The original POST route is still available if you want to test with `fetch` from the browser console:

```js
fetch("/api/v1/workspaces/<workspaceId>/inbox-connections/google/start", {
  method: "POST",
  credentials: "include",
  headers: {
    "content-type": "application/json"
  },
  body: "{}"
}).then((response) => response.json()).then(console.log);
```

Complete Google consent, and the callback returns JSON confirming:

- `connectionCreated`
- `googleAccountEmail`
- `grantedScopes`
- `refreshTokenReceived`
- `refreshTokenStored`
- `connection`

### 7. Reconnect or disconnect

Reconnect:

```js
fetch("/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/reconnect", {
  method: "POST",
  credentials: "include"
}).then((response) => response.json()).then(console.log);
```

Disconnect:

```js
fetch("/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>", {
  method: "DELETE",
  credentials: "include"
}).then((response) => response.json()).then(console.log);
```

### 8. Trigger a real Gmail sync

Once you have a `workspaceId` and `connectionId`:

```js
fetch("/api/v1/integrations/gmail/sync", {
  method: "POST",
  credentials: "include",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify({
    workspaceId: "<workspaceId>",
    inboxConnectionId: "<connectionId>"
  })
}).then((response) => response.json()).then(console.log);
```

This queues a real worker sync against Gmail for that workspace-scoped inbox connection.

If you want a browser-friendly dev route that waits for the worker and returns sync stats directly, open:

```text
http://localhost:3000/api/v1/dev/workspaces/<workspaceId>/inbox-connections/<connectionId>/sync
```

That route requires the same authenticated browser session and returns:

- `threadsImported`
- `messagesImported`
- `duplicatesSkipped`
- `newestHistoryId`

If you only want to queue the job without waiting, open:

```text
http://localhost:3000/api/v1/dev/workspaces/<workspaceId>/inbox-connections/<connectionId>/sync?wait=false
```

The worker now uses the stored refresh token to fetch the latest 100 Gmail inbox threads, imports metadata into `EmailThread` and `EmailMessage`, and updates `InboxConnection.syncCursor`, `lastSyncStartedAt`, and `lastSyncedAt`.

### 9. Verify imported rows

Open Prisma Studio:

```bash
npm run db:studio
```

Then verify:

- `InboxConnection`
  - `status` is `ACTIVE`
  - `syncCursor` contains the newest Gmail `historyId`
  - `lastSyncStartedAt` and `lastSyncedAt` are populated
- `EmailThread`
  - rows exist for the synced `workspaceId` and `inboxConnectionId`
  - `gmailThreadId`, `subject`, `snippet`, `participants`, `messageCount`, and `lastMessageAt` are populated
- `EmailMessage`
  - rows exist for the synced `workspaceId` and `inboxConnectionId`
  - `gmailMessageId`, `gmailThreadId`, `historyId`, `subject`, `senderEmail`, `receivedAt`, `labelIds`, and `attachmentMetadata` are populated

You can also re-run the same sync route and confirm idempotency: `messagesImported` should stop increasing for already imported Gmail messages, while `duplicatesSkipped` should increase.

### 10. Run normalization and extraction

After a successful sync, open:

```text
http://localhost:3000/api/v1/dev/workspaces/<workspaceId>/inbox-connections/<connectionId>/analyze
```

That route requires the same authenticated browser session and returns:

- `messagesAnalyzed`
- `messagesClassified`
- `taskCandidatesCreated`
- `lowConfidenceItemsFlaggedForReview`

To queue analysis without waiting:

```text
http://localhost:3000/api/v1/dev/workspaces/<workspaceId>/inbox-connections/<connectionId>/analyze?wait=false
```

The current normalization and extraction layer is deterministic and backend-only. It persists:

- `NormalizedEmail`
  - normalized sender/recipient structures
  - normalized subject
  - snippet
  - cleaned text body
  - label hints
  - category hints
- `Classification`
  - first-pass category
  - summary
  - priority
  - confidence
  - review flags
- `Task`
  - task candidate title
  - summary
  - assignee guess
  - due date when explicit
  - confidence
  - review flags

### 11. Verify normalized and extracted rows

In Prisma Studio verify:

- `NormalizedEmail`
  - one row per analyzed `EmailMessage`
  - `labelHints` and `categoryHints` are populated when signals exist
- `Classification`
  - one row per analyzed `EmailMessage`
  - `emailType`, `summary`, `confidence`, and review fields are populated
- `Task`
  - rows only exist for actionable/support/recruiting/internal messages
  - `summary`, `assigneeGuess`, `dueAt`, and `confidence` are populated when detected

Low-confidence records should show `requiresReview = true` and `reviewStatus = PENDING`.

### 12. Inspect connections, messages, review queue, and tasks

List inbox connections for a workspace:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections
```

Get one connection with counts:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>
```

List messages newest-first:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/messages
```

Filter messages by classification type and task-candidate presence:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/messages?classificationType=ACTIONABLE_REQUEST&hasTaskCandidate=true&page=1&pageSize=25
```

Filter messages to low-confidence or review-only items:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/messages?reviewOnly=true
```

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/messages?lowConfidenceOnly=true
```

Load one message with joined normalized/classification/task data:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/messages/<messageId>
```

Load the review queue for false-positive and low-confidence inspection:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/review?page=1&pageSize=25
```

List extracted task candidates:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/tasks?page=1&pageSize=25
```

Filter task candidates down to the risky set:

```text
http://localhost:3000/api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/tasks?reviewOnly=true
```

The best endpoint for auditing task false positives is usually:

```text
GET /api/v1/workspaces/<workspaceId>/inbox-connections/<connectionId>/tasks
```

because it shows only generated task candidates with their message context and classification.

### 13. Postman workflow

- Complete Google sign-in in the browser first.
- Copy the signed `forgeops_session` cookie value from the browser into Postman.
- Call `/api/v1/auth/session` in Postman to confirm the cookie is valid.
- Use that same cookie on the dev bootstrap, inbox connection start, reconnect, disconnect, sync, analyze, and read/review routes.
- Open the returned `authorizationUrl` in a browser for Google consent.

## Schema Notes

### Provider-specific DB columns

The `EmailThread` and `EmailMessage` tables use columns named `gmailThreadId` and `gmailMessageId`. Despite the Gmail prefix, these store **provider-specific external IDs** for any provider. The `importProviderMailbox` function and the read API both map between the DB column names and provider-neutral field names (`providerThreadId` / `providerMessageId`) at the application layer. A future migration will rename the columns when Outlook rows need to coexist.

### Sync metadata

- `EmailMessage.historyId` — per-message sync checkpoint (generic, not Gmail-specific)
- `EmailMessage.labelIds` — provider labels/folders stored as string array
- `InboxConnection.syncCursor` — provider-specific sync cursor (Gmail historyId, Outlook deltaLink)
- Unique constraints on `inboxConnectionId + gmailThreadId` and `inboxConnectionId + gmailMessageId` provide idempotent dedupe across providers

### Normalization and extraction

- `NormalizedEmail`, `Classification`, and `Task` are provider-agnostic and operate on canonical DB data
- `Classification.workspaceId + messageId` and `Task.workspaceId + sourceMessageId` unique constraints ensure idempotent re-analysis

## Config / Env Notes

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (app-auth + Gmail inbox provider) |
| `GOOGLE_AUTH_REDIRECT_URI` | App-auth callback URL (Google login only) |
| `GOOGLE_INBOX_REDIRECT_URI` | Inbox connection callback URL (Gmail provider) |
| `TOKEN_ENCRYPTION_SECRET` | Encrypts refresh/access tokens for ALL providers (preferred name) |
| `GOOGLE_TOKEN_ENCRYPTION_SECRET` | Legacy alias for `TOKEN_ENCRYPTION_SECRET` |
| `INBOX_OAUTH_STATE_TTL_SECONDS` | TTL for inbox OAuth state in Redis (preferred name) |
| `GOOGLE_OAUTH_STATE_TTL_SECONDS` | Legacy alias for `INBOX_OAUTH_STATE_TTL_SECONDS` |

## What Is Intentionally Placeholder

- Outlook provider (architecture is ready; implementation not started)
- Gmail watch/push subscriptions
- Full raw email body storage and attachment downloading
- Gmail send scope is requested for future use, but sending is not implemented
- OpenAI-assisted extraction/classification and structured output parsing
- Production-grade session hardening, CSRF protection, and full workspace CRUD
- Production observability, metrics, and test suites
- Renaming `gmailThreadId` / `gmailMessageId` DB columns to `providerThreadId` / `providerMessageId`

The scaffold is designed so those features can be added without reworking the repo layout.
=======
# forgeops-inbox
AI email manager
>>>>>>> b95ce43593594be686b72b584e17a82a2cdf071c
