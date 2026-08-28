import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const processorPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../application/processors/inbox-sync.processor.ts"
);

describe("inbox-sync audit writer contract", () => {
  it("sync_succeeded uses compact builder (no ...syncResult spread)", () => {
    const src = readFileSync(processorPath, "utf8");
    expect(src).toContain("buildInboxSyncSucceededAuditMetadata");
    expect(src).toContain('action: "inbox_connection.sync_succeeded"');
    // Must not spread full syncResult into audit metadata.
    expect(src).not.toMatch(
      /action:\s*"inbox_connection\.sync_succeeded"[\s\S]{0,400}\.\.\.syncResult/
    );
    expect(src).toContain("sanitizeAuditMetadata");
  });
});
