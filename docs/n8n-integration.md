# n8n Integration — Architecture & Endpoint Contract

## Overview

ForgeOps Inbox accepts pre-processed Outlook emails from n8n as an alternate ingestion path. n8n handles the Outlook API polling and OpenAI analysis, then pushes normalized results into ForgeOps via a secure API endpoint. ForgeOps remains the system of record.

## Architecture

```
Outlook Mailbox
    ↓
n8n Workflow (external)
    → Poll Outlook via Graph API
    → Extract email content
    → Run OpenAI analysis (classify, extract tasks)
    ↓
ForgeOps API
    POST /api/v1/workspaces/:workspaceId/integrations/n8n/email-results
    Authorization: Bearer <N8N_INTEGRATION_API_KEY>
    ↓
ForgeOps Database
    → InboxConnection (ingestionSource: N8N)
    → EmailThread
    → EmailMessage
    → NormalizedEmail
    → Classification
    → Task
    ↓
ForgeOps UI (existing)
    → Inbox view (All / Business / Non-Business tabs)
    → Message detail / thread view
    → Tasks view
    → Review Queue
```

## Endpoint

```
POST /api/v1/workspaces/:workspaceId/integrations/n8n/email-results
Authorization: Bearer <N8N_INTEGRATION_API_KEY>
Content-Type: application/json
```

### Request body

```json
{
  "source": {
    "provider": "outlook",
    "mailboxEmail": "inbox@yourcompany.com",
    "providerMessageId": "AAMkAGI2TG93AAA=",
    "providerConversationId": "AAQkAGI2TG93conv=",
    "internetMessageId": "<msg123@example.com>"
  },
  "email": {
    "subject": "Purchase Order #1234",
    "normalizedSubject": "purchase order #1234",
    "senderName": "John Doe",
    "senderEmail": "john@contractor.com",
    "senderDomain": "contractor.com",
    "to": ["inbox@yourcompany.com"],
    "cc": [],
    "receivedAt": "2026-07-14T12:00:00.000Z",
    "bodyText": "Please review the attached PO for the Johnson project.",
    "bodyHtml": "<p>Please review the attached PO.</p>",
    "cleanBody": "Please review the attached PO for the Johnson project.",
    "hasAttachments": true,
    "attachmentNames": ["PO-1234.pdf"]
  },
  "analysis": {
    "businessCategory": "BUSINESS",
    "confidence": 0.92,
    "summary": "Purchase order review request for Johnson project",
    "priority": "HIGH",
    "containsActionRequest": true,
    "tasks": [
      {
        "title": "Review Purchase Order #1234",
        "description": "Review attached PO for the Johnson project",
        "dueDate": "2026-07-16T00:00:00.000Z",
        "recommendedOwner": "operations@example.com",
        "confidence": 0.88
      }
    ],
    "requiresReview": false,
    "reviewReasons": []
  }
}
```

### Response

```json
{
  "status": "created",
  "threadId": "clxyz...",
  "messageId": "clxyz...",
  "classificationId": "clxyz...",
  "taskIds": ["clxyz..."],
  "requiresReview": false,
  "deduplicationKey": "a1b2c3d4e5f6..."
}
```

Status values: `created`, `updated`, `unchanged`

### HTTP status codes

| Code | Meaning |
|------|---------|
| 201 | New email created |
| 200 | Existing email updated or unchanged |
| 400 | Invalid payload (Zod validation error) |
| 401 | Missing or invalid API key |
| 404 | Workspace not found |
| 409 | Mailbox conflict (native Outlook sync active) |
| 503 | n8n integration disabled or not configured |

## Required environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `N8N_INTEGRATION_ENABLED` | Yes | `true` to enable, `false` to disable (default: `false`) |
| `N8N_INTEGRATION_API_KEY` | Yes (when enabled) | At least 32 characters. Bearer token for authentication. |

Generate a key: `openssl rand -hex 32`

## Sample curl

