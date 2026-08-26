import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiResponseFailedLog,
  redactSecretString,
  sanitizeDiagnosticValue,
  serializeOpenAiError,
  withOpenAiResponsesDiagnostics,
} from "../openai/openai-error-diagnostics.js";

describe("redactSecretString", () => {
  it("redacts Bearer Authorization values including sk-proj keys", () => {
    const raw =
      'TypeError: "Bearer sk-proj-SECRETVALUE123" is not a legal HTTP header value';
    const redacted = redactSecretString(raw);
    expect(redacted).toContain("Bearer [REDACTED]");
    expect(redacted).not.toContain("sk-proj-SECRETVALUE123");
    expect(redacted).not.toContain("SECRETVALUE123");
  });

  it("redacts standalone sk-proj and sk- keys", () => {
    expect(redactSecretString("key=sk-proj-ABCDEFG")).toBe(
      "key=[REDACTED_OPENAI_KEY]"
    );
    expect(redactSecretString("key=sk-ABCDEFG")).toBe(
      "key=[REDACTED_OPENAI_KEY]"
    );
  });
});

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

  it("does not expose Bearer sk-proj secrets from cause.message", () => {
    const cause = new Error(
      'Bearer sk-proj-COMPROMISEDKEY999 is not a legal HTTP header value'
    );
    const err = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
      cause,
    });
    const serialized = serializeOpenAiError(err);
    const blob = JSON.stringify(serialized);
    expect(blob).not.toContain("COMPROMISEDKEY999");
    expect(blob).not.toContain("sk-proj-COMPROMISEDKEY999");
    expect(serialized.cause?.message).toContain("Bearer [REDACTED]");
  });

  it("redacts standalone sk-proj values in nested cause objects", () => {
    const nested = {
      name: "TypeError",
      message: "bad header",
      detail: "using sk-proj-NESTEDSECRET111",
      cause: {
        message: "Authorization: Bearer sk-proj-DEEPER222",
      },
    };
    const err = Object.assign(new Error("wrapper sk-proj-OUTER333"), {
      cause: nested,
    });
    const serialized = serializeOpenAiError(err);
    const blob = JSON.stringify(serialized);
    expect(blob).not.toContain("NESTEDSECRET111");
    expect(blob).not.toContain("DEEPER222");
    expect(blob).not.toContain("OUTER333");
    expect(blob).toContain("[REDACTED_OPENAI_KEY]");
  });

  it("preserves useful network diagnostics (ENOTFOUND / hostname)", () => {
    const cause = Object.assign(
      new Error("getaddrinfo ENOTFOUND api.openai.com"),
      {
        code: "ENOTFOUND",
        errno: -3008,
        syscall: "getaddrinfo",
        hostname: "api.openai.com",
      }
    );
    const serialized = serializeOpenAiError(
      Object.assign(new Error("Connection error."), { cause })
    );
    expect(serialized.cause?.code).toBe("ENOTFOUND");
    expect(serialized.cause?.hostname).toBe("api.openai.com");
    expect(serialized.cause?.syscall).toBe("getaddrinfo");
    expect(String(serialized.cause?.message)).toContain("api.openai.com");
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
    expect(JSON.stringify(serialized)).not.toContain("full email");
    // Authorization object keys are not copied into the serializer shape
    expect(serialized).not.toHaveProperty("headers");
    expect(serialized).not.toHaveProperty("body");
  });
});

describe("sanitizeDiagnosticValue", () => {
  it("redacts secret object keys recursively", () => {
    const sanitized = sanitizeDiagnosticValue({
      ok: true,
      authorization: "Bearer sk-proj-SHOULD_NOT_APPEAR",
      nested: { api_key: "sk-abc", hostname: "api.openai.com" },
    }) as Record<string, unknown>;
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect((sanitized.nested as Record<string, unknown>).api_key).toBe(
      "[REDACTED]"
    );
    expect((sanitized.nested as Record<string, unknown>).hostname).toBe(
      "api.openai.com"
    );
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

  it("buildOpenAiResponseFailedLog redacts secrets in logged payload", () => {
    const payload = buildOpenAiResponseFailedLog({
      stage: "semantic",
      model: "chat-latest",
      error: Object.assign(new Error("Connection error."), {
        cause: new Error(
          'Bearer sk-proj-LEAKEDKEY888 is not a legal HTTP header value'
        ),
      }),
    });
    const blob = JSON.stringify(payload);
    expect(blob).not.toContain("LEAKEDKEY888");
    expect(blob).toContain("Bearer [REDACTED]");
  });
});
