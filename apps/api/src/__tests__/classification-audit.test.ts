import { describe, expect, it } from "vitest";

import { computeAuditStatus } from "../interfaces/http/routes/classification-audit.route.js";
import {
  buildInspectionSignals,
  computeClassificationHistoryStatus,
  listAvailableInspectionStages,
} from "@forgeops/shared";
import { buildClassificationEvidenceViewModel } from "@forgeops/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

describe("computeClassificationHistoryStatus", () => {
  it("maps pending / requires-review internals to AUTO (no Needs Review product status)", () => {
    expect(
      computeClassificationHistoryStatus({
        reviewStatus: "PENDING",
        previousCategory: null,
      })
    ).toBe("AUTO");
    expect(
      computeAuditStatus({
        requiresReview: true,
        reviewStatus: "NOT_REQUIRED",
        previousCategory: null,
      })
    ).toBe("AUTO");
  });

  it("confirmed without previous category", () => {
    expect(
      computeClassificationHistoryStatus({
        reviewStatus: "APPROVED",
        previousCategory: null,
      })
    ).toBe("CONFIRMED");
  });

  it("corrected when previous category present", () => {
    expect(
      computeClassificationHistoryStatus({
        reviewStatus: "APPROVED",
        previousCategory: "BUSINESS",
      })
    ).toBe("CORRECTED");
  });

  it("dismissed on reject", () => {
    expect(
      computeClassificationHistoryStatus({
        reviewStatus: "REJECTED",
        previousCategory: null,
      })
    ).toBe("DISMISSED");
  });
});

describe("classification audit API contract", () => {
  const routePath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../interfaces/http/routes/classification-audit.route.ts"
  );

  it("defaults page size to 50 and has no Needs Review filter", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).toContain(".default(50)");
    expect(src).toContain('z.enum(["ALL", "CORRECTED", "CONFIRMED"])');
    expect(src).not.toMatch(/status: z\.enum\(\[[^\]]*NEEDS_REVIEW/);
    expect(src).toContain("classification-audit/:classificationId");
    expect(src).toContain("includeBody");
  });

  it("ReviewQueueView has no Needs Review product copy", () => {
    const viewPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../apps/web/src/views/ReviewQueueView.tsx"
    );
    const src = readFileSync(viewPath, "utf8");
    expect(src).not.toMatch(/Needs Review/);
    expect(src).not.toContain("needsReview");
    expect(src).toContain("Classification Inspector");
    expect(src).toContain("View Email Content");
    expect(src).toContain("getClassificationInspection");
  });

  it("does not return rawAiPayload in inspection route", () => {
    const src = readFileSync(routePath, "utf8");
    expect(src).not.toMatch(/select:[\s\S]{0,800}rawAiPayload/);
  });
});

describe("inspection evidence presentation", () => {
  it("surfaces persisted decision rule and signals without fabricating", () => {
    const evidence = {
      decisionRule: "STRONG_BUSINESS_FLAG",
      classificationDecision: {
        rule: "STRONG_BUSINESS_FLAG",
        flags: { contentBusiness: true, subjectBusiness: false, jobBusiness: true },
        cumulative: {
          contentPoints: 92,
          subjectPoints: 40,
          jobPoints: 96,
          senderAdjustment: 0,
          total: 228,
          threshold: 150,
        },
      },
      content: { probability: 0.92, strongFlag: true, explanation: "content" },
      subject: { probability: 0.4, strongFlag: false },
      job: { probability: 0.96, strongFlag: true },
      sender: { status: "LIKELY_BUSINESS", cumulativeAdjustment: 25 },
    };
    const vm = buildClassificationEvidenceViewModel(evidence, "BUSINESS");
    expect(vm?.decisionRule).toBe("STRONG_BUSINESS_FLAG");
    const signals = buildInspectionSignals(vm);
    expect(signals.find((s) => s.key === "content")?.probabilityPct).toBe(92);
    expect(signals.find((s) => s.key === "job")?.direction).toBe("BUSINESS");
    expect(
      listAvailableInspectionStages({
        hasSignals: true,
        hasSubtype: true,
        hasEntities: false,
        hasTasks: false,
        hasPriorityDecision: false,
      })
    ).toEqual(["semantic_business_personal", "subtype"]);
  });
});