```bash
curl -X POST \
  https://api.forgeops-inbox.com/api/v1/workspaces/YOUR_WORKSPACE_ID/integrations/n8n/email-results \
  -H "Authorization: Bearer YOUR_N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "provider": "outlook",
      "mailboxEmail": "inbox@yourcompany.com",
      "providerMessageId": "AAMkAGI2TG93AAA=",
      "providerConversationId": null,
      "internetMessageId": null
    },
    "email": {
      "subject": "Test email",
      "normalizedSubject": "test email",
      "senderName": "Test Sender",
      "senderEmail": "sender@example.com",
      "senderDomain": "example.com",
      "to": ["inbox@yourcompany.com"],
      "cc": [],
      "receivedAt": "2026-07-14T12:00:00.000Z",
      "bodyText": "This is a test email body.",
      "bodyHtml": null,
      "cleanBody": "This is a test email body.",
      "hasAttachments": false,
      "attachmentNames": []
    },
    "analysis": {
      "businessCategory": "BUSINESS",
      "confidence": 0.85,
      "summary": "Test email for integration verification",
      "priority": "NORMAL",
      "containsActionRequest": false,
      "tasks": [],
      "requiresReview": false,
      "reviewReasons": []
    }
  }'
```

## n8n Node Configuration

In your n8n workflow:

1. **Outlook Trigger** or **HTTP Request** node to poll Graph API for new messages
2. **OpenAI** node to classify and extract tasks
3. **HTTP Request** node to POST to ForgeOps:
   - Method: POST
   - URL: `https://api.forgeops-inbox.com/api/v1/workspaces/{{workspaceId}}/integrations/n8n/email-results`
   - Authentication: Header Auth
     - Name: `Authorization`
     - Value: `Bearer {{$env.FORGEOPS_API_KEY}}`
   - Body: JSON mapped from Outlook + OpenAI output

## Deduplication Rules

Deduplication key: `SHA256(workspaceId + mailboxEmail + provider + providerMessageId)` truncated to 32 hex chars.

| Scenario | Behavior |
|----------|----------|
| First delivery | Creates thread, message, classification, tasks. Returns `created`. |
| Same payload again | Compares confidence. If existing >= incoming, returns `unchanged`. |
| Higher confidence | Updates classification and tasks. Returns `updated`. |
| Concurrent duplicate | Database unique constraint catches race condition. Returns `unchanged`. |
| Different workspaceId | Creates independently (workspace isolation). |

## Native Outlook Sync Conflict

A mailbox **cannot** be processed by both native Outlook sync and n8n simultaneously.

| Scenario | Result |
|----------|--------|
| No existing connection | n8n creates a new InboxConnection with `ingestionSource: N8N` |
| Existing N8N connection | Reuses it |
| Existing NATIVE connection (ACTIVE) | **409 Conflict** — must disconnect native sync first |
| Existing NATIVE connection (DISCONNECTED) | Converts to `ingestionSource: N8N`, reactivates |

### Switching modes

**From native to n8n:**
1. Disconnect the native Outlook connection in the Connections UI
2. Start sending from n8n — a new N8N connection is auto-created

**From n8n to native:**
1. Stop the n8n workflow
2. Delete the n8n connection in the Connections UI
3. Connect Outlook natively via the Add Inbox flow

## Review Routing

- Classification enters review when `requiresReview: true` OR `confidence < 0.80`
- Tasks enter review when `task.confidence < 0.80`
- Review items appear in the existing Review Queue UI

## Audit Trail

All n8n operations are logged as `AuditEvent` records:

| Action | When |
|--------|------|
| `n8n.auth_rejected` | Invalid or missing API key |
| `n8n.validation_rejected` | Malformed request body |
| `n8n.email_created` | New email ingested |
| `n8n.email_updated` | Existing email updated with better analysis |
| `n8n.duplicate_ignored` | Unchanged duplicate delivery |
| `n8n.concurrent_duplicate_handled` | Race condition resolved by DB constraint |
| `n8n.ingestion_failed` | Unexpected error |

## Disable / Rollback

To disable n8n ingestion:
1. Set `N8N_INTEGRATION_ENABLED=false` on Railway
2. Redeploy — endpoint returns 503

To remove n8n data:
1. Identify n8n connections: `SELECT * FROM "InboxConnection" WHERE "ingestionSource" = 'N8N'`
2. Delete cascades through threads, messages, classifications, tasks

## Test Procedure

```bash
cd apps/api && npx vitest run --reporter=verbose
```

17 tests covering: valid create, idempotency, update, malformed payloads, invalid API key, workspace isolation, review routing, task limits, enum validation, default arrays.
