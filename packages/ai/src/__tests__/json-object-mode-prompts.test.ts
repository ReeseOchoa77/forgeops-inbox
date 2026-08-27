import { describe, expect, it } from "vitest";

import {
  buildBusinessSubtypeUserPrompt,
  businessSubtypeSystemPrompt,
} from "../business-subtype/prompt.js";
import {
  buildEntitySelectionUserPrompt,
  entitySelectionSystemPrompt,
} from "../entity-selection/prompt.js";
import {
  buildJsonObjectResponseParams,
  responsesJsonObjectModeMentionsJson,
} from "../openai/responses-json.js";
import { buildSemanticSignalResponseCreateParams } from "../openai/semantic-signal-extractor.js";
import { semanticSignalSystemPrompt } from "../semantic-signals/prompt.js";
import {
  buildTaskExtractionUserPrompt,
  taskExtractionSystemPrompt,
} from "../task-extraction/prompt.js";

describe("Responses API json_object mode requires the word JSON", () => {
  it("semantic stage instructions/input contain JSON", () => {
    const params = buildSemanticSignalResponseCreateParams("chat-latest", {
      normalizedSubject: "PO #1",
      senderName: "Jane",
      senderEmail: "jane@vendor.com",
      senderDomain: "vendor.com",
      cleanBody: "Please send pricing.",
      attachmentNames: [],
      senderEvidence: null,
      domainEvidence: null,
      knownSender: false,
      customerCandidates: [],
      vendorCandidates: [],
      jobCandidates: [],
      approvedJobAliases: [],
      classificationInstructions: [],
      candidateLookupFailed: false,
    });
    expect(params.text).toEqual({ format: { type: "json_object" } });
    expect(
      responsesJsonObjectModeMentionsJson({
        instructions: String(params.instructions ?? ""),
        input: params.input,
      })
    ).toBe(true);
    expect(semanticSignalSystemPrompt).toMatch(/\bJSON\b/);
  });

  it("subtype stage instructions/input contain JSON", () => {
    const params = buildJsonObjectResponseParams({
      model: "chat-latest",
      instructions: businessSubtypeSystemPrompt,
      userInput: buildBusinessSubtypeUserPrompt({
        normalizedSubject: "Bid addendum",
        senderEmail: "gc@example.com",
        cleanBody: "See attached addendum.",
        activeBusinessTypes: [],
      }),
    });
    expect(params.text).toEqual({ format: { type: "json_object" } });
    expect(
      responsesJsonObjectModeMentionsJson({
        instructions: params.instructions,
        input: params.input,
      })
    ).toBe(true);
    expect(businessSubtypeSystemPrompt).toMatch(/\bJSON\b/);
  });

  it("entity stage instructions/input contain JSON", () => {
    const params = buildJsonObjectResponseParams({
      model: "chat-latest",
      instructions: entitySelectionSystemPrompt,
      userInput: buildEntitySelectionUserPrompt({
        normalizedSubject: "Job update",
        senderEmail: "a@b.com",
        cleanBody: "Update on job 12.",
        customerCandidates: [],
        vendorCandidates: [],
        jobCandidates: [],
        candidateLookupFailed: false,
      }),
    });
    expect(params.text).toEqual({ format: { type: "json_object" } });
    expect(
      responsesJsonObjectModeMentionsJson({
        instructions: params.instructions,
        input: params.input,
      })
    ).toBe(true);
    expect(entitySelectionSystemPrompt).toMatch(/\bJSON\b/);
  });

  it("task stage instructions/input contain JSON", () => {
    const params = buildJsonObjectResponseParams({
      model: "chat-latest",
      instructions: taskExtractionSystemPrompt,
      userInput: buildTaskExtractionUserPrompt({
        normalizedSubject: "Please review",
        senderEmail: "a@b.com",
        cleanBody: "Please review the drawings.",
        containsActionRequest: true,
      }),
    });
    expect(params.text).toEqual({ format: { type: "json_object" } });
    expect(
      responsesJsonObjectModeMentionsJson({
        instructions: params.instructions,
        input: params.input,
      })
    ).toBe(true);
    expect(taskExtractionSystemPrompt).toMatch(/\bJSON\b/);
  });
});
