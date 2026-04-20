# Deployment Checklist

## Pre-Deployment Setup

### Infrastructure

- [ ] PostgreSQL accessible and connection string ready
- [ ] Redis accessible and connection string ready
- [ ] API host provisioned (Railway, Render, Fly.io, VPS, etc.)
- [ ] Frontend static hosting provisioned (Vercel, Netlify, Cloudflare Pages, or same host as API)
- [ ] Worker process can run on same or separate host as API

### Google OAuth

- [ ] Google Cloud project exists with Gmail API enabled
- [ ] OAuth 2.0 Client ID created (Web application type)
- [ ] Production redirect URIs added to Google Cloud Console:
  - `https://YOUR_API_DOMAIN/api/v1/auth/google/callback`
  - `https://YOUR_API_DOMAIN/api/v1/inbox-connections/google/callback`
- [ ] Production frontend origin added to Authorized JavaScript Origins:
  - `https://YOUR_FRONTEND_DOMAIN`
- [ ] App published or test users added (if still in Testing mode)

### Outlook OAuth (optional)

- [ ] Azure AD app registered with redirect URI:
  - `https://YOUR_API_DOMAIN/api/v1/inbox-connections/google/callback` (shared callback)
- [ ] Client ID and secret available

### Environment Variables

**API (.env or host config):**

```
NODE_ENV=production
HOST=0.0.0.0
API_PORT=3000

DATABASE_URL=postgresql://user:pass@host:5432/forgeops
DIRECT_URL=postgresql://user:pass@host:5432/forgeops
REDIS_URL=redis://host:6379

FRONTEND_URL=https://YOUR_FRONTEND_DOMAIN

GOOGLE_CLIENT_ID=<from Google Cloud>
GOOGLE_CLIENT_SECRET=<from Google Cloud>
GOOGLE_AUTH_REDIRECT_URI=https://YOUR_API_DOMAIN/api/v1/auth/google/callback
GOOGLE_INBOX_REDIRECT_URI=https://YOUR_API_DOMAIN/api/v1/inbox-connections/google/callback

SESSION_COOKIE_SECRET=<random 64+ char string>
TOKEN_ENCRYPTION_SECRET=<random 64+ char string>

DEV_ENABLE_BOOTSTRAP_ROUTES=true
DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=false

# Optional Outlook
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
OUTLOOK_REDIRECT_URI=https://YOUR_API_DOMAIN/api/v1/inbox-connections/google/callback
OUTLOOK_TENANT_ID=common
```

**Worker (.env or host config):**

Same DATABASE_URL, REDIS_URL, TOKEN_ENCRYPTION_SECRET, and Google/Outlook credentials as API.

**Frontend (build-time only):**

```
VITE_API_URL=https://YOUR_API_DOMAIN
```

Leave empty if frontend and API share the same origin behind a reverse proxy.

- [ ] All API env vars set on host
- [ ] All Worker env vars set on host
- [ ] Frontend built with correct VITE_API_URL
- [ ] SESSION_COOKIE_SECRET is a strong random value (not the dev default)
- [ ] TOKEN_ENCRYPTION_SECRET is a strong random value (not the dev default)

### Database

- [ ] Migrations applied: `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`
- [ ] Admin email seeded: edit `packages/db/prisma/seed-approved-access.ts` then run `npx tsx packages/db/prisma/seed-approved-access.ts`
- [ ] Workspace exists (created by seed or by first approved sign-in with DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=true temporarily)

### Build & Deploy

- [ ] Backend built: `npm run build` (from repo root)
- [ ] Frontend built: `cd apps/web && VITE_API_URL=https://YOUR_API_DOMAIN npx vite build`
- [ ] Frontend static files deployed (`apps/web/dist/`)
- [ ] API started: `node apps/api/dist/main.js`
- [ ] Worker started: `node apps/worker/dist/main.js`

---

## Smoke-Test Checklist

Run these in order after deployment. Use a browser with no cached state (incognito recommended).

### Authentication

