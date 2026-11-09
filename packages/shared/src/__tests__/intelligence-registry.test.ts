import { describe, expect, it } from "vitest";
import { INTELLIGENCE_CATALOG } from "../intelligence/catalog.js";
import {
  INTELLIGENCE_STATUSES,
  INTELLIGENCE_TYPES,
  assertIntelligenceRegistryValid,
  getIntelligenceDefinition,
  listDiscoverableIntelligence,
  listIntelligenceSafeDtos,
  toIntelligenceSafeDto,
  validateIntelligenceDefinition,
} from "../intelligence/registry.js";

describe("Intelligence Registry", () => {
  it("passes catalog validation (unique ids + required metadata)", () => {
    expect(() => assertIntelligenceRegistryValid()).not.toThrow();
  });

  it("has unique stable kebab-case ids", () => {
    const ids = INTELLIGENCE_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("uses only canonical types and statuses", () => {
    for (const def of INTELLIGENCE_CATALOG) {
      expect(INTELLIGENCE_TYPES).toContain(def.type);
      expect(INTELLIGENCE_STATUSES).toContain(def.status);
    }
  });

  it("validates every pipeline node and edge", () => {
    for (const def of INTELLIGENCE_CATALOG) {
      const issues = validateIntelligenceDefinition(def);
      expect(issues, def.id).toEqual([]);
      const nodeIds = new Set(def.pipeline.nodes.map((n) => n.id));
      for (const edge of def.pipeline.edges) {
        expect(nodeIds.has(edge.from)).toBe(true);
        expect(nodeIds.has(edge.to)).toBe(true);
      }
    }
  });

  it("declares instructions for AI-backed systems or an explicit reason", () => {
    for (const def of INTELLIGENCE_CATALOG) {
      if (def.type === "AI_LLM" || def.type === "HYBRID") {
        if (def.instructions.available) {
          expect(def.instructions.inspectionKeys.length).toBeGreaterThan(0);
          expect(def.instructions.editable).toBe(false);
        } else {
          expect(def.instructions.reason.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("declares rules for deterministic/hybrid systems or an explicit reason", () => {
    for (const def of INTELLIGENCE_CATALOG) {
      if (def.type === "DETERMINISTIC" || def.type === "HYBRID") {
        if (def.rules.available) {
          expect(def.rules.items.length).toBeGreaterThan(0);
        } else {
          expect(def.rules.reason.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("explicitly declares evaluation, ground truth, and explainability", () => {
    for (const def of INTELLIGENCE_CATALOG) {
      expect(typeof def.evaluation.supported).toBe("boolean");
      expect(def.evaluation.groundTruthQuality).toBeTruthy();
      expect(def.evaluation.groundTruthNotes.trim().length).toBeGreaterThan(0);
      expect(typeof def.explainability.available).toBe("boolean");
      expect(def.explainability.notes.trim().length).toBeGreaterThan(0);
      if (def.evaluation.supported) {
        expect(def.evaluation.evaluatorId?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("includes core production intelligence ids", () => {
    expect(getIntelligenceDefinition("email-classification")?.type).toBe("HYBRID");
    expect(getIntelligenceDefinition("job-matcher")?.type).toBe("DETERMINISTIC");
    expect(getIntelligenceDefinition("bid-scope-extraction")?.type).toBe("HYBRID");
    expect(getIntelligenceDefinition("job-matcher")?.status).toBe("FEATURE_GATED");
  });

  it("exposes discoverable subset for Manage → Intelligence overview", () => {
    const discoverable = listDiscoverableIntelligence();
    expect(discoverable.every((d) => d.discoverable)).toBe(true);
    expect(discoverable.some((d) => d.id === "job-matcher")).toBe(true);
    expect(discoverable.some((d) => d.id === "classification-parity")).toBe(false);
  });

  it("serializes safe DTOs without secret-like content", () => {
    const dtos = listIntelligenceSafeDtos();
    expect(dtos.length).toBe(INTELLIGENCE_CATALOG.length);
    const blob = JSON.stringify(dtos);
    expect(blob).not.toMatch(/sk-(?:proj-|live-|test-)?[a-zA-Z0-9]{16,}/);
    expect(blob).not.toMatch(/OPENAI_API_KEY\s*[:=]\s*["'][^"']+["']/);
    expect(blob).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/);
    const job = toIntelligenceSafeDto(getIntelligenceDefinition("job-matcher")!);
    expect(job.id).toBe("job-matcher");
    expect(job.instructions.available).toBe(false);
  });

  it("does not embed full production prompt bodies in the registry", () => {
    const blob = JSON.stringify(INTELLIGENCE_CATALOG);
    // Inspection keys point at code; registry must not paste long system prompts.
    expect(blob).not.toMatch(/You extract steel fabrication/);
    expect(blob).not.toMatch(/BIDDING OPPORTUNITIES/);
  });
});
