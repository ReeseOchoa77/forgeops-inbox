# ForgeOps deployment & environment safety

**Core rule:** Implementation complete ≠ production deployed.

Normal workflow:

```
code change
  → local development (localhost)
  → automated tests
  → typecheck / build
  → user tests & approves locally
  → explicit production deployment instruction
  → production migration / deploy
  → production verification
```

Cursor (and any agent) must **STOP before the production deployment step** unless the user explicitly asks to deploy.

Related runbooks: `docs/deploy-vercel-railway.md`, `docs/deployment-checklist.md`.

---

## LOCAL DEVELOPMENT

### What runs locally

| Service | Command | Default |
|---------|---------|---------|
| Postgres + Redis | `docker compose up -d` | `localhost:5432` (`forgeops_dev`), `localhost:6379` |
| API | `npm run dev:api` | `http://localhost:3000` |
| Worker | `npm run dev:worker` | process (BullMQ consumer on **local** Redis) |
| Web | `npm run dev:web` | `http://localhost:5173` (proxies `/api` → API) |

### Required local env

Copy `.env.example` → `.env` at the repo root (and optionally `apps/api/.env`, `apps/worker/.env`).

Minimum:

```bash
APP_ENV=development
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgeops_dev?schema=public
DIRECT_URL=postgresql://postgres:postgres@localhost:5432/forgeops_dev?schema=public
REDIS_URL=redis://localhost:6379
FRONTEND_URL=http://localhost:5173
ALLOW_REMOTE_INFRA=false
ALLOW_DEV_GRAPH_WEBHOOKS=false
```

Optional for full features: OpenAI, Google/Outlook OAuth client credentials with **localhost** redirect URIs, a **separate development** S3 bucket.

### Prisma (development only)

```bash
docker compose up -d
npm run db:generate
npm run db:migrate          # prisma migrate dev — forgeops_dev only
```

Never point these at production.

### Development data reset (local only)

```bash
npm run db:reset:dev
```

Fail-closed: refuses unless `APP_ENV=development` **and** `DATABASE_URL` host is local.  
Never use `prisma migrate reset` against production.

### Tests / typecheck / build

```bash
npm test --workspace @forgeops/shared
npm test --workspace @forgeops/api
npm test --workspace @forgeops/web
npm run typecheck
npm run build --workspace @forgeops/web
```

Optional isolated test DB name (created by docker init): `forgeops_test`. Most unit tests are mocked and do not require it.

### Development UI indicator

When the Vite **dev** server runs, the sidebar shows a subtle **DEVELOPMENT** badge next to ForgeOps. Production builds never render it (`import.meta.env.PROD` gate).

---

## LOCAL vs PRODUCTION DATA ISOLATION

**Rule:** Local development and production must never share PostgreSQL, Redis, OAuth token rows, Graph sync cursors, or attachment buckets.

| RESOURCE | DEVELOPMENT | PRODUCTION |
|----------|-------------|------------|
| Web | localhost:5173 | deployed (Vercel) |
| API | localhost:3000 | deployed (Railway) |
| Worker | local process | deployed (Railway) |
| PostgreSQL | docker `forgeops_dev` | Railway production |
| Redis / BullMQ | docker localhost:6379 | Railway production |
| Object storage | unset or **dev** bucket | production bucket |
| Outlook OAuth records | development DB only | production DB only |
| Graph sync state (`syncCursor`, `pushSubscriptionId`) | development DB only | production DB only |
| EmailMessage / Jobs / Tasks | development DB | production DB |
| OpenAI API key | shared credential OK* | production |
| n8n | usually disabled locally | production (if used) |

\* Shared OpenAI credentials are fine; **results still persist only to the environment’s own DB**.

### Email intake (local)

Local can authorize the same real Outlook mailbox via the normal OAuth flow. Tokens and `InboxConnection` rows live **only** in `forgeops_dev`.

Recommended V1 local intake:

1. Connect mailbox in local UI (localhost OAuth redirect).
2. Enable native listening in local DB only.
3. Use **manual Sync** and/or **Historical Import** (polling / Graph pull).
4. Do **not** register Graph push webhooks against localhost (blocked by default).

