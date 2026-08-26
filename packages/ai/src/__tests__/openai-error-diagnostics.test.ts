import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiResponseFailedLog,
  serializeOpenAiError,
  withOpenAiResponsesDiagnostics,
} from "../openai/openai-error-diagnostics.js";

describe("serializeOpenAiError", () => {
  it("captures APIConnectionError-shaped fields and nested Node cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.openai.com"), {
      name: "Error",
      code: "ENOTFOUND",
      errno: -3008,
      syscall: "getaddrinfo",
      hostname: "api.openai.com",
    });
    const err = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
      status: undefined,
      code: undefined,
      type: undefined,
      cause,
    });

    const serialized = serializeOpenAiError(err);
    expect(serialized.errorName).toBe("APIConnectionError");
    expect(serialized.errorMessage).toBe("Connection error.");
    expect(serialized.constructorName).toBe("Error");
    expect(serialized.cause).toEqual({
      name: "Error",
      message: "getaddrinfo ENOTFOUND api.openai.com",
      code: "ENOTFOUND",
      errno: -3008,
      syscall: "getaddrinfo",
      hostname: "api.openai.com",
    });
  });

  it("reads request_id / status / code / type when present", () => {
    const err = Object.assign(new Error("401 Invalid"), {
      name: "AuthenticationError",
      status: 401,
      code: "invalid_api_key",
      type: "invalid_request_error",
      request_id: "req_abc",
    });
    const serialized = serializeOpenAiError(err);
    expect(serialized.status).toBe(401);
    expect(serialized.code).toBe("invalid_api_key");
    expect(serialized.type).toBe("invalid_request_error");
    expect(serialized.requestId).toBe("req_abc");
  });

  it("never includes unexpected large body-like fields (only known keys)", () => {
    const err = Object.assign(new Error("boom"), {
      headers: { Authorization: "Bearer secret" },
      body: "full email body should not appear",
    });
    const serialized = serializeOpenAiError(err);
    expect(JSON.stringify(serialized)).not.toContain("Bearer");
    expect(JSON.stringify(serialized)).not.toContain("full email");
  });
});

describe("withOpenAiResponsesDiagnostics", () => {
  it("logs openai-response-failed with stage then rethrows", async () => {
    const log = vi.fn();
    const boom = new Error("Connection error.");
    await expect(
      withOpenAiResponsesDiagnostics(
        { stage: "semantic", model: "chat-latest", log },
        async () => {
          throw boom;
        }
      )
    ).rejects.toBe(boom);

    expect(log).toHaveBeenCalledTimes(1);
    const payload = log.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.event).toBe("openai-response-failed");
    expect(payload.stage).toBe("semantic");
    expect(payload.model).toBe("chat-latest");
    expect(payload.errorMessage).toBe("Connection error.");
  });

  it("buildOpenAiResponseFailedLog shape", () => {
    const payload = buildOpenAiResponseFailedLog({
      stage: "subtype",
      model: "chat-latest",
      error: new Error("Connection error."),
    });
    expect(payload).toMatchObject({
      event: "openai-response-failed",
      stage: "subtype",
      model: "chat-latest",
      errorMessage: "Connection error.",
    });
  });
});
