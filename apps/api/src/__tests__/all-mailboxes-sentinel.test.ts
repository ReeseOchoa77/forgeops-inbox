import { describe, expect, it } from "vitest";

import { ALL_MAILBOXES_CONNECTION_ID } from "../interfaces/http/routes/inbox-read.route.js";

describe("ALL_MAILBOXES_CONNECTION_ID", () => {
  it("uses a stable sentinel that is not a cuid", () => {
    expect(ALL_MAILBOXES_CONNECTION_ID).toBe("__all__");
  });
});
