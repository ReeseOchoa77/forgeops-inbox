import { afterEach, describe, expect, it, vi } from "vitest";

import { OutlookClient } from "../infrastructure/providers/outlook/outlook-client.js";

describe("OutlookClient delegated Graph mailbox routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses /users/{email} for delegated mailbox attachment list", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OutlookClient({});
    client.setGraphMailboxEmail("estimating@company.com");
    await client.listAttachments("access-token", "msg-1");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain(
      "/users/estimating%40company.com/messages/msg-1/attachments"
    );
    expect(url).not.toContain("/me/");
  });

  it("uses /me when not delegated (own-mailbox flow)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OutlookClient({});
    client.setGraphMailboxEmail(null);
    await client.listAttachments("access-token", "msg-1");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("/me/messages/msg-1/attachments");
  });
});