Duplicate provider messages across environments are expected and OK — separate ForgeOps `EmailMessage` rows, never shared IDs.

### Graph subscription safety

- Production owns production `pushSubscriptionId` values in the production DB.
- Development **skips** `register-push` unless `ALLOW_DEV_GRAPH_WEBHOOKS=true` (intentional tunnel only).
- Local boot must never delete/replace production Graph subscriptions.

### Outlook OAuth redirect URIs (manual Azure/Microsoft config)

Add **both** (do not remove production):

- Development: `http://localhost:3000/api/v1/inbox-connections/outlook/callback` (and auth callback if used)
- Production: `https://api.forgeops-inbox.com/api/v1/inbox-connections/outlook/callback` (or your live host)

### Object storage

Prefer a separate bucket (e.g. `forgeops-development`). Do not point local `S3_*` at the production bucket. Leave unset locally if attachments are not needed for the current task.

### n8n

Keep `N8N_INTEGRATION_ENABLED=false` locally when testing native Graph intake, so n8n cannot post into a mistaken production API URL from a shared automation workspace.

---

## PRODUCTION

Target topology (documented; configured in dashboards — not auto-changed by this repo):

```
forgeops-inbox.com       → Vercel (static web)
api.forgeops-inbox.com   → Railway (API)
                         → Railway (Worker)
                         → Railway (Postgres)
                         → Railway (Redis)
                         → S3 (attachments)
```

Set on every Railway service:

```bash
APP_ENV=production
NODE_ENV=production
```

Set on Vercel:

```bash
VITE_API_URL=https://api.forgeops-inbox.com
# Do NOT set VITE_APP_ENV=development
```

---

## ENVIRONMENT VARIABLES

| Variable | Purpose |
|----------|---------|
| `APP_ENV` | **Canonical ForgeOps environment:** `development` \| `production` |
| `NODE_ENV` | Runtime/build mode (`development` / `test` / `production`). Overloaded by tooling — do not rely on it alone. |
| `DATABASE_URL` / `DIRECT_URL` | Postgres |
| `REDIS_URL` | Redis / BullMQ / sessions |
| `FRONTEND_URL` | CORS origin + OAuth browser return (API) |
| `VITE_API_URL` | Browser API origin (web build) |
| `ALLOW_REMOTE_INFRA` | `true` only if local app may intentionally use remote DB/Redis |
| `ALLOW_LOCAL_PROD_INFRA` | `true` only for deliberate local production-mode smoke tests |
| `ALLOW_PRODUCTION_MIGRATE` | Escape hatch for `npm run db:migrate:deploy` outside `APP_ENV=production` |
| `ALLOW_DEV_GRAPH_WEBHOOKS` | Development-only; leave `false` unless using an intentional public tunnel for Graph push |

OAuth redirects, S3, OpenAI, n8n, Microsoft Graph — see `docs/deploy-vercel-railway.md`. **Never commit real secrets.**

### Fail-closed boot guards

API and worker call `assertEnvSafety` at startup:

- `APP_ENV=development` → `DATABASE_URL` / `REDIS_URL` must be localhost (or `ALLOW_REMOTE_INFRA=true`)
- `APP_ENV=production` → must not use localhost DB/Redis; weak default secrets rejected; `FRONTEND_URL` must not be localhost
- Production forces `DEV_ENABLE_BOOTSTRAP_ROUTES=false` and `DEV_AUTO_CREATE_WORKSPACE_ON_LOGIN=false`

Health: `GET /api/v1/health` includes `runtime.deploy.appEnv`.

---

## DATABASE MIGRATIONS

| Environment | Command | Notes |
|-------------|---------|-------|
| Development | `npm run db:migrate` | `prisma migrate dev` against local `forgeops_dev` |
| Development reset | `npm run db:reset:dev` | Guarded `prisma migrate reset` — local only |
| Production | `npm run db:migrate:deploy` | Guarded wrapper → `prisma migrate deploy` |

Production sequence (explicit deploy only):

