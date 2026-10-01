import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  deleteWorkspaceJob,
  unlinkJobSurvivors,
} from "../application/services/delete-workspace-job.js";

const here = dirname(fileURLToPath(import.meta.url));
const jobsRouteSrc = readFileSync(
  join(here, "../interfaces/http/routes/jobs.route.ts"),
  "utf8"
);
const detailSrc = readFileSync(
  join(here, "../../../web/src/views/JobDetailView.tsx"),
  "utf8"
);
const crmUiSrc = readFileSync(
  join(here, "../../../web/src/job-crm-ui.ts"),
  "utf8"
);

function mockTx() {
  return {
    classification: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    emailMessage: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    discoveredFolder: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    entityAlias: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    job: { delete: vi.fn().mockResolvedValue({}) },
  };
}

describe("deleteWorkspaceJob service", () => {
  it("unlinks survivors before deleting the Job", async () => {
    const tx = mockTx();
    await unlinkJobSurvivors(tx as never, "ws-1", "job-1");

    expect(tx.classification.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", jobId: "job-1" },
      data: { jobId: null },
    });
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", jobId: "job-1" },
      data: { jobId: null },
    });
    expect(tx.emailMessage.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", jobId: "job-1" },
      data: {
        jobId: null,
        jobMatchConfidence: null,
        jobMatchEvidence: Prisma.DbNull,
        jobAssignmentSource: null,
        jobAssignedAt: null,
        jobAssignedByUserId: null,
        jobAssignmentIsManual: false,
      },
    });
    expect(tx.discoveredFolder.updateMany).toHaveBeenCalled();
    expect(tx.entityAlias.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", jobId: "job-1" },
    });
  });

  it("runs unlink + job.delete inside one transaction; rejects missing Job", async () => {
    const tx = mockTx();
    const prisma = {
      job: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "job-1",
            name: "Prieto Battery",
            jobNumber: "3000",
            status: "BIDDING",
          }),
        delete: tx.job.delete,
      },
      jobFile: {
        findMany: vi.fn().mockResolvedValue([{ storageKey: "k1" }]),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };

    const missing = await deleteWorkspaceJob(prisma as never, {
      workspaceId: "ws-1",
      jobId: "missing",
    });
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    const ok = await deleteWorkspaceJob(prisma as never, {
      workspaceId: "ws-1",
      jobId: "job-1",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.job.name).toBe("Prieto Battery");
      expect(ok.storageKeys).toEqual(["k1"]);
    }
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.job.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
    // Customer/Vendor never touched
    expect(JSON.stringify(tx)).not.toMatch(/customer\.delete|vendor\.delete/i);
  });

  it("rolls back when job.delete throws (transaction rejects)", async () => {
    const tx = mockTx();
    tx.job.delete.mockRejectedValueOnce(new Error("fk boom"));
    const prisma = {
      job: {
        findFirst: vi.fn().mockResolvedValue({
          id: "job-1",
          name: "X",
          jobNumber: null,
          status: "ACTIVE",
        }),
      },
      jobFile: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    };
    await expect(
      deleteWorkspaceJob(prisma as never, { workspaceId: "ws", jobId: "job-1" })
    ).rejects.toThrow("fk boom");
  });
});

describe("Job delete route + Settings UX contracts", () => {
  it("CRM DELETE route is OWNER-gated and uses shared transactional delete", () => {
    expect(jobsRouteSrc).toContain(
      'app.delete("/api/v1/workspaces/:workspaceId/jobs/:jobId"'
    );
    expect(jobsRouteSrc).toContain("canPermanentlyDeleteJob");
    expect(jobsRouteSrc).toContain("deleteWorkspaceJob");
    expect(jobsRouteSrc).toContain("Owner permission required");
  });

  it("Settings Danger Zone exposes Delete Job with DELETE confirm phrase", () => {
    expect(detailSrc).toContain('data-testid="job-settings-delete"');
    expect(detailSrc).toContain("Delete Job");
    expect(detailSrc).toContain("confirmPhrase: 'DELETE'");
    expect(detailSrc).toContain("api.deleteJob");
    expect(detailSrc).toContain("canDeleteJob");
    expect(detailSrc).toContain("userRole === 'OWNER'");
    // Archive remains distinct
    expect(detailSrc).toContain("Archive Job");
    expect(detailSrc).toContain("api.archiveJob");
  });

  it("does not delete customers/vendors/users in delete service", () => {
    const svc = readFileSync(
      join(here, "../application/services/delete-workspace-job.ts"),
      "utf8"
    );
    expect(svc).not.toMatch(/customer\.delete/i);
    expect(svc).not.toMatch(/vendor\.delete/i);
    expect(svc).not.toMatch(/user\.delete/i);
    expect(svc).toContain("EmailMessage");
    expect(svc).toContain("releaseFoldersForDeletedJob");
  });
});

describe("Job CRM navigation registry", () => {
  it("Job Detail lists every tab inline (no More menu)", () => {
    for (const tab of [
      "overview",
      "emails",
      "documents",
      "tasks",
      "scope",
      "schedule",
      "changes",
      "procurement",
      "deliveries",
      "billing",
      "activity",
      "settings",
    ]) {
      expect(crmUiSrc).toContain(`'${tab}'`);
      expect(detailSrc.includes(`tab === '${tab}'`)).toBe(true);
    }
    expect(detailSrc).toContain("JOB_CRM_TABS.map");
    expect(detailSrc).not.toContain("More ·");
    expect(detailSrc).not.toContain("moreOpen");
    expect(crmUiSrc).toContain("JOB_CRM_MORE_TABS: JobCrmTab[] = []");
  });
});
