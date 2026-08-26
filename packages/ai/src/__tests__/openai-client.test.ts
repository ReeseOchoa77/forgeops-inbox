import { describe, expect, it, vi } from "vitest";

const openAiCtor = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    apiKey: string;
    constructor(opts: { apiKey: string; baseURL?: string }) {
      openAiCtor(opts);
      this.apiKey = opts.apiKey;
    }
  },
}));

import {
  createOpenAIClient,
  normalizeOpenAiApiKey,
} from "../openai/openai-client.js";

describe("normalizeOpenAiApiKey / createOpenAIClient", () => {
  it("trims trailing newlines before OpenAI client construction", () => {
    openAiCtor.mockClear();
    const client = createOpenAIClient({
      apiKey: "sk-proj-REALKEY123\n\n\n",
    });
    expect(client).not.toBeNull();
    expect(openAiCtor).toHaveBeenCalledWith({
      apiKey: "sk-proj-REALKEY123",
    });
    expect((client as { apiKey: string }).apiKey).toBe("sk-proj-REALKEY123");
  });

  it("trims surrounding spaces", () => {
    openAiCtor.mockClear();
    createOpenAIClient({ apiKey: "  sk-test-abc  " });
    expect(openAiCtor).toHaveBeenCalledWith({ apiKey: "sk-test-abc" });
  });

  it("treats whitespace-only API key as unconfigured", () => {
    expect(normalizeOpenAiApiKey("\n\n\t  ")).toBeUndefined();
    expect(createOpenAIClient({ apiKey: "\n\n" })).toBeNull();
    expect(createOpenAIClient({ apiKey: "   " })).toBeNull();
    expect(createOpenAIClient({})).toBeNull();
  });
});
