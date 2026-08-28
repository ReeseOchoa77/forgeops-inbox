import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AUDIT_OPERATIONAL_ACTIONS,
  operationalAuditCutoffDate,
} from "@forgeops/shared";

describe("audit cleanup script contract", () => {
  const scriptPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/db/scripts/cleanup-audit-events.ts"
  );

  it("defaults to dry-run and requires --commit to delete", () => {
    const src = readFileSync(scriptPath, "utf8");
    expect(src).toContain('mode: opts.commit ? "COMMIT" : "DRY_RUN"');
    expect(src).toContain("dry-run-complete: no rows deleted");
    expect(src).toContain("deleteMany");
    expect(src).toContain("--sync-succeeded-only");
    // Script must not execute VACUUM FULL (comments/docs may mention it).
    expect(src).not.toMatch(/\$executeRaw[\s\S]{0,80}VACUUM\s+FULL/i);
    expect(src).not.toMatch(/prisma\.\$queryRaw[\s\S]{0,80}VACUUM\s+FULL/i);
  });

  it("targets only operational actions (or sync_succeeded-only)", () => {
    expect(AUDIT_OPERATIONAL_ACTIONS).toContain(
      "inbox_connection.sync_succeeded"
    );
    expect(AUDIT_OPERATIONAL_ACTIONS).not.toContain(
      "inbox_connection.sync_failed"
    );
    const cutoff = operationalAuditCutoffDate(
      new Date("2026-08-28T00:00:00.000Z"),
      7
    );
    expect(cutoff.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });
});
