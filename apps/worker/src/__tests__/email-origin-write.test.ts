import { describe, expect, it } from "vitest";
import { emailOriginWrite } from "../application/services/import-provider-mailbox.js";

describe("email origin tags", () => {
  it("tags project-folder analysis without marking it as an inbox import", () => {
    expect(emailOriginWrite("PROJECT_FOLDER")).toEqual({ fromProjectFolder: true });
  });

  it("tags Import Previous Emails separately from live inbox sync", () => {
    expect(emailOriginWrite("HISTORICAL_IMPORT")).toEqual({ fromHistoricalImport: true });
    expect(emailOriginWrite("INBOX")).toEqual({});
    expect(emailOriginWrite(undefined)).toEqual({});
  });
});
