# ForgeOps documentation map

This index is the entry point for architecture and operations. **Code is the source of truth.** If a document disagrees with Prisma, routes, workers, or UI, treat the code as correct and update the doc.

Status labels used in these docs:

| Label | Meaning |
|-------|---------|
| **IMPLEMENTED** | Present and used in the current system |
| **PARTIALLY IMPLEMENTED** | Exists, but incomplete or gated |
| **PLANNED / NOT IMPLEMENTED** | Described historically or desired; do not code against it |
| **DEPRECATED / LEGACY** | Still in schema/enums/paths but not the live workflow |

## Canonical documents (one home per subsystem)

| Subsystem | Canonical doc |
|-----------|----------------|
| Onboarding / repo map | [`../README.md`](../README.md) |
| High-level architecture, queues, AI vs deterministic, UI scale | [`architecture/overview.md`](architecture/overview.md) |
| Email ingest, Sent Items, compose reconcile, attachments | [`architecture/email-ingestion.md`](architecture/email-ingestion.md) |
| Mailbox category, subtypes, classification authority | [`architecture/email-classification.md`](architecture/email-classification.md) |
| Job matcher, contacts, authoritative assignment, auto-assign | [`architecture/job-matching.md`](architecture/job-matching.md) |
| Active Bids / BidCandidate, quotes, conversion | [`architecture/bidding-active-bids.md`](architecture/bidding-active-bids.md) |
| Tasks, calendar, pinning | [`architecture/tasks-calendar.md`](architecture/tasks-calendar.md) |
| Object storage, attachments, Job files | [`architecture/storage.md`](architecture/storage.md) |
| Login, allowlist, roles, mailbox OAuth | [`architecture/auth.md`](architecture/auth.md) |
| Inbox UX / filters / search | [`product/inbox.md`](product/inbox.md) |
| Jobs, numbering, restore | [`product/jobs.md`](product/jobs.md) |
| Customers (select-or-create, Company Data) | [`product/customers.md`](product/customers.md) |
| Active Bids product surface | [`product/active-bids.md`](product/active-bids.md) |
| Local setup, tests, commands | [`operations/local-development.md`](operations/local-development.md) |
| Env isolation, Railway, Vercel, migrate deploy | [`DEPLOYMENT.md`](DEPLOYMENT.md) |
| Migration commands and guards | [`operations/database-migrations.md`](operations/database-migrations.md) |
| Historical matcher evaluator | [`operations/matcher-evaluation.md`](operations/matcher-evaluation.md) |
| Clear Inbox / Clear All / provider delete | [`operations/email-clearing.md`](operations/email-clearing.md) |
| Railway/Vercel dashboard setup | [`deploy-vercel-railway.md`](deploy-vercel-railway.md) |
| First-deploy checklist | [`deployment-checklist.md`](deployment-checklist.md) |
| Optional n8n ingest contract | [`n8n-integration.md`](n8n-integration.md) |
| Non-negotiable project rules | [`project-rules.md`](project-rules.md) |
| AuditEvent cleanup | [`../packages/db/scripts/AUDIT_EVENT_CLEANUP.md`](../packages/db/scripts/AUDIT_EVENT_CLEANUP.md) |

## Redirects (legacy filenames)

These files remain so old links do not 404. They are not the detailed source:

- [`architecture.md`](architecture.md)
- [`file-structure.md`](file-structure.md)
- [`product-spec.md`](product-spec.md)
- [`PROJECT-HANDOFF.md`](PROJECT-HANDOFF.md)
