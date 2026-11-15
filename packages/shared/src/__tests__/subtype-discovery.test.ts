import { describe, expect, it } from "vitest";
import {
  classifyClusterAgainstTaxonomy,
  clusterByCosineConnectedComponents,
  existingSubtypeOverlap,
  fnv1a32,
  minimizeBoilerplate,
  prepareEmailForDiscovery,
  prepareEmailsForDiscovery,
  resolveRequestedSampleSize,
  sampleEmailsDeterministic,
  validateDiscoveryConfig,
} from "../subtype-discovery/index.js";

describe("subtype discovery sampling", () => {
  it("resolves presets and caps custom", () => {
    expect(resolveRequestedSampleSize({ samplePreset: "500", customCount: null }, 1000)).toEqual({
      requested: 500,
      preset: "500",
    });
    expect(
      resolveRequestedSampleSize({ samplePreset: "ALL_ELIGIBLE", customCount: null }, 100)
    ).toEqual({ requested: null, preset: "ALL_ELIGIBLE" });
    expect(
      resolveRequestedSampleSize({ samplePreset: "CUSTOM", customCount: 50 }, 1000).requested
    ).toBe(50);
  });

  it("samples deterministically across strata (not newest-only)", () => {
    const candidates = Array.from({ length: 100 }, (_, i) => ({
      id: `m${String(i).padStart(3, "0")}`,
      receivedAt: new Date(Date.UTC(2024, 0, 1 + i)),
      inboxConnectionId: i % 2 === 0 ? "a" : "b",
    }));
    const a = sampleEmailsDeterministic(candidates, 20);
    const b = sampleEmailsDeterministic(candidates, 20);
    expect(a.selectedIds).toEqual(b.selectedIds);
    expect(a.selectedIds).toHaveLength(20);
    // Should include early and late ids (stratified), not only last 20
    const nums = a.selectedIds.map((id) => Number(id.slice(1)));
    expect(Math.min(...nums)).toBeLessThan(40);
    expect(Math.max(...nums)).toBeGreaterThan(60);
  });

  it("returns all when requested >= eligible", () => {
    const plan = sampleEmailsDeterministic(
      [
        { id: "a", receivedAt: new Date(), inboxConnectionId: null },
        { id: "b", receivedAt: null, inboxConnectionId: null },
      ],
      50
    );
    expect(plan.selectedIds).toHaveLength(2);
    expect(plan.capped).toBe(true);
  });

  it("validates config", () => {
    expect(validateDiscoveryConfig({ samplePreset: "CUSTOM", customCount: 0 }).ok).toBe(false);
    expect(validateDiscoveryConfig({ samplePreset: "500" }).ok).toBe(true);
  });

  it("fnv1a32 is stable", () => {
    expect(fnv1a32("x")).toBe(fnv1a32("x"));
    expect(fnv1a32("x")).not.toBe(fnv1a32("y"));
  });
});

describe("subtype discovery prepare", () => {
  it("excludes empty bodies", () => {
    expect(
      prepareEmailForDiscovery({
        emailMessageId: "1",
        subject: null,
        bodyText: null,
        cleanTextBody: null,
        snippet: null,
        mailboxCategory: "BUSINESS",
        businessTypeKey: null,
        inboxConnectionId: null,
        receivedAt: null,
      })
    ).toBeNull();
  });

  it("strips quoted reply boilerplate and dedupes", () => {
    const cleaned = minimizeBoilerplate(
      "Please confirm delivery.\n\nOn Mon wrote:\n> old\nThis email is confidential and privileged intended solely for the recipient."
    );
    expect(cleaned.toLowerCase()).toContain("confirm delivery");
    expect(cleaned.toLowerCase()).not.toContain("confidential");

    const { prepared, excludedIds } = prepareEmailsForDiscovery([
      {
        emailMessageId: "a",
        subject: "Same",
        bodyText: "Hello world unique",
        cleanTextBody: null,
        snippet: null,
        mailboxCategory: "BUSINESS",
        businessTypeKey: "RFI_CLARIFICATION",
        inboxConnectionId: null,
        receivedAt: null,
      },
      {
        emailMessageId: "b",
        subject: "Same",
        bodyText: "Hello world unique",
        cleanTextBody: null,
        snippet: null,
        mailboxCategory: "BUSINESS",
        businessTypeKey: null,
        inboxConnectionId: null,
        receivedAt: null,
      },
      {
        emailMessageId: "c",
        subject: null,
        bodyText: null,
        cleanTextBody: null,
        snippet: null,
        mailboxCategory: "BUSINESS",
        businessTypeKey: null,
        inboxConnectionId: null,
        receivedAt: null,
      },
    ]);
    expect(prepared).toHaveLength(1);
    expect(excludedIds).toEqual(["b", "c"]);
  });
});

describe("subtype discovery clustering", () => {
  it("groups similar vectors and leaves outliers unresolved", () => {
    const base = [1, 0, 0, 0];
    const near = [0.99, 0.1, 0, 0];
    const near2 = [0.98, 0.12, 0, 0];
    const far = [0, 1, 0, 0];
    const { clusters, unresolvedIds } = clusterByCosineConnectedComponents(
      [
        { id: "a", embedding: base },
        { id: "b", embedding: near },
        { id: "c", embedding: near2 },
        { id: "d", embedding: far },
      ],
      { minClusterSize: 3, similarityThreshold: 0.9 }
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.emailMessageIds.sort()).toEqual(["a", "b", "c"]);
    expect(unresolvedIds).toContain("d");
  });

  it("reports existing subtype overlap shares", () => {
    const o = existingSubtypeOverlap([
      "RFI_CLARIFICATION",
      "RFI_CLARIFICATION",
      "PROJECT_COORDINATION",
      null,
    ]);
    expect(o.topKeys[0]).toBe("RFI_CLARIFICATION");
    expect(o.dominantShare).toBeCloseTo(2 / 3, 3);
  });

  it("does not invent new subtypes for weak/small clusters", () => {
    const r = classifyClusterAgainstTaxonomy({
      suggestedName: "Widget Ping",
      similarExistingKeys: [],
      dominantExistingShare: 0,
      clusterSize: 3,
      analyzedCount: 1000,
      clusterCohesion: 0.9,
      llmKind: "NEW_SUBTYPE",
    });
    expect(r.kind).toBe("UNCLEAR");
  });

  it("marks high-overlap clusters as existing match", () => {
    const r = classifyClusterAgainstTaxonomy({
      suggestedName: "RFI stuff",
      similarExistingKeys: ["RFI_CLARIFICATION"],
      dominantExistingShare: 0.85,
      clusterSize: 40,
      analyzedCount: 200,
      clusterCohesion: 0.85,
      llmKind: "NEW_SUBTYPE",
    });
    expect(r.kind).toBe("EXISTING_MATCH");
  });
});
