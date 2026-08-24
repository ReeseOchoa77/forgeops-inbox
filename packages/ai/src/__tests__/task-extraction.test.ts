import { describe, expect, it, vi } from "vitest";

import { OpenAITaskExtractor } from "../task-extraction/extractor.js";
import { parseTaskExtractionResult } from "../task-extraction/parse.js";
import { StructuredOutputValidationError } from "../openai/responses-json.js";

describe("task extraction contract", () => {
  it("enforces max 5 tasks", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      title: `Task ${i}`,
      description: `Do thing ${i}`,
      dueDate: null,
      recommendedOwner: null,
      confidence: 0.9,
    }));
    expect(() => parseTaskExtractionResult({ tasks })).toThrow(/at most 5/);
  });

  it("rejects malformed tasks and extra fields", () => {
    expect(() =>
      parseTaskExtractionResult({
        tasks: [
          {
            title: "Review drawings",
            description: "Send comments",
            confidence: 1.5,
          },
        ],
      })
    ).toThrow(/between 0 and 1/);

    expect(() =>
      parseTaskExtractionResult({
        tasks: [
          {
            title: "Review drawings",
            description: "Send comments",
            confidence: 0.9,
            invented: true,
          },
        ],
      })
    ).toThrow(StructuredOutputValidationError);
  });

  it("accepts null dueDate/recommendedOwner and defaults omitted optionals to null", () => {
    expect(
      parseTaskExtractionResult({
        tasks: [
          {
            title: "Provide pricing",
            description: "Reply with quote",
            confidence: 0.8,
          },
        ],
      })
    ).toEqual({
      tasks: [
        {
          title: "Provide pricing",
          description: "Reply with quote",
          dueDate: null,
          recommendedOwner: null,
          confidence: 0.8,
        },
      ],
    });
  });

  it("skips model call when containsActionRequest is false", async () => {
    const create = vi.fn();
    const client = {
      responses: { create },
    } as unknown as ConstructorParameters<typeof OpenAITaskExtractor>[0];

    const extractor = new OpenAITaskExtractor(client, "chat-latest");
    const result = await extractor.extract({
      normalizedSubject: "FYI",
      senderEmail: "a@b.com",
      cleanBody: "Just an update",
      containsActionRequest: false,
    });

    expect(result).toEqual({ tasks: [] });
    expect(create).not.toHaveBeenCalled();
  });
});
