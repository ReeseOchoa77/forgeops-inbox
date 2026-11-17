/**
 * Unit tests for admin GT correction restoration (no live DB writes).
 */
import { describe, expect, it, vi } from "vitest";
import {
  previewJobMatcherEvalGroundTruthRestoration,
  restoreJobMatcherEvalGroundTruthCorrections,
} from "../application/services/job-matcher-eval-ground-truth-corrections.js";

function makePrisma(opts: {
  active?: Array<Record<string, unknown>>;
  reversedCount?: number;
  runJson?: unknown;
}) {
  const active = opts.active ?? [];
  const reversedCount = opts.reversedCount ?? 0;
  return {
    jobMatcherEvalRun: {
      findFirst: vi.fn(async () =>
        opts.runJson != null
          ? { resultJson: opts.runJson }
          : { resultJson: { rows: [{ emailMessageId: "e1", trueJobId: "j1" }] } }
      ),
    },
    jobMatcherEvalGroundTruthCorrection: {
      count: vi.fn(async ({ where }: { where: { verificationStatus?: string } }) => {
        if (where.verificationStatus === "ACTIVE") return active.length;
        if (where.verificationStatus === "REVERSED") return reversedCount;
        return 0;
      }),
      findMany: vi.fn(async ({ where }: { where: { verificationStatus?: string } }) => {
        if (where.verificationStatus === "ACTIVE") return active;
        return [];
      }),
      updateMany: vi.fn(async () => ({ count: active.length })),
    },
    job: {
      findMany: vi.fn(async () => [
        { id: "j1", name: "Job One", jobNumber: "100" },
        { id: "j2", name: "Job Two", jobNumber: "200" },
      ]),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        jobMatcherEvalGroundTruthCorrection: {
          findMany: vi.fn(async () =>
            active.map((a) => ({
              id: a.id,
              emailMessageId: a.emailMessageId,
              originalGroundTruthJobId: a.originalGroundTruthJobId,
              correctedGroundTruthJobId: a.correctedGroundTruthJobId,
              sourceEvaluationRunId: a.sourceEvaluationRunId ?? null,
            }))
          ),
          updateMany: vi.fn(async () => ({ count: active.length })),
        },
      };
      return fn(tx);
    }),
    auditEvent: {
      create: vi.fn(async () => ({})),
    },
  };
}

vi.mock("../application/services/audit-event-logger.js", () => ({
  AuditEventLogger: class {
    async log() {
      return;
    }
  },
}));

describe("job matcher eval GT restoration", () => {
  it("preview is read-only and reports zero ACTIVE as not necessary", async () => {
    const prisma = makePrisma({ active: [], reversedCount: 2 });
    const preview = await previewJobMatcherEvalGroundTruthRestoration({
      prisma: prisma as never,
      workspaceId: "ws1",
      scope: "TENANT_ALL",
    });
    expect(preview.restorationNecessary).toBe(false);
    expect(preview.activeCount).toBe(0);
    expect(preview.reversedCount).toBe(2);
    expect(preview.message).toMatch(/not necessary/i);
    expect(prisma.jobMatcherEvalGroundTruthCorrection.updateMany).not.toHaveBeenCalled();
  });

  it("CURRENT_EVALUATION requires evaluationRunId", async () => {
    const prisma = makePrisma({ active: [] });
    await expect(
      previewJobMatcherEvalGroundTruthRestoration({
        prisma: prisma as never,
        workspaceId: "ws1",
        scope: "CURRENT_EVALUATION",
      })
    ).rejects.toThrow(/evaluationRunId/i);
  });

  it("preview lists ACTIVE rows with original and corrected jobs", async () => {
    const prisma = makePrisma({
      active: [
        {
          id: "c1",
          emailMessageId: "e1",
          originalGroundTruthJobId: "j1",
          correctedGroundTruthJobId: "j2",
          verificationStatus: "ACTIVE",
          sourceEvaluationRunId: "11111111-1111-1111-1111-111111111111",
          sourceModelPolicy: "CONTEXT_AWARE_V2_5",
          verifiedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const preview = await previewJobMatcherEvalGroundTruthRestoration({
      prisma: prisma as never,
      workspaceId: "ws1",
      scope: "TENANT_ALL",
    });
    expect(preview.restorationNecessary).toBe(true);
    expect(preview.activeCount).toBe(1);
    expect(preview.affectedEmailCount).toBe(1);
    expect(preview.items[0]?.originalGroundTruthJobLabel).toContain("Job One");
    expect(preview.items[0]?.correctedGroundTruthJobLabel).toContain("Job Two");
  });

  it("restore requires confirm and is idempotent when already clean", async () => {
    const prisma = makePrisma({ active: [] });
    await expect(
      restoreJobMatcherEvalGroundTruthCorrections({
        prisma: prisma as never,
        workspaceId: "ws1",
        scope: "TENANT_ALL",
        actorUserId: "u1",
        // @ts-expect-error intentional missing confirm
        confirm: false,
      })
    ).rejects.toThrow(/confirm/i);

    const clean = await restoreJobMatcherEvalGroundTruthCorrections({
      prisma: prisma as never,
      workspaceId: "ws1",
      scope: "TENANT_ALL",
      actorUserId: "u1",
      confirm: true,
    });
    expect(clean.alreadyClean).toBe(true);
    expect(clean.reversedCount).toBe(0);
  });

  it("restore reverses ACTIVE rows in a transaction", async () => {
    const active = [
      {
        id: "c1",
        emailMessageId: "e1",
        originalGroundTruthJobId: "j1",
        correctedGroundTruthJobId: "j2",
        verificationStatus: "ACTIVE",
        sourceEvaluationRunId: null,
        verifiedAt: new Date(),
      },
      {
        id: "c2",
        emailMessageId: "e2",
        originalGroundTruthJobId: "j1",
        correctedGroundTruthJobId: "j2",
        verificationStatus: "ACTIVE",
        sourceEvaluationRunId: null,
        verifiedAt: new Date(),
      },
    ];
    const prisma = makePrisma({ active });
    const result = await restoreJobMatcherEvalGroundTruthCorrections({
      prisma: prisma as never,
      workspaceId: "ws1",
      scope: "TENANT_ALL",
      actorUserId: "u1",
      confirm: true,
    });
    expect(result.reversedCount).toBe(2);
    expect(result.affectedEmailCount).toBe(2);
    expect(result.alreadyClean).toBe(false);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
