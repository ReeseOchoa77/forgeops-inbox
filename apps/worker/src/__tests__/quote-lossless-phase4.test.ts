/**
 * Phase 4 worker: lossless Projects/Quotes → EmailMessage + ESTIMATE_QUOTE.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyDeterministicQuoteSubtype } from "../application/services/apply-quote-subtype.js";

const here = import.meta.dirname;

describe("Phase 4 — Quotes lossless ingestion", () => {
  it("A/B) Quotes scan imports EmailMessage before matching", () => {
    const processor = readFileSync(
      join(here, "../application/processors/bid-email-analyze.processor.ts"),
      "utf8"
    );
    expect(processor).toContain("importProviderMailbox");
    expect(processor).toContain('phase === "QUOTES"');
    expect(processor).toContain("applyDeterministicQuoteSubtype");
    // Import happens for both phases before role-specific subtype.
    expect(processor.indexOf("importProviderMailbox")).toBeLessThan(
      processor.indexOf("applyDeterministicQuoteSubtype")
    );
  });

  it("D) no AI subtype for Quotes folder provenance", () => {
    const src = readFileSync(
      join(here, "../application/services/apply-quote-subtype.ts"),
      "utf8"
    );
    expect(src).toContain("quotes_folder");
    expect(src).toContain('businessTypeKey: "ESTIMATE_QUOTE"');
    expect(src).not.toMatch(/openai|generateObject|chat\.completions/i);
    expect(src).toContain("Does NOT mutate EmailMessage.direction");
  });

  it("C) applyDeterministicQuoteSubtype sets ESTIMATE_QUOTE", async () => {
    const upsert = vi.fn(async () => ({}));
    const prisma = {
      emailMessage: {
        findMany: vi.fn(async () => [
          { id: "e1", threadId: "t1", classifications: [] },
        ]),
        update: vi.fn(),
      },
      classification: { upsert },
    };
    await applyDeterministicQuoteSubtype({
      prisma: prisma as never,
      workspaceId: "ws",
      emailMessageIds: ["e1"],
    });
    expect(upsert.mock.calls[0]![0].create.businessTypeKey).toBe(
      "ESTIMATE_QUOTE"
    );
  });

  it("E/F) import path uses provider direction (not folder-forced SENT)", () => {
    const importSrc = readFileSync(
      join(here, "../application/services/import-provider-mailbox.ts"),
      "utf8"
    );
    expect(importSrc).toContain("resolvedDirection");
    expect(importSrc).toMatch(/message\.direction === "SENT"/);
    // Quotes subtype must not set direction.
    const quoteSrc = readFileSync(
      join(here, "../application/services/apply-quote-subtype.ts"),
      "utf8"
    );
    expect(quoteSrc).not.toMatch(/direction:\s*["']SENT["']/);
  });

  it("persist-native preserves stronger folder/manual subtype authority", () => {
    const src = readFileSync(
      join(here, "../application/services/persist-native-classification.ts"),
      "utf8"
    );
    expect(src).toContain("canReplaceClassificationAuthority");
    expect(src).toContain("preserveStrongerAuthority");
  });

  it("N) quote-first / staging respect user_confirmed Quote links", () => {
    const qf = readFileSync(
      join(here, "../application/services/quote-first-reconstruction.ts"),
      "utf8"
    );
    const staging = readFileSync(
      join(here, "../application/services/bid-email-staging-pipeline.ts"),
      "utf8"
    );
    expect(qf).toContain("quoteUserLocked");
    expect(staging).toContain("quoteUserLocked");
    expect(staging).toContain("manualAssociationPreserved");
  });

  it("V) matched Quotes set isDurable (no duplicate EmailMessage create)", () => {
    const qf = readFileSync(
      join(here, "../application/services/quote-first-reconstruction.ts"),
      "utf8"
    );
    expect(qf).toContain("isDurable: true");
    expect(qf).toContain('role: "QUOTE"');
    // Reconstruction updates staging / upserts links — does not create EmailMessage.
    expect(qf).not.toMatch(/emailMessage\.create/);
  });
});
