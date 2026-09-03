import { describe, expect, it, vi } from "vitest";
import {
  classifyJobFileType,
  fileExtension,
  isPreviewableImage,
} from "../job-file-types.js";
import {
  addDaysYmd,
  inboxDateRangeBounds,
  normalizeTaskDueAt,
  resolveTaskSourceDate,
  safeDateOrNull,
  startOfMonthYmd,
  startOfWeekSundayYmd,
  taskBulkDeleteCutoff,
  taskSourceDateRangeBounds,
  zonedStartOfDay,
  zonedYmd,
} from "../date-bounds.js";

describe("job file type classification", () => {
  it("classifies common types by mime and extension", () => {
    expect(classifyJobFileType("image/png", "a.png")).toBe("IMAGES");
    expect(classifyJobFileType("application/pdf", "x.pdf")).toBe("PDF");
    expect(classifyJobFileType("text/csv", "sheet.csv")).toBe("SPREADSHEETS");
    expect(classifyJobFileType("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe("DOCUMENTS");
    expect(classifyJobFileType("application/zip", "a.zip")).toBe("OTHER");
  });

  it("exposes extension and previewable images", () => {
    expect(fileExtension("photo.JPEG")).toBe(".jpeg");
    expect(isPreviewableImage("image/png", "a.png")).toBe(true);
    expect(isPreviewableImage("application/pdf", "a.pdf")).toBe(false);
  });
});

describe("date bounds", () => {
  it("computes UTC start-of-day for a YMD in a timezone", () => {
    const start = zonedStartOfDay("2026-08-15", "America/Chicago");
    expect(start.toISOString()).toBe("2026-08-15T05:00:00.000Z"); // CDT
  });

  it("task bulk delete cutoff keeps the selected day", () => {
    const cutoff = taskBulkDeleteCutoff("2026-08-15", "UTC");
    expect(cutoff.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    // createdAt on Aug 15 00:00 UTC is NOT deleted (lt cutoff fails)
    expect(new Date("2026-08-15T00:00:00.000Z") < cutoff).toBe(false);
    expect(new Date("2026-08-14T23:59:59.999Z") < cutoff).toBe(true);
  });

  it("Sunday-start week and month presets", () => {
    // 2026-08-19 is a Wednesday
    expect(startOfWeekSundayYmd("2026-08-19", "UTC")).toBe("2026-08-16");
    expect(startOfMonthYmd("2026-08-19")).toBe("2026-08-01");
    expect(addDaysYmd("2026-08-01", 14)).toBe("2026-08-15");
  });

  it("inbox TODAY bounds use local midnight → now", () => {
    const now = new Date("2026-08-19T18:30:00.000Z");
    const bounds = inboxDateRangeBounds("TODAY", "UTC", now);
    expect(bounds.receivedAfter.toISOString()).toBe("2026-08-19T00:00:00.000Z");
    expect(bounds.receivedBefore.toISOString()).toBe(now.toISOString());
    expect(zonedYmd(now, "UTC")).toBe("2026-08-19");
  });

  it("task sourceDate bounds match inbox calendar semantics", () => {
    const now = new Date("2026-08-30T20:00:00.000Z");
    const inbox = inboxDateRangeBounds("TODAY", "UTC", now);
    const task = taskSourceDateRangeBounds("TODAY", "UTC", now);
    expect(task.sourceAfter.toISOString()).toBe(inbox.receivedAfter.toISOString());
    expect(task.sourceBefore.toISOString()).toBe(inbox.receivedBefore.toISOString());
  });

  it("resolveTaskSourceDate prefers receivedAt over sentAt", () => {
    const received = new Date("2026-08-14T08:06:00.000Z");
    const sent = new Date("2026-08-14T07:00:00.000Z");
    expect(
      resolveTaskSourceDate({ receivedAt: received, sentAt: sent }).toISOString()
    ).toBe(received.toISOString());
    expect(
      resolveTaskSourceDate({ receivedAt: null, sentAt: sent }).toISOString()
    ).toBe(sent.toISOString());
  });

  it("historical import email date does not equal import-day createdAt for Today filter", () => {
    const emailDate = new Date("2026-08-14T08:06:00.000Z");
    const importDay = new Date("2026-08-30T18:00:00.000Z");
    const sourceDate = resolveTaskSourceDate({
      receivedAt: emailDate,
      sentAt: emailDate,
    });
    const todayBounds = taskSourceDateRangeBounds("TODAY", "UTC", importDay);
    expect(sourceDate >= todayBounds.sourceAfter && sourceDate < todayBounds.sourceBefore).toBe(
      false
    );
  });
});

describe("safeDateOrNull / normalizeTaskDueAt", () => {
  it("maps null/undefined/empty to null", () => {
    expect(safeDateOrNull(null)).toBeNull();
    expect(safeDateOrNull(undefined)).toBeNull();
    expect(safeDateOrNull("")).toBeNull();
    expect(safeDateOrNull("   ")).toBeNull();
    expect(normalizeTaskDueAt(null)).toBeNull();
    expect(normalizeTaskDueAt(undefined)).toBeNull();
    expect(normalizeTaskDueAt("")).toBeNull();
  });

  it("maps malformed and Invalid Date to null", () => {
    expect(safeDateOrNull("not-a-date")).toBeNull();
    expect(safeDateOrNull("ASAP")).toBeNull();
    expect(safeDateOrNull("Invalid Date")).toBeNull();
    expect(safeDateOrNull(new Date("Invalid Date"))).toBeNull();
    expect(normalizeTaskDueAt("Friday")).toBeNull();
    expect(normalizeTaskDueAt("end of week")).toBeNull();
  });

  it("parses valid ISO and YYYY-MM-DD", () => {
    const iso = safeDateOrNull("2026-09-02T00:00:00.000Z");
    expect(iso?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    const ymd = safeDateOrNull("2026-09-02");
    expect(ymd?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    const fromDate = normalizeTaskDueAt(new Date("2026-09-02T17:00:00.000Z"));
    expect(fromDate?.toISOString()).toBe("2026-09-02T17:00:00.000Z");
  });

  it("keeps sourceDate independent of dueAt", () => {
    const emailDate = new Date("2026-08-27T22:38:26.000Z");
    const sourceDate = resolveTaskSourceDate({ receivedAt: emailDate });
    const dueAt = normalizeTaskDueAt(null);
    expect(sourceDate.toISOString()).toBe(emailDate.toISOString());
    expect(dueAt).toBeNull();
    // Explicit deadline stays distinct from email date
    const due = normalizeTaskDueAt("2026-09-02T00:00:00.000Z");
    expect(due?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(due?.getTime()).not.toBe(sourceDate.getTime());
  });

  it("logs compact warning for discarded raw due dates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      normalizeTaskDueAt("ASAP", { emailMessageId: "msg-1" })
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(payload).toEqual({
      event: "task-invalid-due-date",
      emailMessageId: "msg-1",
      rawDueAt: "ASAP",
    });
    warn.mockRestore();
  });

  it("builds a Prisma-safe upsert payload for create and update from one value", () => {
    const dueAt = normalizeTaskDueAt("not-a-real-deadline");
    const sourceDate = resolveTaskSourceDate({
      receivedAt: new Date("2026-08-27T22:38:26.000Z"),
    });
    const update = { dueAt, sourceDate, title: "Submit proposal to Sam Kanne" };
    const create = { dueAt, sourceDate, title: "Submit proposal to Sam Kanne" };
    expect(update.dueAt).toBeNull();
    expect(create.dueAt).toBeNull();
    expect(update.sourceDate.toISOString()).toBe("2026-08-27T22:38:26.000Z");
    // Would have been Invalid Date before the fix:
    const legacy = "ASAP" ? new Date("ASAP") : null;
    expect(Number.isNaN(legacy.getTime())).toBe(true);
  });
});