- [ ] Visit frontend URL → landing page loads with "Sign in with Google" button
- [ ] Click sign in → Google account picker appears (not auto-sign-in)
- [ ] Sign in with an **unapproved** email → redirected to access-denied page
- [ ] Access-denied page shows clear message and "Try a different account" link
- [ ] Sign in with the **approved/seeded** email → redirected into the app
- [ ] App shell loads: sidebar, topbar, workspace name visible
- [ ] User email shown in sidebar footer
- [ ] Click "Sign out" → returned to landing page
- [ ] Visiting any app URL after sign-out → landing page (not app)

### Team Access

- [ ] Navigate to Team Access → approved email list loads
- [ ] Add a new email with "Member" role → appears in the list
- [ ] Revoke the new email → moves to "revoked" section
- [ ] Sign in as the revoked email → access denied

### Inbox Connections

- [ ] Navigate to Connections → page loads with "Add an Inbox" section
- [ ] Click "Connect Gmail" → redirected to Google consent screen
- [ ] Complete Google consent → redirected back to app with success banner
- [ ] New connection appears in Connections with green "Connected" status
- [ ] Email address and provider label (Gmail) shown correctly

### Sync & Analyze

- [ ] Click "Sync Now" on the connection → loading state appears
- [ ] Sync completes → success banner with thread/message counts
- [ ] Connection card shows updated "Last synced" timestamp
- [ ] Click "Analyze" → loading state appears
- [ ] Analysis completes → success banner with classified/task counts

### Inbox View

- [ ] Navigate to Inbox → messages load in table
- [ ] Messages show sender, subject, category badge, priority badge, confidence, date
- [ ] Click a message → detail view loads
- [ ] Detail shows: header, classification card, task card (if extracted), email body
- [ ] "Show raw" / "Show cleaned" toggle works on body text
- [ ] Debug metadata section expands with IDs and timestamps
- [ ] "Back to Inbox" returns to list

### Tasks View

- [ ] Navigate to Tasks → task cards load
- [ ] Each card shows title, summary, priority, status, confidence, assignee guess, due date
- [ ] Source email and classification shown in footer

### Review Queue

- [ ] Navigate to Review Queue → items load (if any exist)
- [ ] Each item shows subject, classification, confidence, review reasons
- [ ] Click "Correct" → item disappears from queue
- [ ] Click "Incorrect" → item disappears from queue
- [ ] If queue is empty → "All clear" empty state appears

### Data Import (optional)

- [ ] Navigate to Data Import → tabs for Customers, Vendors, Jobs
- [ ] Upload a CSV → import results show created/updated/skipped counts
- [ ] Import same CSV again → all records show as "updated" (idempotent)

### Connection Dropdown

- [ ] If multiple connections exist → dropdown in topbar works
- [ ] Switching connections → Inbox/Tasks/Review reload for selected connection

---

## Known Risks & Limitations

| Area | Status | Notes |
|------|--------|-------|
| HTTPS required | Required | Session cookies set `secure: true` in production. HTTP will not work. |
| Session duration | 7 days default | Configurable via `SESSION_TTL_SECONDS`. No refresh mechanism. |
| Sync is manual | By design | No auto-sync scheduling. Users must click "Sync Now". |
| Classification is heuristic | By design | Keyword-based, not ML. OpenAI integration is scaffolded but not wired. |
| No CSRF protection | Known gap | Not yet implemented. Low risk for internal-only access. |
| No rate limiting | Known gap | Not yet implemented. Acceptable for small internal team. |
| No test suite | Known gap | No automated tests. Manual smoke-testing only. |
| Gmail API quota | Google-imposed | Default quota is 250 requests per user per second. Large inboxes may need multiple syncs. |
| Outlook requires Azure AD | Configuration | Requires Azure AD app registration. Not all tenants allow third-party apps. |
| DB column naming | Tech debt | `gmailThreadId`/`gmailMessageId` columns store all provider IDs. Provider-neutral columns exist but reads haven't fully migrated. |
