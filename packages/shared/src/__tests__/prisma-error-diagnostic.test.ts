import { describe, expect, it } from "vitest";
import {
  extractPrismaClientDiagnostic,
  formatClassificationFailureMessage,
} from "../prisma-error-diagnostic.js";
import { truncateClassificationError } from "../classification-processing.js";

describe("extractPrismaClientDiagnostic", () => {
  it("prefers the final Invalid value for argument line over the invocation dump", () => {
    const message = [
      "Invalid `prisma.task.upsert()` invocation:",
      "",
      "{",
      "  where: {",
      "    workspaceId_sourceMessageId_sourceTaskKey: {",
      "      workspaceId: \"ws\",",
      "      sourceMessageId: \"msg\",",
      "      sourceTaskKey: \"native:0:submit:abcd1234\"",
      "    }",
      "  },",
      "  create: {",
      "    title: \"Submit proposal\",",
      "    dueAt: new Date(\"Invalid Date\")",
      "  }",
      "}",
      "",
      "Invalid value for argument `dueAt`. Expected DateTime or Null, provided Date.",
    ].join("\n");

    const diag = extractPrismaClientDiagnostic(new Error(message));
    expect(diag.invalidField).toBe("dueAt");
    expect(diag.compactMessage).toContain("dueAt");
    expect(diag.compactMessage).not.toContain("workspaceId_sourceMessageId");
  });

  it("formats a stage-prefixed bounded classificationError", () => {
    const err = new Error(
      "Invalid `prisma.task.upsert()` invocation:\n{\n  where: { huge: true }\n}\n\nInvalid value for argument `priority`. Expected Priority."
    );
    const formatted = formatClassificationFailureMessage("task_persist", err);
    expect(formatted.startsWith("TASK_PERSIST:")).toBe(true);
    expect(formatted).toContain("`priority`");
    expect(formatted.length).toBeLessThanOrEqual(480);
    expect(truncateClassificationError(formatted)).toBe(formatted);
  });
});
