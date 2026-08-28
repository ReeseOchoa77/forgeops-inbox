/**
 * Explicit AuditEvent cleanup — NEVER run automatically on deploy.
 *
 * Usage:
 *   npm run db:cleanup-audit
 *   npm run db:cleanup-audit -- --commit
 *   npm run db:cleanup-audit -- --sync-succeeded-only --retain-days 7
 *   npm run db:cleanup-audit -- --sync-succeeded-only --retain-days 7 --commit
 *
 * After large DELETEs in production:
 *   - DELETE marks pages reusable (table size may not shrink on disk immediately)
 *   - VACUUM (or autovacuum) reclaims for reuse within PostgreSQL
 *   - VACUUM FULL rewrites the table and shrinks disk use but takes a strong lock —
 *     only run during a maintenance window if disk recovery is required. Do NOT
 *     run VACUUM FULL from this script.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import {
  AUDIT_OPERATIONAL_ACTIONS,
  AUDIT_OPERATIONAL_RETENTION_DAYS,
  operationalAuditCutoffDate,
} from "@forgeops/shared";

type CliOptions = {
  commit: boolean;
  syncSucceededOnly: boolean;
  retainDays: number;
  batchSize: number;
};

function parseArgs(argv: string[]): CliOptions {
  const commit = argv.includes("--commit");
  const syncSucceededOnly = argv.includes("--sync-succeeded-only");
  const retainIdx = argv.indexOf("--retain-days");
  const batchIdx = argv.indexOf("--batch-size");
  const retainDays =
    retainIdx >= 0 && argv[retainIdx + 1]
      ? Math.max(0, Number(argv[retainIdx + 1]))
      : syncSucceededOnly
        ? 7
        : AUDIT_OPERATIONAL_RETENTION_DAYS;
  const batchSize =
    batchIdx >= 0 && argv[batchIdx + 1]
      ? Math.max(100, Number(argv[batchIdx + 1]))
      : 2000;

  if (Number.isNaN(retainDays) || Number.isNaN(batchSize)) {
    throw new Error("Invalid --retain-days or --batch-size");
  }

  return { commit, syncSucceededOnly, retainDays, batchSize };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const cutoff = operationalAuditCutoffDate(new Date(), opts.retainDays);
  const actions: string[] = opts.syncSucceededOnly
    ? ["inbox_connection.sync_succeeded"]
    : [...AUDIT_OPERATIONAL_ACTIONS];

  console.log("audit-event-cleanup", {
    mode: opts.commit ? "COMMIT" : "DRY_RUN",
    actions,
    retainDays: opts.retainDays,
    cutoff: cutoff.toISOString(),
    batchSize: opts.batchSize,
  });

  type SizeRow = {
    action: string;
    row_count: bigint;
    metadata_bytes: bigint | null;
  };

  const grouped = await prisma.$queryRaw<SizeRow[]>(Prisma.sql`
    SELECT
      action,
      COUNT(*)::bigint AS row_count,
      COALESCE(SUM(pg_column_size(metadata)), 0)::bigint AS metadata_bytes
    FROM "AuditEvent"
    WHERE action IN (${Prisma.join(actions)})
      AND "createdAt" < ${cutoff}
    GROUP BY action
    ORDER BY SUM(pg_column_size(metadata)) DESC NULLS LAST
  `);

  let totalRows = 0;
  let totalBytes = 0;
  for (const row of grouped) {
    const count = Number(row.row_count);
    const bytes = Number(row.metadata_bytes ?? 0);
    totalRows += count;
    totalBytes += bytes;
    console.log("eligible-by-action", {
      action: row.action,
      rows: count,
      metadataBytes: bytes,
      metadataSize: formatBytes(bytes),
      avgMetadataBytes: count > 0 ? Math.round(bytes / count) : 0,
    });
  }

  console.log("eligible-total", {
    rows: totalRows,
    metadataBytes: totalBytes,
    metadataSize: formatBytes(totalBytes),
  });

  if (!opts.commit) {
    console.log(
      "dry-run-complete: no rows deleted. Re-run with --commit to delete eligible rows."
    );
    console.log(
      "post-delete-notes: run VACUUM (not VACUUM FULL) during off-peak if needed; VACUUM FULL only for disk reclaim under lock."
    );
    await prisma.$disconnect();
    return;
  }

  if (totalRows === 0) {
    console.log("nothing-to-delete");
    await prisma.$disconnect();
    return;
  }

  let deleted = 0;
  for (;;) {
    const batch = await prisma.auditEvent.findMany({
      where: {
        action: { in: actions },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      take: opts.batchSize,
      orderBy: { createdAt: "asc" },
    });
    if (batch.length === 0) break;
    const result = await prisma.auditEvent.deleteMany({
      where: { id: { in: batch.map((r) => r.id) } },
    });
    deleted += result.count;
    console.log("deleted-batch", {
      deletedBatch: result.count,
      deletedTotal: deleted,
    });
  }

  console.log("commit-complete", {
    deleted,
    retainDays: opts.retainDays,
    cutoff: cutoff.toISOString(),
  });
  console.log(
    "vacuum-guidance: pages are reusable after DELETE. Prefer autovacuum/VACUUM; use VACUUM FULL only in a maintenance window if you must shrink disk."
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("audit-event-cleanup-failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
