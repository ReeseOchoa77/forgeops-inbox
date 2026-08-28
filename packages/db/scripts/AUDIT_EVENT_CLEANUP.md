# AuditEvent retention & cleanup

## Problem (production)

`inbox_connection.sync_succeeded` rows stored full Graph delta links (`newestSyncCursor`),
message ID arrays, and attachment ingest candidates (including `bodyHtml`) in
`AuditEvent.metadata` (~155 KB/row average → ~260 MB for ~1672 rows).

## Going forward

- Sync success metadata is compact counts/booleans only (no cursor, no ID arrays).
- View telemetry (`*_viewed`) is application logs only — not written to AuditEvent.
- Operational actions have a **30-day** retention policy in code (`@forgeops/shared`).
- Cleanup is **manual only** — never runs on deploy.

## Dry-run (safe)

```bash
npx tsx packages/db/scripts/cleanup-audit-events.ts
```

Reports eligible rows + `pg_column_size(metadata)` grouped by action.

## Targeted bloated sync_succeeded recovery

Keep a short recent window (default 7 days when `--sync-succeeded-only`), delete the rest:

```bash
# Dry-run first
npx tsx packages/db/scripts/cleanup-audit-events.ts --sync-succeeded-only --retain-days 7

# Explicit commit
npx tsx packages/db/scripts/cleanup-audit-events.ts --sync-succeeded-only --retain-days 7 --commit
```

## Standard operational retention (30 days)

```bash
npx tsx packages/db/scripts/cleanup-audit-events.ts --retain-days 30
npx tsx packages/db/scripts/cleanup-audit-events.ts --retain-days 30 --commit
```

Eligible actions: sync_started/succeeded, analysis_started/succeeded, and legacy `*_viewed` rows.

**Not deleted:** auth, permission changes, sync_failed, imports, sends, clears, manual corrections, etc.

## After DELETE (PostgreSQL)

| Step | Effect |
|------|--------|
| `DELETE` | Marks pages reusable; on-disk table size may not drop immediately |
| `VACUUM` / autovacuum | Reclaims space for reuse inside PostgreSQL |
| `VACUUM FULL` | Physically rewrites/shrinks table; **strong lock** — maintenance window only |

Do **not** run `VACUUM FULL` from the cleanup script. Prefer autovacuum after DELETE; only `VACUUM FULL "AuditEvent"` if disk reclaim is required and you can lock the table.
