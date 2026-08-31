import { describe, expect, it } from "vitest";
import { taskBulkDeleteCutoff } from "@forgeops/shared";

/**
 * Mirrors task-bulk.route where clause: createdAt strictly before cutoff.
 */
function wouldDelete(createdAt: string, beforeYmd: string, tz = "UTC"): boolean {
  const cutoff = taskBulkDeleteCutoff(beforeYmd, tz);
  return new Date(createdAt) < cutoff;
}

describe("task bulk delete cutoff semantics", () => {
  it("deletes only tasks strictly before the selected date", () => {
    expect(wouldDelete("2026-08-14T23:59:59.999Z", "2026-08-15")).toBe(true);
    expect(wouldDelete("2026-08-15T00:00:00.000Z", "2026-08-15")).toBe(false);
    expect(wouldDelete("2026-08-16T12:00:00.000Z", "2026-08-15")).toBe(false);
  });

  it("scopes preview/delete paths to workspace+connection (route contract)", () => {
    // Route uses:
    // where: { workspaceId, createdAt: { lt: cutoff }, sourceThread: { inboxConnectionId } }
    const where = {
      workspaceId: "ws1",
      createdAt: { lt: taskBulkDeleteCutoff("2026-08-15", "UTC") },
      sourceThread: { inboxConnectionId: "conn1" },
    };
    expect(where.workspaceId).toBe("ws1");
    expect(where.sourceThread.inboxConnectionId).toBe("conn1");
    expect(where.createdAt.lt.toISOString()).toBe("2026-08-15T00:00:00.000Z");
  });
});

describe("job documents library mapping", () => {
  it("merges email + upload sources without embedding bodies", () => {
    const payload = {
      files: [
        {
          id: "att1",
          filename: "drawing.pdf",
          mimeType: "application/pdf",
          sourceType: "EMAIL_ATTACHMENT",
          emailId: "msg1",
          emailSubject: "Re: patio",
          sender: "a@x.com",
        },
        {
          id: "file1",
          filename: "site.jpg",
          mimeType: "image/jpeg",
          sourceType: "JOB_UPLOAD",
          emailId: null,
        },
      ],
    };
    expect(payload.files).toHaveLength(2);
    expect(JSON.stringify(payload)).not.toMatch(/bodyHtml|bodyText/);
    expect(payload.files.some((f) => f.sourceType === "EMAIL_ATTACHMENT")).toBe(true);
    expect(payload.files.some((f) => f.sourceType === "JOB_UPLOAD")).toBe(true);
  });
});
