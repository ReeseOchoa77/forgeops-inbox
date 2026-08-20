import { describe, expect, it } from "vitest";

import {
  classifySyncFailure,
  extractSafeSyncFailureDiagnostics,
} from "../application/processors/inbox-sync.processor.js";

describe("classifySyncFailure", () => {
  it("maps invalid_client (stale worker secret) to ERROR, not REQUIRES_REAUTH", () => {
    const failure = classifySyncFailure(
      new Error(
        `Outlook token refresh failed (401): {"error":"invalid_client","error_description":"AADSTS7000215: Invalid client secret provided."}`
      )
    );
    expect(failure.status).toBe("ERROR");
    expect(failure.classification).toBe("config_error");
    expect(failure.clearAccessToken).toBe(false);
  });

  it("maps invalid_grant to REQUIRES_REAUTH", () => {
    const failure = classifySyncFailure(
      new Error(
        `Outlook token refresh failed (400): {"error":"invalid_grant","error_description":"AADSTS700082: The refresh token has expired."}`
      )
    );
    expect(failure.status).toBe("REQUIRES_REAUTH");
    expect(failure.classification).toBe("requires_reauth");
  });

  it("does not treat bare Unauthorized / 429 as REQUIRES_REAUTH", () => {
    expect(
      classifySyncFailure(new Error("Graph request failed: Unauthorized")).status
    ).toBe("ACTIVE");
    expect(
      classifySyncFailure(new Error("Outlook Graph throttled (429): too many requests"))
        .status
    ).toBe("ACTIVE");
  });

  it("extracts safe diagnostics without secrets", () => {
    const diag = extractSafeSyncFailureDiagnostics(
      new Error(
        `Outlook token refresh failed (401): {"error":"invalid_client","error_description":"secret redacted"}`
      )
    );
    expect(diag.httpStatus).toBe(401);
    expect(diag.microsoftErrorCode).toBe("invalid_client");
  });
});
