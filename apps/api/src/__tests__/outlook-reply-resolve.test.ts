import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveOutlookGraphMessageId } from "../interfaces/http/routes/send.route.js";

describe("resolveOutlookGraphMessageId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns stored rest id when Graph GET succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id: "AAMkStored=" })
      ) as unknown as typeof fetch
    );

    const result = await resolveOutlookGraphMessageId({
      accessToken: "token",
      storedMessageId: "AAMkStored=",
      internetMessageId: null,
      conversationId: null,
      sentAt: null,
    });

    expect(result).toEqual({
      id: "AAMkStored=",
      resolvedVia: "stored_rest_id",
      useImmutableIdPrefer: false,
    });
  });

  it("falls back to internetMessageId filter when stored id is missing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/reply") || String(url).includes("internetMessageId")) {
        return Response.json({ value: [{ id: "AAMkFresh=" }] });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await resolveOutlookGraphMessageId({
      accessToken: "token",
      storedMessageId: "AAMkStale=",
      internetMessageId: "<msg@example.com>",
      conversationId: "AAQkConv=",
      sentAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    expect(result.resolvedVia).toBe("internet_message_id");
    expect(result.id).toBe("AAMkFresh=");
    expect(result.useImmutableIdPrefer).toBe(false);

    const filterCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("internetMessageId")
    );
    expect(filterCall?.[0]).toContain(encodeURIComponent("internetMessageId eq '<msg@example.com>'"));
  });

  it("matches conversation messages by sentAt when imid lookup is unavailable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("conversationId")) {
        return Response.json({
          value: [
            {
              id: "AAMkOlder=",
              sentDateTime: "2026-08-01T10:00:00.000Z",
            },
            {
              id: "AAMkTarget=",
              sentDateTime: "2026-08-01T12:00:05.000Z",
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await resolveOutlookGraphMessageId({
      accessToken: "token",
      storedMessageId: "AAMkStale=",
      internetMessageId: null,
      conversationId: "AAQkConv=",
      sentAt: new Date("2026-08-01T12:00:00.000Z"),
    });

    expect(result).toEqual({
      id: "AAMkTarget=",
      resolvedVia: "conversation_sent_at",
      useImmutableIdPrefer: false,
    });
  });
});
