# Database migrations

Canonical migration **rules** live in [`../DEPLOYMENT.md`](../DEPLOYMENT.md#database-migrations). This page is the short operator reference.

Schema: `packages/db/prisma/schema.prisma`. SQL: `packages/db/prisma/migrations/`.

## Commands

| Environment | Root script | Actual tool |
|-------------|-------------|-------------|
| Development | `npm run db:migrate` | `prisma migrate dev` against `forgeops_dev` |
| Development reset | `npm run db:reset:dev` | Guarded `prisma migrate reset --force` |
| Production | `npm run db:migrate:deploy` | `packages/db/scripts/migrate-deploy.ts` → `prisma migrate deploy` |

Prisma datasource uses `DATABASE_URL` and `DIRECT_URL`. Local `.env.example` sets both to the same localhost URL. Production `DIRECT_URL` must be the URL Prisma migrate can reach (Railway often needs the unpooled/direct connection). The evaluator copies `DATABASE_URL` into `DIRECT_URL` if missing — that is eval-only, not a migrate policy.

## Guards

`db:reset:dev` refuses unless:

- `APP_ENV=development`
- `ALLOW_PRODUCTION_MIGRATE` is not true
- `DATABASE_URL` / `DIRECT_URL` host is local

`db:migrate:deploy` allows production-labeled deploy when `APP_ENV=production` **or** `ALLOW_PRODUCTION_MIGRATE=true`, and refuses production-labeled migrate against localhost unless `ALLOW_LOCAL_PROD_INFRA=true`.

## Never against production

- `prisma migrate dev`
- `prisma migrate reset`
- `prisma db push`
- Pointing Cursor `.env` at production `DATABASE_URL`

Production migrate only when the user explicitly requests production deployment.
