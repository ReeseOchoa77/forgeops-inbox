import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeRecipientEmail, parseRecipientList } from "./recipient-utils";

describe("recipient chips helpers", () => {
  it("accepts valid emails and rejects malformed", () => {
    expect(isValidEmail("micah@frana.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });

  it("dedupes via normalize", () => {
    expect(normalizeRecipientEmail(" Micah@Frana.com ")).toBe("micah@frana.com");
  });

  it("parses manually typed lists", () => {
    expect(parseRecipientList("a@x.com, b@y.com;c@z.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });
});
