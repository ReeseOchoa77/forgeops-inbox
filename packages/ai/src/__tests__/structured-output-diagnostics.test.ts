import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  OpenAISemanticSignalExtractor,
} from "../openai/semantic-signal-extractor.js";
import { serializeOpenAiError } from "../openai/openai-error-diagnostics.js";
import {
  buildSemanticValidationFailedLog,
  structuredIssuesFromSemanticMessages,
  summarizeParsedStructuredShape,
} from "../openai/structured-output-diagnostics.js";
import {
  parseSemanticSignals,
  SemanticSignalValidationError,
} from "../semantic-signals/types.js";

describe("structured output validation diagnostics", () => {
  it("summarizes keys without including field values", () => {
    const shape = summarizeParsedStructuredShape({
      contentBusinessProbability: 0.9,
      summary: "SECRET email body should not appear in keys",
      signalExplanations: {
        content: "secret",
        subject: "secret",
      },
    });
    expect(shape.returnedTopLevelKeys).toEqual([
      "contentBusinessProbability",
      "summary",
      "signalExplanations",
    ]);
    expect(shape.explanationKeys).toEqual(["content", "subject"]);
    expect(JSON.stringify(shape)).not.toContain("SECRET");
    expect(JSON.stringify(shape)).not.toContain("email body");
  });

  it("flags single-key object wrappers", () => {
    expect(
      summarizeParsedStructuredShape({
        email: { contentBusinessProbability: 0.5 },
      }).wrapperSuspected
    ).toBe(true);
  });

  it("maps semantic issue strings to structured path/code/message", () => {
    expect(
      structuredIssuesFromSemanticMessages([
        'unexpected top-level property "mailboxCategory"',
        'missing required field "summary"',
        "contentBusinessProbability must be a finite number",
        'deadlineUrgency must be one of NONE | STANDARD | URGENT (got "HIGH")',
      ])
    ).toEqual([
      {
        path: ["mailboxCategory"],
        code: "unexpected_property",
        message: 'unexpected top-level property "mailboxCategory"',
      },
      {
        path: ["summary"],
        code: "missing_required",
        message: 'missing required field "summary"',
        expected: "present",
        received: "undefined",
      },
      {
        path: ["contentBusinessProbability"],
        code: "invalid_type",
        message: "contentBusinessProbability must be a finite number",
        expected: "finite number",
      },
      {
        path: ["deadlineUrgency"],
        code: "invalid_enum",
        message:
          'deadlineUrgency must be one of NONE | STANDARD | URGENT (got "HIGH")',
        expected: "NONE | STANDARD | URGENT",
      },
    ]);
  });

  it("buildSemanticValidationFailedLog never includes raw values or output text", () => {
    const parsed = {
      mailboxCategory: "BUSINESS",
      contentBusinessProbability: "0.8",
      summary: "Please review drawings ASAP",
    };
    let validationError: SemanticSignalValidationError | null = null;
    try {
      parseSemanticSignals(parsed);
    } catch (e) {
      validationError = e as SemanticSignalValidationError;
    }
    expect(validationError).toBeInstanceOf(SemanticSignalValidationError);

    const log = buildSemanticValidationFailedLog({
      parsed,
      error: validationError!,
    });
    const blob = JSON.stringify(log);
    expect(log.event).toBe("semantic-validation-failed");
    expect(log.returnedTopLevelKeys).toEqual([
      "mailboxCategory",
      "contentBusinessProbability",
      "summary",
    ]);
    expect(blob).not.toContain("Please review drawings");
    expect(blob).not.toContain("0.8");
    expect(blob).not.toContain("BUSINESS");
    expect(Array.isArray(log.issues)).toBe(true);
    expect((log.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it("serializeOpenAiError includes zodIssues for ZodError without dumping values", () => {
    const err = new ZodError([
      {
        code: "invalid_enum_value",
        options: ["NONE", "STANDARD", "URGENT"],
        path: ["deadlineUrgency"],
        message: "Invalid enum",
        received: "HIGH",
      } as never,
    ]);
    const serialized = serializeOpenAiError(err);
    expect(serialized.constructorName).toBe("ZodError");
    expect(serialized.zodIssues).toEqual([
      {
        path: ["deadlineUrgency"],
        code: "invalid_enum_value",
        message: "Invalid enum",
        expected: "NONE | STANDARD | URGENT",
        received: "HIGH",
      },
    ]);
  });

  it("semantic extractor logs semantic-validation-failed then rethrows", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockResolvedValue({
      output_text: JSON.stringify({
        mailboxCategory: "BUSINESS",
        contentBusinessProbability: 0.5,
      }),
    });
    const client = {
      responses: { create },
    } as unknown as ConstructorParameters<
      typeof OpenAISemanticSignalExtractor
    >[0];

    const extractor = new OpenAISemanticSignalExtractor(client, "chat-latest");
    await expect(
      extractor.extract({
        normalizedSubject: "x",
        senderEmail: "a@b.com",
        cleanBody: "body must not appear in logs",
        knownSender: false,
        customerCandidates: [],
        vendorCandidates: [],
        jobCandidates: [],
        approvedJobAliases: [],
        classificationInstructions: [],
        candidateLookupFailed: false,
      })
    ).rejects.toBeInstanceOf(SemanticSignalValidationError);

    expect(errorSpy).toHaveBeenCalled();
    const payload = errorSpy.mock.calls.find(
      (c) =>
        c[0] &&
        typeof c[0] === "object" &&
        (c[0] as { event?: string }).event === "semantic-validation-failed"
    )?.[0] as Record<string, unknown>;
    expect(payload).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain("body must not appear");
    errorSpy.mockRestore();
  });
});