1. Review migration SQL in `packages/db/prisma/migrations/`
2. Ensure Railway `APP_ENV=production` and production `DATABASE_URL`
3. Run **once** (Railway shell / `railway run` / CI with approval):  
   `npm run db:migrate:deploy`
4. Verify `/api/v1/health` and smoke checks
5. Never `prisma migrate dev`, `prisma db push`, or reset production

---

## GIT / DEPLOYMENT FLOW

| Action | Effect |
|--------|--------|
| Local edit / commit | No deploy |
| Push feature branch | No production deploy (unless a preview is configured in the dashboard) |
| Merge / push `main` | **Likely** triggers Railway + Vercel auto-deploy if GitHub is connected in those dashboards — **not defined in this repo** (no GitHub Actions deploy workflows) |

Recommended V1 workflow:

```
feature branch
  → localhost testing
  → tests / typecheck / build
  → user approval
  → merge to main (or explicit production deploy)
  → confirm Railway/Vercel deployment
  → run production migrate deploy if schema changed
  → smoke-test production
```

**Agents must not** `git push`, merge to `main`, trigger Railway/Vercel, or run production migrations unless the user explicitly requests production deployment.

---

## FIRST PRODUCTION DEPLOYMENT

Use the checklist at the end of this document (and `docs/deployment-checklist.md`). Do not treat “code merged” as “shop-ready” until smoke tests pass.

---

## ROLLBACK / FAILURE PROCEDURE

1. **App regression:** Redeploy previous known-good Railway/Vercel deployment (dashboard rollback). Do not “fix forward” blindly.
2. **Bad migration:** Stop API/worker if needed; restore Postgres from backup; only then redeploy. Prisma does not auto-rollback migrations.
3. **OAuth / CORS breakage:** Confirm `FRONTEND_URL`, `VITE_API_URL`, and provider redirect URIs match production hosts.
4. **Queue backlog / poison:** Inspect Redis/BullMQ; fix consumer; do not point a local worker at production Redis to “drain” jobs.

---

## FIRST DEPLOYMENT CHECKLIST

- [ ] Production Postgres provisioned (Railway); credentials only in Railway env
- [ ] Production Redis provisioned; **not** shared with local `.env`
- [ ] Production S3 bucket (separate from any personal/dev bucket)
- [ ] `APP_ENV=production` + `NODE_ENV=production` on API and worker
- [ ] Strong `SESSION_COOKIE_SECRET` and `TOKEN_ENCRYPTION_SECRET` (≥32 chars, unique)
- [ ] `FRONTEND_URL=https://forgeops-inbox.com` (or real web origin)
- [ ] `VITE_API_URL=https://api.forgeops-inbox.com` on Vercel
- [ ] OAuth redirect URIs registered for **production** API hosts (Google + Microsoft)
- [ ] CORS/origins match production web
- [ ] OpenAI keys set on API/worker as needed
- [ ] n8n webhook URL + API key (if enabled) point at production API
- [ ] Migrations reviewed → `npm run db:migrate:deploy` against production
- [ ] API health `GET /api/v1/health` → `ok`, `appEnv=production`
- [ ] Web loads; **no** DEVELOPMENT badge
- [ ] Smoke: login, Job create, Inbox sync, attachment open, worker jobs process
- [ ] Email send/reply if enabled
- [ ] Backup/restore plan for Postgres documented
- [ ] Confirm whether `main` auto-deploys; disable or gate if the team wants explicit promote

---

## KNOWN WEAKNESSES

- Auto-deploy on `main` is **platform-dashboard** behavior, not encoded in git — verify Railway/Vercel settings.
- No in-repo GitHub Actions CI yet.
- S3 bucket name is not auto-validated for “dev vs prod”; use separate buckets by convention.
- BullMQ queue names are shared; isolation = separate Redis instances.
- Local `.env` files are gitignored but a mis-copied production URL is still dangerous — guards mitigate, escape hatches exist.
- `docs/deploy-vercel-railway.md` vs handoff may disagree on apex vs `api.` OAuth hosts — register the URIs you actually use.
