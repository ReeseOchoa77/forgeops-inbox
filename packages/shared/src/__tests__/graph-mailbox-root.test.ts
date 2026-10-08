import { describe, expect, it } from "vitest";

import {
  outlookGraphMailboxRoot,
  outlookGraphUrl,
} from "../outlook/graph-mailbox-root.js";

describe("outlookGraphMailboxRoot", () => {
  it("defaults to me for own-mailbox flow", () => {
    expect(outlookGraphMailboxRoot(null)).toBe("me");
    expect(outlookGraphMailboxRoot(undefined)).toBe("me");
    expect(outlookGraphMailboxRoot("")).toBe("me");
  });

  it("routes delegated targets to users/{email}", () => {
    expect(outlookGraphMailboxRoot("estimating@company.com")).toBe(
      "users/estimating%40company.com"
    );
    expect(
      outlookGraphUrl("estimating@company.com", "mailFolders/inbox/messages")
    ).toBe(
      "https://graph.microsoft.com/v1.0/users/estimating%40company.com/mailFolders/inbox/messages"
    );
  });
});
