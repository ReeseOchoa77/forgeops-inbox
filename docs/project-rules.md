# Project Rules

These rules are non-negotiable for ForgeOps. If a proposed change conflicts with one of these rules, redesign rather than merge around the rule.

Canonical architecture: [`README.md`](README.md) (this folder) and [`architecture/overview.md`](architecture/overview.md).

## Deployment safety

- **Implementation complete ≠ production deployed.** See [`DEPLOYMENT.md`](DEPLOYMENT.md).
- Do not push, merge to `main`, deploy, or run production migrations unless the user explicitly requests production deployment.
- Local development uses `APP_ENV=development` and localhost infra; production uses `APP_ENV=production` and separate DB/Redis/S3.
- Never put production `DATABASE_URL` in Cursor or local `.env`.

## Core invariants

### 1. Strict multi-tenant workspace isolation

`Workspace` is the operational tenant boundary. Queries, jobs, cache keys, and events must filter by `workspaceId`.

### 2. Backend is the source of truth

Canonical state for connections, threads, messages, classifications, Jobs, BidCandidates, tasks, and audit lives in Postgres. The frontend must not invent tenant access or persist provider tokens. Gmail and Microsoft Graph are upstream, not the database.

### 3. Never put provider logic in frontend code

Gmail and Microsoft Graph OAuth, tokens, refresh, sync, and parsing stay in API/worker. Tokens, scopes, and cursors must never be exposed to the client.

## Data modeling

### 4. Inbox-domain records carry `workspaceId`

Includes connections, threads, messages, classifications, tasks, Jobs, BidCandidates, routing rules, settings, audit events.

### 5. Tasks preserve source lineage

Email-created tasks link back to the source thread/message when they exist. Manual tasks use `TaskSource.MANUAL` and a requester user.

### 6. Do not silently auto-process low-confidence Job assignment

Email → Job matcher is **deterministic** and **auto-assign is OFF** (`JOB_MATCHER_AUTO_ASSIGN_ENABLED`). Do not persist matcher MATCH to `EmailMessage.jobId` without an explicit product decision. Classification still stores confidence; review remains first-class.

Authoritative Job assignment is only `USER_ASSIGNED` / `jobAssignmentIsManual` / `VERIFIED_PROJECT_FOLDER`. See [`architecture/job-matching.md`](architecture/job-matching.md).

## Application boundaries

### 7. Validate external structured objects

LLM output, provider payloads, webhooks, and queue payloads must be schema-validated (prefer Zod) before persist.

### 8. Prefer small typed modules

Shared contracts live in `@forgeops/shared`.

### 9. Outbound email is explicit and user-initiated

**Updated (was: “do not build sending yet”).** ForgeOps compose/send **is implemented**. Auto-reply and unsolicited customer-facing automation remain out of scope. Do not add code paths that send mail without an explicit user send action.

Bulk Clear Inbox / Clear All Emails must **never** delete provider mailbox messages. See [`operations/email-clearing.md`](operations/email-clearing.md).

## Auditability

### 10. Critical processing is auditable

Connection changes, sync, classification, Job assignment, review actions, and permission-sensitive mutations must leave a durable trace **without** storing Graph delta links, bodies, or secrets in `AuditEvent`. See [`../packages/db/scripts/AUDIT_EVENT_CLEANUP.md`](../packages/db/scripts/AUDIT_EVENT_CLEANUP.md).

### 11. Fail closed on tenant or validation ambiguity

Do not guess workspace, assignee, or Job from partial context. Matcher AMBIGUOUS/CONFLICT is not an assignment.

## Implementation checklist

Before merging backend work:

- every inbox-domain query is filtered by `workspaceId`
- provider code remains backend-only
- model and provider outputs are schema-validated
- email-created tasks preserve source lineage
- Job matcher auto-assign remains gated off unless explicitly requested
- bulk clear does not call Graph/Gmail delete
- no unsolicited auto-reply behavior
