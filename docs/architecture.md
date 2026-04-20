# Backend Architecture

## Goals

- Support many tenants and workspaces cleanly
- Separate HTTP concerns from use cases and infrastructure
- Isolate external providers behind stable interfaces
- Keep async processing first-class for inbox ingestion
- Preserve strict workspace isolation across all inbox operations
- Support multiple inbox providers (Gmail, Outlook) through a single abstraction

## Provider Abstraction

The system uses a split-interface provider model:

- **`InboxOAuthProvider`** — implemented by each provider's API-side adapter. Handles authorization URL generation, code exchange, profile fetch, scope management, and disconnect. Used by the Fastify API.
- **`InboxSyncProvider`** — implemented by each provider's worker-side adapter. Handles mailbox sync (fetching threads/messages and returning canonical `ProviderMailboxSyncResult`). Used by BullMQ workers.
- **`ProviderRegistry`** — a shared registry that holds OAuth providers and sync providers keyed by `InboxProviderKind`. The API registers OAuth providers; the worker registers sync providers.

This design means:
- No provider implementation throws "not implemented" for methods it can't fulfill
- The API never calls sync methods, and the worker never calls OAuth methods
- Adding a new provider requires implementing `InboxOAuthProvider` and `InboxSyncProvider`, then registering both

### Gmail provider layout

```text
apps/api/src/infrastructure/providers/gmail/
  gmail-provider.ts        GmailOAuthProvider implements InboxOAuthProvider

apps/worker/src/infrastructure/providers/gmail/
  gmail-provider.ts        GmailSyncProvider implements InboxSyncProvider
  gmail-client.ts          Gmail API client (googleapis wrapper)
```

### Canonical types

Provider-specific data is mapped to provider-neutral canonical types before it reaches the application layer:

- `ProviderThreadSnapshot` / `ProviderMessageSnapshot` — normalized thread and message shapes
- `providerMessageId` / `providerThreadId` — generic IDs (mapped from `gmailMessageId` / `gmailThreadId` in DB)
- `providerLabels` — generic labels (Gmail labels, Outlook folders/categories)
- `newestSyncCursor` — provider-specific sync checkpoint (Gmail historyId, Outlook deltaLink)

### App-auth vs inbox-provider OAuth

The system uses Google OAuth for two distinct purposes:

1. **App authentication** (`/api/v1/auth/google/*`) — signs users into the platform. Handled by `GoogleOAuthService` directly. This is NOT a provider concern.
2. **Inbox connection** (`/api/v1/inbox-connections/google/*`) — connects a Gmail inbox to a workspace. Handled by `GmailOAuthProvider` via the `ProviderRegistry`.

These are architecturally separate. App-auth stays Google-specific (it's the identity provider). Inbox connection goes through the provider abstraction.

## Boundary Overview

### `apps/api`

- Accepts requests
- Validates input
- Enqueues background work
- Exposes health and integration endpoints
- Owns the public contract for inbox and workspace operations
- Registers `InboxOAuthProvider` implementations in `ProviderRegistry`

### `apps/worker`

- Owns long-running and retryable jobs
- Registers `InboxSyncProvider` implementations in `ProviderRegistry`
- Performs backend-only inbox sync, extraction, and routing workflows
- Resolves provider from `InboxConnection.provider` at job runtime

### `packages/db`

- Defines the tenant-aware data model
- Exposes a shared Prisma client instance
- Enforces workspace-scoped relations for inbox data

### `packages/shared`

- Centralizes queue names and payload contracts
- Defines `InboxOAuthProvider`, `InboxSyncProvider`, and `ProviderRegistry`
- Defines canonical provider types (`ProviderMessageSnapshot`, etc.)
- Holds typed contracts used across process boundaries

### `packages/ai`

- Encapsulates OpenAI-specific prompt and client setup
- Returns placeholder extraction data until live inference is wired in

## Multi-Tenant Model

- `Workspace` is the operational boundary for inbox data.
- `Membership` handles many users per workspace and per-workspace authorization.
- `InboxConnection` allows many connected inboxes per workspace, from any supported provider.
- `EmailThread` and `EmailMessage` create one unified inbox across connected accounts while preserving provider lineage.
- `Classification`, `Task`, `RoutingRule`, `WorkspaceSetting`, and `AuditEvent` are all scoped to a workspace.

## Async Flow

1. API receives an inbox sync request.
2. API enqueues a BullMQ job scoped to a workspace and connection.
3. Worker loads the connection and resolves the provider from `connection.provider`.
4. Worker calls `provider.syncMailbox()` which returns canonical `ProviderMailboxSyncResult`.
5. `importProviderMailbox` persists threads and messages into workspace-scoped DB records.
6. Analysis pipeline (normalization, classification, task extraction) runs on DB-persisted canonical data.

## DB Schema Notes

The `EmailThread` and `EmailMessage` tables currently use columns named `gmailThreadId` and `gmailMessageId`. These store **provider-specific external IDs** and are used by all providers despite the Gmail prefix. The `importProviderMailbox` function maps canonical `providerThreadId` / `providerMessageId` to these columns. A future migration will rename these columns to `providerThreadId` / `providerMessageId` once Outlook rows exist and migration coordination is needed.

## Config / Env Notes

- `TOKEN_ENCRYPTION_SECRET` (preferred) or `GOOGLE_TOKEN_ENCRYPTION_SECRET` (legacy) — encrypts refresh/access tokens for ALL inbox providers, not just Gmail.
- `INBOX_OAUTH_STATE_TTL_SECONDS` (preferred) or `GOOGLE_OAUTH_STATE_TTL_SECONDS` (legacy) — TTL for inbox connection OAuth state in Redis, used by all providers.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — used for both app-auth and Gmail inbox provider.
- `GOOGLE_AUTH_REDIRECT_URI` — app-auth callback URL (Google login only).
- `GOOGLE_INBOX_REDIRECT_URI` — inbox connection callback URL (Gmail provider).

## Adding a New Provider (Outlook)

1. Add `OUTLOOK` to the Prisma `InboxProvider` enum and run a migration.
2. Create `apps/api/src/infrastructure/providers/outlook/outlook-provider.ts` implementing `InboxOAuthProvider`.
3. Create `apps/worker/src/infrastructure/providers/outlook/outlook-provider.ts` implementing `InboxSyncProvider`.
4. Register both in their respective `ProviderRegistry` setup (in `server.ts` and `inbox-sync.worker.ts`).
5. Add Outlook-specific start routes (e.g., `/inbox-connections/outlook/start`). The existing callback route resolves provider from OAuth state, so it works for any provider.
6. Add Outlook env vars (`OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REDIRECT_URI`).
7. The sync processor, import pipeline, and analysis pipeline work automatically — they operate on canonical `ProviderMailboxSyncResult` and `NormalizedEmail`.
8. Rename `gmailThreadId` / `gmailMessageId` DB columns to `providerThreadId` / `providerMessageId` via migration.
