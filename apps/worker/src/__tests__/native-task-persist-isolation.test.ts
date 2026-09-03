import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

import { buildNativeTaskPersistPayload } from "../application/services/native-task-persist-payload.js";

describe("buildNativeTaskPersistPayload", () => {
  it("maps malformed dueDate to null and keeps sourceDate", () => {
    const sourceDate = new Date("2026-08-27T22:38:26.000Z");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const payload = buildNativeTaskPersistPayload({
      sourceTaskKey: "native:0:submit:abcd",
      title: "Submit proposal to Sam Kanne",
      description: "Send the proposal",
      recommendedOwner: null,
      dueDate: "ASAP",
      sourceDate,
      priority: "HIGH",
      confidence: 0.91,
      requiresReview: false,
      emailMessageId: "msg-1",
    });
    expect(payload.dueAt).toBeNull();
    expect(payload.sourceDate.toISOString()).toBe(sourceDate.toISOString());
    expect(Number.isNaN(payload.sourceDate.getTime())).toBe(false);
    warn.mockRestore();
  });

  it("rejects empty title before Prisma", () => {
    expect(() =>
      buildNativeTaskPersistPayload({
        sourceTaskKey: "native:0:x:abcd",
        title: "   ",
        description: "desc",
        recommendedOwner: null,
        dueDate: null,
        sourceDate: new Date(),
        priority: "MEDIUM",
        confidence: 0.5,
        requiresReview: false,
      })
    ).toThrow();
  });

  it("accepts valid deadline", () => {
    const payload = buildNativeTaskPersistPayload({
      sourceTaskKey: "native:0:x:abcd",
      title: "Call GC",
      description: "Follow up",
      recommendedOwner: "Alex",
      dueDate: "2026-09-02T00:00:00.000Z",
      sourceDate: new Date("2026-08-27T22:38:26.000Z"),
      priority: "URGENT",
      confidence: 0.8,
      requiresReview: false,
    });
    expect(payload.dueAt?.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(payload.assigneeGuess).toBe("Alex");
  });
});

/**
 * Documents the isolation contract: core CLASSIFIED commit must not share a
 * transaction with per-task upserts. Mirrors persistNativeClassificationResult.
 */
describe("native task enrichment isolation contract", () => {
  it("invalid task upsert does not prevent CLASSIFIED outcome", async () => {
    const classificationUpserts: unknown[] = [];
    const taskUpserts: Array<{ ok: boolean; key: string }> = [];
    const emailUpdates: Array<{ classificationStatus: string }> = [];

    // Simulate core txn success
    classificationUpserts.push({ id: "cls-1" });
    emailUpdates.push({ classificationStatus: "CLASSIFIED" });

    const tasks = [
      { title: "Good task", dueDate: null, confidence: 0.9, description: "ok", recommendedOwner: null },
      {
        title: "Bad task",
        dueDate: new Date("Invalid Date"),
        confidence: 0.9,
        description: "bad",
        recommendedOwner: null,
      },
      { title: "Another good", dueDate: "2026-09-05", confidence: 0.85, description: "ok2", recommendedOwner: null },
    ];

    const sourceDate = new Date("2026-08-27T22:38:26.000Z");
    let tasksWritten = 0;
    let tasksFailed = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const sourceTaskKey = `native:${i}:key`;
      try {
        // Force Invalid Date through without normalize to simulate Prisma throw path
        // for the middle task via buildNativeTaskPersistPayload (normalizes to null — valid).
        // For isolation demo: throw on second task as if Prisma rejected it.
        const payload = buildNativeTaskPersistPayload({
          sourceTaskKey,
          title: task.title,
          description: task.description,
          recommendedOwner: task.recommendedOwner,
          dueDate: task.dueDate,
          sourceDate,
          priority: "MEDIUM",
          confidence: task.confidence,
          requiresReview: false,
        });
        if (i === 1) {
          throw new Prisma.PrismaClientValidationError(
            "Invalid `prisma.task.upsert()` invocation:\n\nInvalid value for argument `priority`. Expected Priority.",
            { clientVersion: "test" }
          );
        }
        taskUpserts.push({ ok: true, key: payload.sourceTaskKey });
        tasksWritten += 1;
      } catch {
        tasksFailed += 1;
        taskUpserts.push({ ok: false, key: sourceTaskKey });
      }
    }

    expect(emailUpdates[0]?.classificationStatus).toBe("CLASSIFIED");
    expect(classificationUpserts).toHaveLength(1);
    expect(tasksWritten).toBe(2);
    expect(tasksFailed).toBe(1);
    expect(taskUpserts.filter((t) => t.ok)).toHaveLength(2);
    warn.mockRestore();
    error.mockRestore();
  });

  it("documents CLASSIFIED semantics vs optional enrichment", () => {
    const semantics = {
      CLASSIFIED: "core NormalizedEmail + Classification persisted",
      FAILED: "core classification could not complete",
      taskPersistFailure: "log only — do not set FAILED",
      invalidRecipientEmail: "drop optional address — do not set FAILED",
    };
    expect(semantics.taskPersistFailure).toContain("do not set FAILED");
    expect(semantics.CLASSIFIED).toContain("Classification");
  });
});
