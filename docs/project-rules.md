# Project Rules

These rules are non-negotiable for the ForgeOps Inbox backend. If a proposed change conflicts with one of these rules, the change should be redesigned rather than merged around the rule.

## Core Invariants

### 1. Preserve strict multi-tenant workspace isolation

- `Workspace` is the operational tenant boundary for inbox data.
- Inbox data from one workspace must never be readable, writable, queryable, or routable from another workspace.
- Authorization, queries, jobs, cache keys, and event processing must all enforce workspace scoping.
- If a record belongs to inbox operations, it must carry `workspaceId` and be filtered by `workspaceId`.

### 2. Backend is the source of truth for inbox data

- The backend owns canonical state for inbox connections, threads, messages, classifications, tasks, routing decisions, and audit history.
- Frontend code may render or request data, but it must not invent inbox state, infer tenant access, or persist integration state on its own.
- External providers such as Gmail are upstream systems, not the application source of truth. Normalize provider data into backend-owned records.

### 3. Never put Gmail logic in frontend code

- Gmail OAuth exchange, token handling, refresh logic, message sync, thread normalization, and provider-specific parsing must live in backend services only.
- Frontend code may initiate backend actions and display backend results, but must not call Gmail APIs directly.
- Gmail access tokens, refresh tokens, scopes, cursors, and sync metadata must never be exposed to the client.

## Data Modeling Rules

### 4. All inbox-related records must be scoped by `workspaceId`

This applies to all current and future inbox-domain records, including:

- inbox connections
- email threads
- email messages
- classifications
- tasks
- routing rules
- workspace settings
- audit events

If a new inbox-domain model does not include `workspaceId`, it is almost certainly wrong.

### 5. Tasks must preserve source lineage

- Every task must link back to the source email thread.
- When available, tasks should also link to the source email message and classification record that caused the task to exist.
- Downstream task workflows must not break traceability to the originating inbox item.

### 6. Review queues and confidence are first-class

- Classification and task generation must store confidence scores.
- Low-confidence outcomes must be eligible for review queues instead of silent auto-processing.
- Review state must be persisted, not inferred transiently in memory.

## Application Boundary Rules

### 7. All model outputs must validate against a schema

- Every LLM output, provider payload, webhook body, queue job payload, and externally sourced structured object must be validated before it is trusted.
- Use explicit schemas with strong typing. Prefer `zod` at service boundaries and typed persistence shapes at database boundaries.
- Never persist raw model output as if it were trusted application state.

### 8. Prefer small typed modules

- Keep modules focused on one responsibility.
- Favor small typed interfaces over large utility files or highly stateful service classes.
- Shared contracts should live in package boundaries designed for reuse, not in ad hoc cross-imports.

### 9. Do not build auto-reply or email sending yet

- Outbound email generation, auto-replies, and send workflows are out of scope for this stage.
- Do not add code paths that send email, draft replies, or automate customer-facing communication.
- Current scope is ingestion, normalization, classification, routing, and task extraction only.

## Auditability and Operations

### 10. All critical processing should be auditable and logged

- Critical actions must leave a durable trace. Examples: inbox connection changes, sync starts/completions, classification writes, routing decisions, task creation, review actions, and permission-sensitive mutations.
- Logs must include enough context to trace a request or job through the system without leaking secrets.
- Important state transitions should be representable through `AuditEvent` records or equivalent durable history.

### 11. Fail closed on tenant or validation ambiguity

- If workspace identity, authorization, schema validity, or source lineage is uncertain, stop processing and surface an error.
- Do not guess the tenant, workspace, assignee, or classification target from partial context.

## Implementation Checklist

Before merging backend work, verify:

- every inbox-domain query is filtered by `workspaceId`
- every write path carries the correct `workspaceId`
- Gmail code remains backend-only
- model and provider outputs are schema-validated
- tasks preserve source thread and message lineage
- confidence and review metadata are persisted where applicable
- critical actions emit logs and auditable records
- no outbound email or auto-reply behavior has been introduced

