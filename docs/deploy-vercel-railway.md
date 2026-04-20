# Deployment: Vercel + Railway

**Target architecture:**

```
forgeops-inbox.app          → Vercel (static frontend)
api.forgeops-inbox.app      → Railway (API service)
                            → Railway (Worker service)
                            → Railway (Postgres)
                            → Railway (Redis)
```

---

## 1. DNS Records (Porkbun)

Add these DNS records for `forgeops-inbox.app`:

| Type  | Host | Value | TTL |
|-------|------|-------|-----|
| CNAME | `@` | `cname.vercel-dns.com` | 300 |
| CNAME | `www` | `cname.vercel-dns.com` | 300 |
| CNAME | `api` | `<your-railway-service>.up.railway.app` | 300 |

For the apex domain (`@`), Porkbun supports CNAME flattening, so a CNAME record works. If it doesn't, use Vercel's A records instead:

| Type | Host | Value |
|------|------|-------|
| A | `@` | `76.76.21.21` |
| AAAA | `@` | `2606:4700:20::681a:b33` |

The `api` CNAME value comes from Railway after you deploy the API service and add the custom domain.

---

## 2. Railway Setup

### 2a. Create project

1. Go to [railway.app](https://railway.app) and create a new project
2. Connect your GitHub repo

### 2b. Add Postgres

1. Click "New Service" → "Database" → "PostgreSQL"
2. Railway auto-provisions it and provides `DATABASE_URL`
3. Copy the connection string — you'll need it for API and Worker env vars

### 2c. Add Redis

1. Click "New Service" → "Database" → "Redis"
2. Railway provides `REDIS_URL`
3. Copy it

### 2d. Create API service

1. Click "New Service" → select your repo
2. **Settings:**
   - Root directory: `/` (monorepo root)
   - Build command: `npm install && npx prisma generate --schema packages/db/prisma/schema.prisma && npm run build`
   - Start command: `node apps/api/dist/main.js`
3. **Custom domain:** Add `api.forgeops-inbox.app`
4. **Environment variables:** (see section 4 below)

### 2e. Create Worker service

1. Click "New Service" → select your repo (same repo, different service)
2. **Settings:**
   - Root directory: `/`
   - Build command: `npm install && npx prisma generate --schema packages/db/prisma/schema.prisma && npm run build`
   - Start command: `node apps/worker/dist/main.js`
3. No custom domain needed (worker has no HTTP interface)
4. **Environment variables:** (see section 4 below)

### 2f. Run migrations

In the Railway API service shell (or via `railway run`):

```bash
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

### 2g. Seed admin access

In the Railway API service shell:

```bash
npx tsx packages/db/prisma/seed-approved-access.ts
```

Edit the seed file first to set your admin email if different from `24rochoa@gmail.com`.

---

## 3. Vercel Setup

### 3a. Create project

1. Go to [vercel.com](https://vercel.com) and import your repo
2. **Framework preset:** Vite
3. **Root directory:** `apps/web`
4. **Build command:** `npm run build` (Vercel runs this inside apps/web)
5. **Output directory:** `dist`
6. **Install command:** `cd ../.. && npm install && cd apps/web` (needed for monorepo workspace resolution)

### 3b. Environment variables

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://api.forgeops-inbox.app` |

### 3c. Custom domain

1. Go to project settings → Domains
2. Add `forgeops-inbox.app`
3. Vercel will verify the CNAME record from step 1

---

## 4. Environment Variables by Service

### Railway: API Service

```
NODE_ENV=production
HOST=0.0.0.0

DATABASE_URL=<from Railway Postgres>
REDIS_URL=<from Railway Redis>

FRONTEND_URL=https://forgeops-inbox.app

GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
GOOGLE_AUTH_REDIRECT_URI=https://api.forgeops-inbox.app/api/v1/auth/google/callback
GOOGLE_INBOX_REDIRECT_URI=https://api.forgeops-inbox.app/api/v1/inbox-connections/google/callback

SESSION_COOKIE_SECRET=<generate: openssl rand -hex 32>
TOKEN_ENCRYPTION_SECRET=<generate: openssl rand -hex 32>

DEV_ENABLE_BOOTSTRAP_ROUTES=true
DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=false

# Optional Outlook
OUTLOOK_CLIENT_ID=<from Azure AD>
OUTLOOK_CLIENT_SECRET=<from Azure AD>
OUTLOOK_REDIRECT_URI=https://api.forgeops-inbox.app/api/v1/inbox-connections/google/callback
OUTLOOK_TENANT_ID=common
```

Notes:
- Do NOT set `API_PORT` — Railway injects `PORT` automatically and the API reads it
- `FRONTEND_URL` must be the exact Vercel domain with `https://`
- `SESSION_COOKIE_SECRET` and `TOKEN_ENCRYPTION_SECRET` must be strong random values

### Railway: Worker Service

```
NODE_ENV=production

DATABASE_URL=<same as API>
REDIS_URL=<same as API>

GOOGLE_CLIENT_ID=<same as API>
GOOGLE_CLIENT_SECRET=<same as API>
GOOGLE_INBOX_REDIRECT_URI=https://api.forgeops-inbox.app/api/v1/inbox-connections/google/callback

TOKEN_ENCRYPTION_SECRET=<same as API>

WORKER_CONCURRENCY=5

# Optional Outlook
OUTLOOK_CLIENT_ID=<same as API>
OUTLOOK_CLIENT_SECRET=<same as API>
OUTLOOK_TENANT_ID=common
```

### Vercel: Frontend

```
VITE_API_URL=https://api.forgeops-inbox.app
```

---

## 5. Google OAuth Configuration

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → your OAuth 2.0 Client:

**Authorized redirect URIs:**
- `https://api.forgeops-inbox.app/api/v1/auth/google/callback`
- `https://api.forgeops-inbox.app/api/v1/inbox-connections/google/callback`

**Authorized JavaScript origins:**
- `https://forgeops-inbox.app`
- `https://api.forgeops-inbox.app`

If the app is still in "Testing" mode in Google Cloud, either publish it or add your test users.

---

## 6. Deployment Order

1. **DNS:** Add all records in Porkbun (they take 5-30 min to propagate)
2. **Railway Postgres + Redis:** Create and note connection strings
3. **Railway API:** Deploy with env vars, add custom domain `api.forgeops-inbox.app`
4. **Railway migrations:** Run `prisma migrate deploy` in the API service shell
5. **Railway seed:** Run the admin seed script
6. **Railway Worker:** Deploy with env vars
7. **Google Cloud:** Add production redirect URIs
8. **Vercel:** Deploy with `VITE_API_URL` set, add custom domain `forgeops-inbox.app`
9. **Smoke test:** Open `https://forgeops-inbox.app`, sign in, connect inbox, sync, analyze

---

## 7. Start Commands Reference

| Service | Command |
|---------|---------|
| API | `node apps/api/dist/main.js` |
| Worker | `node apps/worker/dist/main.js` |
| Frontend | Static files served by Vercel (no server) |
| Migrations | `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` |
| Seed admin | `npx tsx packages/db/prisma/seed-approved-access.ts` |
| Generate Prisma | `npx prisma generate --schema packages/db/prisma/schema.prisma` |

---

## 8. Post-Deploy Verification

- [ ] `https://forgeops-inbox.app` loads the landing page
- [ ] `https://api.forgeops-inbox.app/api/v1/health` returns `{"status":"ok"}`
- [ ] Sign in with approved email works
- [ ] Sign in with unapproved email shows access-denied
- [ ] Gmail connect flow redirects correctly through Google and back
- [ ] Sync and analyze complete without errors
- [ ] Inbox messages load in the dashboard

---

## Troubleshooting

**Cookies not working (session lost on API calls):**
The API sets `sameSite: "none"` + `secure: true` when detecting cross-origin between `forgeops-inbox.app` and `api.forgeops-inbox.app`. Verify CORS is set to `https://forgeops-inbox.app` in the API's `FRONTEND_URL`.

**Railway PORT conflict:**
Do NOT set `API_PORT` in Railway env vars. Railway injects `PORT` automatically. The API reads `PORT` first, then falls back to `API_PORT`.

**Vercel build fails:**
Set the install command to `cd ../.. && npm install && cd apps/web` so npm workspace resolution works from the monorepo root.

**Google OAuth redirect mismatch:**
The redirect URIs in Google Cloud Console must exactly match `GOOGLE_AUTH_REDIRECT_URI` and `GOOGLE_INBOX_REDIRECT_URI` in the API env vars, including the `https://` prefix and no trailing slash.
