import { describe, expect, it, vi } from "vitest";

import { OpenAITaskExtractor } from "../task-extraction/extractor.js";
import { parseTaskExtractionResult } from "../task-extraction/parse.js";
import {
  buildTaskExtractionUserPrompt,
  taskExtractionSystemPrompt,
} from "../task-extraction/prompt.js";
import { StructuredOutputValidationError } from "../openai/responses-json.js";

describe("task extraction contract", () => {
  it("prompt separates bidding opportunity deadlines from ordinary Tasks", () => {
    expect(taskExtractionSystemPrompt).toMatch(/BIDDING OPPORTUNITIES/i);
    expect(taskExtractionSystemPrompt).toMatch(/OPPORTUNITY METADATA/i);
    expect(taskExtractionSystemPrompt).toMatch(/Confirm intent/i);
    expect(taskExtractionSystemPrompt).toMatch(/Do NOT create tasks such as:.*"Submit bid"/i);
    const user = buildTaskExtractionUserPrompt({
      normalizedSubject: "ITB Garden City",
      senderEmail: "gc@example.com",
      cleanBody: "Bids due October 15.",
      containsActionRequest: true,
      businessTypeKey: "BID_OPPORTUNITY",
    });
    expect(user).toContain("Business Type:");
    expect(user).toContain("BID_OPPORTUNITY");
  });

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

  it("coerces malformed dueDate strings to null without failing extraction", () => {
    expect(
      parseTaskExtractionResult({
        tasks: [
          {
            title: "Submit proposal to Sam Kanne",
            description: "Send the proposal",
            dueDate: "ASAP",
            recommendedOwner: null,
            confidence: 0.9,
          },
        ],
      })
    ).toEqual({
      tasks: [
        {
          title: "Submit proposal to Sam Kanne",
          description: "Send the proposal",
          dueDate: null,
          recommendedOwner: null,
          confidence: 0.9,
        },
      ],
    });
  });

  it("normalizes valid dueDate to ISO and keeps it distinct from email timing", () => {
    const result = parseTaskExtractionResult({
      tasks: [
        {
          title: "Send by Tuesday",
          description: "Deliver docs",
          dueDate: "2026-09-02",
          confidence: 0.85,
        },
      ],
    });
    expect(result.tasks[0]?.dueDate).toBe("2026-09-02T00:00:00.000Z");
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
