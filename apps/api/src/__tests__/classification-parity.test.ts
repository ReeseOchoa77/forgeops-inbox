import { describe, expect, it, vi } from "vitest";

import type { ClassificationParityResult } from "../application/services/classification-parity.js";

describe("classification parity result contract", () => {
  it("documents full parity overall + diagnostic + candidate shape", () => {
    const overall: ClassificationParityResult["overall"] = {
      categoryMatches: true,
      decisionRuleMatches: true,
      comparableFieldCount: 14,
      unavailableHistoricalFields: ["selectedJobId", "priorityDecision"],
      hasMeaningfulComparisonBasis: true,
    };

    const diagnostics: ClassificationParityResult["diagnostics"] = [
      "MATCH",
    ];

    const candidateDiagnostics: ClassificationParityResult["candidateDiagnostics"] =
      {
        candidateLookupFailed: false,
        knownSender: true,
        senderEvidenceStatus: "KNOWN",
        customerCandidateCount: 2,
        vendorCandidateCount: 1,
        jobCandidateCount: 3,
        approvedJobAliasCount: 4,
      };

    expect(overall.comparableFieldCount).toBe(14);
    expect(overall.unavailableHistoricalFields).toContain("selectedJobId");
    expect(diagnostics).toEqual(["MATCH"]);
    expect(candidateDiagnostics.candidateLookupFailed).toBe(false);
  });

  it("documents PERSONAL skip flags on business-only sections", () => {
    const businessSubtype: ClassificationParityResult["comparisons"]["businessSubtype"] =
      {
        businessType: {
          n8n: null,
          native: null,
          matches: null,
          unavailable: true,
        },
        businessTypeConfidence: {
          n8n: null,
          native: null,
          matches: null,
          unavailable: true,
        },
        skippedBecausePersonal: true,
      };

    expect(businessSubtype.skippedBecausePersonal).toBe(true);
    expect(
      "unavailable" in businessSubtype.businessType &&
        businessSubtype.businessType.unavailable
    ).toBe(true);
  });

  it("no-write guarantee: result always asserts readOnly and dbWrites false", () => {
    const flags: Pick<ClassificationParityResult, "readOnly" | "dbWrites"> = {
      readOnly: true,
      dbWrites: false,
    };
    expect(flags).toEqual({ readOnly: true, dbWrites: false });
  });

  it("no-write guarantee: parity path only uses prisma findUnique (no writes)", async () => {
    const prisma = {
      emailMessage: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
        delete: vi.fn(),
      },
      classification: {
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      task: {
        create: vi.fn(),
        update: vi.fn(),
        upsert: vi.fn(),
      },
      job: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };

    const { runClassificationParityForMessage } = await import(
      "../application/services/classification-parity.js"
    );

    await expect(
      runClassificationParityForMessage("missing-id", {
        prisma: prisma as never,
        openaiSemanticModel: "chat-latest",
      })
    ).rejects.toThrow(/not found/);

    expect(prisma.emailMessage.findUnique).toHaveBeenCalledOnce();
    expect(prisma.emailMessage.create).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    expect(prisma.emailMessage.upsert).not.toHaveBeenCalled();
    expect(prisma.emailMessage.delete).not.toHaveBeenCalled();
    expect(prisma.classification.create).not.toHaveBeenCalled();
    expect(prisma.classification.update).not.toHaveBeenCalled();
    expect(prisma.classification.upsert).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.task.upsert).not.toHaveBeenCalled();
    expect(prisma.job.create).not.toHaveBeenCalled();
    expect(prisma.job.update).not.toHaveBeenCalled();
  });
});
