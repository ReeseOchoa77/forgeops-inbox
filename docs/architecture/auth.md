# Authentication and authorization

Four identities that must not be collapsed:

| Identity | Model / field | Purpose |
|----------|---------------|---------|
| ForgeOps application user | `User` (`googleSubject` / `microsoftSubject`) | Session login |
| Workspace membership | `Membership.role` | Per-workspace authorization |
| Platform / admin identity | `User.platformRole` / `isPlatformAdmin` | Cross-workspace operator tools |
| Mailbox OAuth identity | `InboxConnection.oauthAccountEmail` | Who granted Graph/Gmail tokens |
| Target mailbox | `InboxConnection.email` | Which mailbox is synced |

Connecting a mailbox is **not** signing into ForgeOps. Signing into ForgeOps does **not** attach that user’s personal inbox automatically.

## App login

Routes: `apps/api/src/interfaces/http/routes/auth.route.ts`.

| Provider | Routes | UI |
|----------|--------|-----|
| Google | `GET /api/v1/auth/google/start` + `/callback` | Always shown |
| Microsoft | `GET /api/v1/auth/microsoft/start` + `/callback` | Shown when `microsoftAuthAvailable` (env `MICROSOFT_AUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`) |

Both require `ApprovedAccess.status = ACTIVE` for the normalized email; otherwise `/?access=denied`. Session GET re-checks the allowlist and destroys the session if revoked.

Dev-only auto workspace create: `DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN` (forced off in production).

## Allowlist

`ApprovedAccess`: unique `(workspaceId, email)`, role default `MEMBER`, `workspaceRole` default `VIEWER`, status `ACTIVE` \| `REVOKED`.

Mutate allowlist: Membership `OWNER` or `ADMIN`. Seed script: `npm run db:seed-access` (`packages/db/prisma/seed-approved-access.ts`) — edit before production seed; do not commit extra PII.

## Workspace roles

`Role`: `OWNER` \| `ADMIN` \| `MANAGER` \| `MEMBER` \| `VIEWER`.

Separate `Membership.workspaceRole`: `OWNER` \| `EDITOR` \| `VIEWER` (used on some Job/CRM checks).

Notable gates:

- Personal Inbox for **other** mailboxes: OWNER/ADMIN
- Tasks/calendar inspect-all: OWNER/ADMIN (**not MANAGER**)
- Pin / create task: MEMBER+
- VIEWER: read, cannot pin or create tasks
- Platform admin mailbox onboarding / delegated mailbox: `PLATFORM_ADMIN`

## Mailbox OAuth

**Do not** use `/api/v1/auth/microsoft/callback` for mailbox connect.

| Mailbox | Callback |
|---------|----------|
| Gmail | `GET /api/v1/inbox-connections/google/callback` |
| Outlook | `GET /api/v1/inbox-connections/outlook/callback` |

Tokens are encrypted at rest (`TOKEN_ENCRYPTION_SECRET`, legacy alias `GOOGLE_TOKEN_ENCRYPTION_SECRET`) and never sent to the browser.
