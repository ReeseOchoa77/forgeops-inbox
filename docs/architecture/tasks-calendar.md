# Tasks, calendar, and pinning

## Task model

Canonical `Task` (`packages/db/prisma/schema.prisma`):

| Field | Meaning |
|-------|---------|
| `assigneeUserId` | Canonical assignee |
| `requesterUserId` | ForgeOps user who created/requested. **Null** for external email provenance |
| `source` | `EMAIL` \| `MANUAL` |
| `status` | `OPEN` \| `IN_PROGRESS` \| `BLOCKED` \| `DONE` \| `CANCELLED` |
| `assigneeGuess` | Non-authoritative text |
| `isPinned` / `pinnedAt` | Independent of email pins |

Workspace-scoped. Email-created tasks keep `sourceMessageId` / thread lineage.

## Assignment (deterministic, not AI)

`packages/shared/src/tasks/resolve-email-task-assignee.ts`:

- **RECEIVED:** exactly one TO address matching a workspace member → that user. 0 or >1 → unassigned. CC ignored. No fuzzy names. No LLM.
- **SENT:** native persist does **not** assign the sender (`assigneeUserId = null`).

Manual create (`POST /workspaces/:id/tasks`): `source: MANUAL`, `requesterUserId` from session (client cannot set it), required `assigneeUserId` must be an active member. `MEMBER+`.

n8n ingest follows the email pattern (`requesterUserId: null`).

## Lists

`packages/shared/src/tasks/task-list-filters.ts`:

| View | Predicate |
|------|-----------|
| My Tasks | `assigneeUserId = current user` |
| Requests | `requesterUserId = me` AND assignee is **not** me (self-assigned never in Requests) |
| ALL | OWNER/ADMIN workspace-wide; optional assignee scope `ALL` \| `UNASSIGNED` \| user. Non-admin ALL degenerates to My ∪ own Requests |

`MANAGER` is **not** in the inspect-all predicate. Default UI view is My Tasks.

Complete / reopen: `PATCH .../tasks/:taskId/status` with `OPEN` \| `DONE`. Allowed for OWNER/ADMIN, assignee, or requester.

## Calendar

**IMPLEMENTED principle:** Task due dates are projected from `Task.dueAt` + `Task.assigneeUserId`. **Requester is ignored.**

- Default `calendarFor=ME` → assignee = current user
- OWNER/ADMIN may inspect `ALL`, `UNASSIGNED`, or a member
- Non OWNER/ADMIN cannot leave ME (403)
- `CalendarEvent` rows and Bid Due (`Job.status=BIDDING` + `Job.bidDueAt`) are workspace-wide, not assignee-scoped
- Google/Microsoft calendar **sync is not wired**

Requester does not get a personal calendar of requested tasks.

## Pinning

Email and Task pins are **independent** fields and endpoints.

| Entity | Fields | Filter |
|--------|--------|--------|
| Email | `EmailMessage.isPinned`, `pinnedAt` | Inbox `pinnedOnly` (server-side, before pagination) |
| Task | `Task.isPinned`, `pinnedAt` | Tasks `pinnedOnly` |

Lists sort pinned first. `VIEWER` cannot pin.

`Membership.pinnedInboxConnectionId` is the user’s default mailbox, not an email/task pin.
