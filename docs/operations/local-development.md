# Local development

Canonical local workflow. Environment isolation and production deploy: [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

## Stack that runs locally

| Service | Command | Default |
|---------|---------|---------|
| Postgres 16 + Redis 7 | `docker compose up -d` | `localhost:5432` (`forgeops_dev`), `localhost:6379` |
| API | `npm run dev:api` | http://localhost:3000 |
| Worker | `npm run dev:worker` | BullMQ on **local** Redis |
| Web | `npm run dev:web` | http://localhost:5173 (proxies `/api`) |

Copy `.env.example` → `.env`. Required minimum is documented in `DEPLOYMENT.md`. Keep `APP_ENV=development` and `ALLOW_REMOTE_INFRA=false`.

The same real Outlook mailbox may be connected to local **and** production. That is supported: tokens and `EmailMessage` rows are per-database. Duplicate provider ids across environments are expected.

Do **not** register Graph push webhooks against localhost unless `ALLOW_DEV_GRAPH_WEBHOOKS=true` (intentional tunnel only).

## Commands (from package.json)

| Command | What it runs |
|---------|----------------|
| `npm run build` | `tsc -b tsconfig.projects.json` |
| `npm run typecheck` | `tsc -b tsconfig.projects.json --pretty` |
| `npm run db:generate` | Prisma generate |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:migrate:deploy` | guarded `prisma migrate deploy` |
| `npm run db:reset:dev` | guarded `prisma migrate reset` (local only) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed-access` | upsert `ApprovedAccess` |
| `npm run db:cleanup-audit` | AuditEvent cleanup (dry-run unless `--commit`) |
| `npm run evaluate:job-matcher` | historical eval CLI (needs compiled API + `DATABASE_URL`) |

## Testing

There is **no** root `test` script. Per workspace:

```bash
npm test --workspace @forgeops/shared
npm test --workspace @forgeops/api
npm test --workspace @forgeops/worker
npm test --workspace @forgeops/web
npm test --workspace @forgeops/ai
npm test --workspace @forgeops/native-classification
```

`@forgeops/web` has `test` and `build` (`tsc -b && vite build`) but no `typecheck` script — root `npm run typecheck` still typechecks web via project references.

`@forgeops/db` has typecheck/build, no test script.

Most unit tests are mocked. Docker init also creates `forgeops_test`; it is optional.

## Operator scripts

| Script | Use |
|--------|-----|
| Matcher eval | [`matcher-evaluation.md`](matcher-evaluation.md) — Railway API shell, never local production URL |
| Audit cleanup | [`../../packages/db/scripts/AUDIT_EVENT_CLEANUP.md`](../../packages/db/scripts/AUDIT_EVENT_CLEANUP.md) |
| Allowlist seed | `npm run db:seed-access` |

## UI

Vite **dev** server shows a DEVELOPMENT badge in the sidebar. Production builds never render it.
