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
  RESPONSES_JSON_OBJECT_INSTRUCTION,
  responsesJsonObjectInputMentionsJson,
} from "../openai/responses-json.js";
import { buildSemanticSignalResponseCreateParams } from "../openai/semantic-signal-extractor.js";
import {
  buildTaskExtractionUserPrompt,
  taskExtractionSystemPrompt,
} from "../task-extraction/prompt.js";

function assertFinalJsonObjectRequest(params: {
  text?: { format?: { type?: string } } | unknown;
  input?: unknown;
}): void {
  expect(params.text).toEqual({ format: { type: "json_object" } });
  expect(typeof params.input).toBe("string");
  expect(String(params.input)).toMatch(/^Return ONLY valid JSON matching/);
  expect(String(params.input)).toContain(RESPONSES_JSON_OBJECT_INSTRUCTION);
  expect(responsesJsonObjectInputMentionsJson(params.input)).toBe(true);
}

describe("Responses API json_object mode: final request input must contain JSON", () => {
  it("semantic final responses.create params put JSON in input", () => {
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
    assertFinalJsonObjectRequest(params);
    expect(String(params.input)).toContain("Subject: PO #1");
  });

  it("subtype final responses.create params put JSON in input", () => {
    const rawUser = buildBusinessSubtypeUserPrompt({
      normalizedSubject: "Bid addendum",
      senderEmail: "gc@example.com",
      cleanBody: "See attached addendum.",
      activeBusinessTypes: [],
    });
    expect(responsesJsonObjectInputMentionsJson(rawUser)).toBe(false);

    const params = buildJsonObjectResponseParams({
      model: "chat-latest",
      instructions: businessSubtypeSystemPrompt,
      userInput: rawUser,
    });
    assertFinalJsonObjectRequest(params);
    expect(String(params.input)).toContain("Subject: Bid addendum");
  });

  it("entity final responses.create params put JSON in input", () => {
    const rawUser = buildEntitySelectionUserPrompt({
      normalizedSubject: "Job update",
      senderEmail: "a@b.com",
      cleanBody: "Update on job 12.",
      customerCandidates: [],
      vendorCandidates: [],
      jobCandidates: [],
      candidateLookupFailed: false,
    });
    // JSON.stringify([]) in the user payload does not put the word "json" in input.
    expect(responsesJsonObjectInputMentionsJson(rawUser)).toBe(false);

    const params = buildJsonObjectResponseParams({
      model: "chat-latest",
      instructions: entitySelectionSystemPrompt,
      userInput: rawUser,
    });
    assertFinalJsonObjectRequest(params);
  });

  it("task final responses.create params put JSON in input", () => {
    const rawUser = buildTaskExtractionUserPrompt({
      normalizedSubject: "Please review",
      senderEmail: "a@b.com",
      cleanBody: "Please review the drawings.",
      containsActionRequest: true,
    });
    expect(responsesJsonObjectInputMentionsJson(rawUser)).toBe(false);

    const params = buildJsonObjectResponseParams({
      model: "chat-latest",
      instructions: taskExtractionSystemPrompt,
      userInput: rawUser,
    });
    assertFinalJsonObjectRequest(params);
  });
});
