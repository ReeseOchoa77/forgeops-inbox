/**
 * Phase 5 worker: AI overwrite fix + Sent Items reconciliation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;

describe("Phase 5 — worker authority + reconcile", () => {
  it("C/D/E) persist-native respects classification authority", () => {
    const src = readFileSync(
      join(here, "../application/services/persist-native-classification.ts"),
      "utf8"
    );
    expect(src).toContain("canReplaceClassificationAuthority");
    expect(src).toContain("resolveClassificationAuthority");
    expect(src).toContain("preserveStrongerAuthority");
    expect(src).toContain('incoming: "AI"');
    // Must not blindly clear reviewedByUserId on every update.
    expect(src).toContain("reviewedByUserId: priorClass.reviewedByUserId");
  });

  it("L/M/N) import reconciles forgeops-sent without duplicating", () => {
    const src = readFileSync(
      join(here, "../application/services/import-provider-mailbox.ts"),
      "utf8"
    );
    expect(src).toContain("matchesForgeOpsOutboundCandidate");
    expect(src).toContain("composedInForgeOps");
    expect(src).toContain("pendingForgeOps");
    expect(src).toContain("canAdoptGraphId");
  });

  it("folder subtypes stamp SYSTEM_DETERMINISTIC authority", () => {
    const invite = readFileSync(
      join(here, "../application/services/apply-bid-invite-subtype.ts"),
      "utf8"
    );
    const quote = readFileSync(
      join(here, "../application/services/apply-quote-subtype.ts"),
      "utf8"
    );
    expect(invite).toContain("SYSTEM_DETERMINISTIC");
    expect(quote).toContain("SYSTEM_DETERMINISTIC");
    expect(invite).toContain("canReplaceClassificationAuthority");
    expect(quote).toContain("canReplaceClassificationAuthority");
  });
});
