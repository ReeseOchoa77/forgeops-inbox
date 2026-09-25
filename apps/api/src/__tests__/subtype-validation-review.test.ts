import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { BUSINESS_SUBTYPE_KEYS } from "@forgeops/ai";

import {
  loadBlindSubtypePacket,
  recordSubtypeVerification,
  runSubtypeShadowBatch,
} from "../application/services/subtype-validation-review.js";

describe("subtype verification does not rewrite classification", () => {
  it("writes a correction and leaves the classification row alone", async () => {
    const create = vi.fn().mockResolvedValue({ id: "corr-1" });
    const update = vi.fn();
    const prisma = {
      classification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cls-1",
          mailboxCategory: "BUSINESS",
          businessTypeKey: "SUBMITTAL_SHOP_DRAWING",
          businessTypeConfidence: { toString: () => "0.9100" },
          classificationEvidence: {
            subtypeDecision: {
              classifierVersion: "subtype-v2",
              businessType: "SUBMITTAL_SHOP_DRAWING",
              confidence: 0.91,
              band: "HIGH",
              competingType: "FABRICATION_PRODUCTION",
              evidence: ["subject asks for approval"],
            },
          },
          customerId: null,
          vendorId: null,
          jobId: "job-1",
          priority: "MEDIUM",
        }),
        update,
      },
      classificationCorrection: { create },
      emailMessage: { update: vi.fn() },
      task: { updateMany: vi.fn() },
    };

    const result = await recordSubtypeVerification(prisma as never, {
      workspaceId: "ws",
      classificationId: "cls-1",
      userId: "user-1",
      action: "change",
      businessType: "FABRICATION_PRODUCTION",
    });

    expect(result.humanLabel).toBe("FABRICATION_PRODUCTION");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalBusinessType: "SUBMITTAL_SHOP_DRAWING",
        correctedBusinessType: "FABRICATION_PRODUCTION",
        originalJobId: "job-1",
        correctedJobId: "job-1",
        reason: "subtype-verify:change",
      }),
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("stores an explicit blind label even when it matches production, and reveals the comparison only on the result", async () => {
    const create = vi.fn().mockResolvedValue({ id: "corr-2" });
    const update = vi.fn();
    const emailUpdate = vi.fn();
    const prisma = {
      classification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cls-1",
          mailboxCategory: "BUSINESS",
          businessTypeKey: "INVOICE_PAYMENT",
          businessTypeConfidence: { toString: () => "0.9600" },
          classificationEvidence: null,
          customerId: null,
          vendorId: null,
          jobId: null,
          priority: null,
        }),
        update,
      },
      classificationCorrection: { create },
      emailMessage: { update: emailUpdate },
      task: { updateMany: vi.fn() },
    };

    const result = await recordSubtypeVerification(prisma as never, {
      workspaceId: "ws",
      classificationId: "cls-1",
      userId: "user-1",
      action: "blind",
      businessType: "INVOICE_PAYMENT",
    });

    expect(result.humanLabel).toBe("INVOICE_PAYMENT");
    expect(result.matchesProduction).toBe(true);
    expect(result.productionSubtype).toBe("INVOICE_PAYMENT");
    expect(create.mock.calls[0]?.[0].data.reason).toBe("subtype-verify:blind");
    expect(create.mock.calls[0]?.[0].data.correctedBusinessType).toBe("INVOICE_PAYMENT");
    expect(update).not.toHaveBeenCalled();
    expect(emailUpdate).not.toHaveBeenCalled();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("stores ambiguous as a validation marker and does not add a business subtype", async () => {
    const create = vi.fn().mockResolvedValue({ id: "corr-3" });
    const prisma = {
      classification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cls-1",
          mailboxCategory: "BUSINESS",
          businessTypeKey: "PROJECT_COORDINATION",
          businessTypeConfidence: null,
          classificationEvidence: null,
          customerId: null,
          vendorId: null,
          jobId: "job-9",
          priority: "LOW",
        }),
        update: vi.fn(),
      },
      classificationCorrection: { create },
      emailMessage: { update: vi.fn() },
      task: { updateMany: vi.fn() },
    };

    const result = await recordSubtypeVerification(prisma as never, {
      workspaceId: "ws",
      classificationId: "cls-1",
      userId: "user-1",
      action: "ambiguous",
      ambiguityReason: "TAXONOMY_GAP",
    });

    expect(result.ambiguous).toBe(true);
    expect(result.humanLabel).toBeNull();
    expect(result.matchesProduction).toBeNull();
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      correctedBusinessType: null,
      correctedJobId: "job-9",
      reason: "subtype-verify:ambiguous|TAXONOMY_GAP",
    });
    expect(BUSINESS_SUBTYPE_KEYS).not.toContain("AMBIGUOUS");
    expect(prisma.classification.update).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("loads labeling evidence without the stored subtype and without marking the email read", async () => {
    const emailUpdate = vi.fn();
    const prisma = {
      classification: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cls-1",
          message: {
            id: "msg-1",
            threadId: "thread-1",
            subject: "Submittal 05 12 00",
            senderName: "Pat",
            senderEmail: "pat@gc.example",
            bodyText: "Please approve the shop drawings.\n\nThanks,\nEstimator",
            attachmentMetadata: [{ filename: "Submittal_051200.pdf" }],
            job: { id: "job-1", workspaceId: "ws", jobNumber: "2198", name: "Nova Academy Addition" },
            normalizedEmail: null,
          },
        }),
        update: vi.fn(),
      },
      emailMessage: {
        findMany: vi.fn().mockResolvedValue([
          { senderEmail: "a@b.com", subject: "Shop drawings", snippet: "Please review." },
        ]),
        update: emailUpdate,
      },
    };

    const packet = await loadBlindSubtypePacket(prisma as never, {
      workspaceId: "ws",
      classificationId: "cls-1",
    });

    expect(packet.subject).toContain("Submittal");
    expect(packet.currentMessage).toContain("Please approve");
    expect(packet.attachmentNames).toEqual(["Submittal_051200.pdf"]);
    expect(packet.job?.name).toBe("Nova Academy Addition");
    expect(packet).not.toHaveProperty("businessTypeKey");
    expect(packet).not.toHaveProperty("competingType");
    expect(packet).not.toHaveProperty("confidence");
    expect(JSON.stringify(packet)).not.toContain("subtype-v2");
    expect(emailUpdate).not.toHaveBeenCalled();
    expect(prisma.classification.update).not.toHaveBeenCalled();
  });

  it("shadow evaluation calls only the subtype classifier", async () => {
    const classify = vi.fn().mockResolvedValue({
      businessType: "INVOICE_PAYMENT",
      businessTypeConfidence: 0.96,
      competingType: null,
      evidence: ["subject is an invoice"],
      classifierVersion: "subtype-v2",
    });
    const classificationUpdate = vi.fn();
    const prisma = {
      businessType: { findMany: vi.fn().mockResolvedValue([]) },
      classificationCorrection: {
        findFirst: vi.fn().mockResolvedValue({
          correctedBusinessType: "INVOICE_PAYMENT",
          reason: "subtype-verify:blind",
        }),
      },
      classification: {
        findFirst: vi.fn().mockResolvedValue({
          summary: "Invoice attached",
          message: {
            id: "msg-1",
            threadId: "thread-1",
            subject: "Invoice 10382",
            senderName: "Accounts",
            senderEmail: "ap@vendor.example",
            bodyText: "Attached is invoice 10382.",
            attachmentMetadata: [{ name: "Invoice-10382.pdf" }],
            jobId: null,
            job: null,
            normalizedEmail: null,
          },
        }),
        update: classificationUpdate,
      },
      emailMessage: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      task: { updateMany: vi.fn() },
    };

    const result = await runSubtypeShadowBatch(prisma as never, {
      workspaceId: "ws",
      classificationIds: ["cls-1"],
      classify,
    });

    expect(classify).toHaveBeenCalledTimes(1);
    expect(result.cases[0]).toMatchObject({
      expected: "INVOICE_PAYMENT",
      predicted: "INVOICE_PAYMENT",
      competingType: null,
      classifierVersion: "subtype-v2",
      attachmentNames: ["Invoice-10382.pdf"],
    });
    expect(result.cases[0]?.currentExcerpt.length).toBeLessThanOrEqual(400);
    expect(classificationUpdate).not.toHaveBeenCalled();
    expect(prisma.emailMessage.update).not.toHaveBeenCalled();
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });
});

describe("subtype validation route safety", () => {
  it("does not update classification, jobs, tasks, or enqueue work", () => {
    const src = readFileSync(
      new URL("../interfaces/http/routes/subtype-validation.route.ts", import.meta.url),
      "utf8"
    );
    expect(src).not.toContain("classification.update");
    expect(src).not.toContain("emailMessage.update");
    expect(src).not.toContain("task.update");
    expect(src).not.toContain("enqueue");
    expect(src).toContain("classificationUnchanged: true");
    expect(src).not.toContain("isRead");
  });
});
