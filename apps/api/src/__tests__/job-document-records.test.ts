import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  allowsSubmittalStatus,
  clearDocumentControl,
  documentMatchesCategory,
  JobDocumentRecordError,
  presentDocumentControl,
  upsertDocumentControl,
} from "../application/services/job-document-records.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("job document records", () => {
  it("limits submittal status to shop drawings and submittals", () => {
    expect(allowsSubmittalStatus("SHOP_DRAWING")).toBe(true);
    expect(allowsSubmittalStatus("SUBMITTAL")).toBe(true);
    expect(allowsSubmittalStatus("INVOICE")).toBe(false);
    expect(allowsSubmittalStatus("ARCHITECTURAL_DRAWING")).toBe(false);
  });

  it("maps document types into Documents tab categories", () => {
    expect(documentMatchesCategory("STRUCTURAL_DRAWING", "DRAWINGS")).toBe(true);
    expect(documentMatchesCategory("SHOP_DRAWING", "SHOP_SUBMITTALS")).toBe(true);
    expect(documentMatchesCategory("RFI_DOCUMENT", "RFIS")).toBe(true);
    expect(documentMatchesCategory("ASI", "ASI_BULLETIN_ADDENDUM")).toBe(true);
    expect(documentMatchesCategory(null, "DRAWINGS")).toBe(false);
    expect(documentMatchesCategory("INVOICE", "ALL")).toBe(true);
  });

  it("presents control DTO with source type from XOR refs", () => {
    const dto = presentDocumentControl({
      id: "r1",
      jobId: "job-1",
      jobFileId: null,
      emailAttachmentId: "att-1",
      documentType: "SHOP_DRAWING",
      documentNumber: "SD-04",
      title: "Stair A",
      revision: "2",
      documentDate: new Date("2026-10-15T00:00:00.000Z"),
      workPackageId: "pkg-1",
      submittalStatus: "APPROVED_AS_NOTED",
      isCurrent: true,
      supersedesId: "r0",
      notes: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      workPackage: { id: "pkg-1", name: "Stair A" },
    });
    expect(dto).toMatchObject({
      sourceType: "EMAIL_ATTACHMENT",
      documentTypeLabel: "Shop drawing",
      documentDate: "2026-10-15",
      submittalStatusLabel: "Approved as noted",
      workPackageName: "Stair A",
    });
  });

  it("rejects classifying with a work package from another job", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobFile: { findFirst: vi.fn().mockResolvedValue({ id: "file-1" }) },
      jobWorkPackage: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      upsertDocumentControl(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        sourceType: "JOB_UPLOAD",
        sourceId: "file-1",
        documentType: "STRUCTURAL_DRAWING",
        workPackageId: "other-pkg",
        actorUserId: "u1",
      })
    ).rejects.toMatchObject({ message: "Work package not found on this job", statusCode: 404 });
  });

  it("rejects submittal status on non-submittal types", async () => {
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobFile: { findFirst: vi.fn().mockResolvedValue({ id: "file-1" }) },
      jobDocumentRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(
      upsertDocumentControl(prisma as never, {
        workspaceId: "ws",
        jobId: "job-1",
        sourceType: "JOB_UPLOAD",
        sourceId: "file-1",
        documentType: "INVOICE",
        submittalStatus: "APPROVED",
        actorUserId: "u1",
      })
    ).rejects.toBeInstanceOf(JobDocumentRecordError);
  });

  it("creates metadata for a JobFile without touching storage fields", async () => {
    const created = {
      id: "r1",
      jobId: "job-1",
      jobFileId: "file-1",
      emailAttachmentId: null,
      documentType: "STRUCTURAL_DRAWING" as const,
      documentNumber: "S2.1",
      title: "Framing Plan",
      revision: "3",
      documentDate: new Date("2026-09-01T00:00:00.000Z"),
      workPackageId: null,
      submittalStatus: null,
      isCurrent: true,
      supersedesId: null,
      notes: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      workPackage: null,
    };
    const create = vi.fn().mockResolvedValue(created);
    const activity = vi.fn();
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobFile: { findFirst: vi.fn().mockResolvedValue({ id: "file-1" }) },
      jobDocumentRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobDocumentRecord: { create, update: vi.fn() },
          jobActivityLog: { create: activity },
        })
      ),
    };
    const dto = await upsertDocumentControl(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      sourceType: "JOB_UPLOAD",
      sourceId: "file-1",
      documentType: "STRUCTURAL_DRAWING",
      documentNumber: "S2.1",
      title: "Framing Plan",
      revision: "3",
      documentDate: "2026-09-01",
      actorUserId: "u1",
    });
    expect(dto.documentNumber).toBe("S2.1");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobFileId: "file-1",
          emailAttachmentId: null,
          documentType: "STRUCTURAL_DRAWING",
        }),
      })
    );
    expect(activity).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DOCUMENT_CLASSIFIED" }),
      })
    );
  });

  it("creates metadata for an EmailAttachment assigned to the job", async () => {
    const created = {
      id: "r2",
      jobId: "job-1",
      jobFileId: null,
      emailAttachmentId: "att-1",
      documentType: "SHOP_DRAWING" as const,
      documentNumber: "SD-04",
      title: "Stair A",
      revision: "1",
      documentDate: null,
      workPackageId: null,
      submittalStatus: "SUBMITTED" as const,
      isCurrent: true,
      supersedesId: null,
      notes: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      workPackage: null,
    };
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      emailAttachment: { findFirst: vi.fn().mockResolvedValue({ id: "att-1" }) },
      jobDocumentRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobDocumentRecord: { create: vi.fn().mockResolvedValue(created), update: vi.fn() },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await upsertDocumentControl(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      sourceType: "EMAIL_ATTACHMENT",
      sourceId: "att-1",
      documentType: "SHOP_DRAWING",
      documentNumber: "SD-04",
      title: "Stair A",
      revision: "1",
      submittalStatus: "SUBMITTED",
      actorUserId: "u1",
    });
    expect(dto.sourceType).toBe("EMAIL_ATTACHMENT");
    expect(dto.submittalStatus).toBe("SUBMITTED");
  });

  it("marks the older record not current when superseding", async () => {
    const existing = null;
    const created = {
      id: "r-new",
      jobId: "job-1",
      jobFileId: "file-2",
      emailAttachmentId: null,
      documentType: "SHOP_DRAWING" as const,
      documentNumber: "SD-04",
      title: "Stair A",
      revision: "2",
      documentDate: null,
      workPackageId: null,
      submittalStatus: "APPROVED" as const,
      isCurrent: true,
      supersedesId: "r-old",
      notes: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      workPackage: null,
    };
    const markOld = vi.fn();
    const prisma = {
      job: { findFirst: vi.fn().mockResolvedValue({ id: "job-1" }) },
      jobFile: { findFirst: vi.fn().mockResolvedValue({ id: "file-2" }) },
      jobDocumentRecord: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: "r-old" }) // supersedes lookup
          .mockResolvedValueOnce(existing), // existing for source
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobDocumentRecord: {
            update: markOld.mockResolvedValue({}),
            create: vi.fn().mockResolvedValue(created),
          },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    const dto = await upsertDocumentControl(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      sourceType: "JOB_UPLOAD",
      sourceId: "file-2",
      documentType: "SHOP_DRAWING",
      documentNumber: "SD-04",
      revision: "2",
      supersedesId: "r-old",
      submittalStatus: "APPROVED",
      actorUserId: "u1",
    });
    expect(markOld).toHaveBeenCalledWith({
      where: { id: "r-old" },
      data: { isCurrent: false },
    });
    expect(dto.supersedesId).toBe("r-old");
    expect(dto.isCurrent).toBe(true);
  });

  it("clears metadata without deleting the source file", async () => {
    const del = vi.fn();
    const prisma = {
      jobDocumentRecord: {
        findFirst: vi.fn().mockResolvedValue({
          id: "r1",
          documentType: "OTHER",
          documentNumber: null,
          jobFileId: "file-1",
          emailAttachmentId: null,
        }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          jobDocumentRecord: { delete: del },
          jobActivityLog: { create: vi.fn() },
        })
      ),
    };
    await clearDocumentControl(prisma as never, {
      workspaceId: "ws",
      jobId: "job-1",
      recordId: "r1",
      actorUserId: "u1",
    });
    expect(del).toHaveBeenCalledWith({ where: { id: "r1" } });
  });

  it("wires Documents control without AI/OCR/binary reads or Overview/list hydration", () => {
    const service = readFileSync(
      resolve(here, "../application/services/job-document-records.ts"),
      "utf8"
    );
    expect(service).toContain("JobDocumentRecord");
    expect(service).not.toContain("storageKey");
    expect(service).not.toContain("readFile");
    expect(service).not.toContain("OCR");
    expect(service).not.toContain("INLINE_IMAGE_AI");
    expect(service).not.toContain("createMilestone");

    const route = readFileSync(
      resolve(here, "../interfaces/http/routes/job-document-records.route.ts"),
      "utf8"
    );
    expect(route).toContain("/document-control");
    expect(route).toContain("canEditJob");

    const docs = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    expect(docs).toContain("loadDocumentControlsForSources");
    expect(docs).toContain("docCategory");
    expect(docs).toContain("controlState");
    expect(docs).toContain("sourceType: \"EMAIL_ATTACHMENT\"");
    expect(docs).toContain("sourceType: \"JOB_UPLOAD\"");

    const listHandler = docs.slice(
      docs.indexOf("GET /api/v1/workspaces/:workspaceId/jobs — List jobs"),
      docs.indexOf("GET /api/v1/workspaces/:workspaceId/jobs/:jobId — Job detail")
    );
    expect(listHandler).not.toContain("jobDocumentRecord");
    expect(listHandler).not.toContain("document-control");

    const ui = readFileSync(resolve(here, "../../../web/src/views/JobDetailView.tsx"), "utf8");
    expect(ui).toContain("Add document details");
    expect(ui).toContain("JobDocumentControlForm");
    expect(ui).toContain("Unclassified");

    const migration = readFileSync(
      resolve(
        here,
        "../../../../packages/db/prisma/migrations/20260929240000_job_document_records/migration.sql"
      ),
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "JobDocumentRecord"');
    expect(migration).toContain("ON DELETE CASCADE");
    expect(migration).toContain("ON DELETE SET NULL");
  });
});
