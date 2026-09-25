import { afterEach, describe, expect, it, vi } from "vitest";
import { OutlookClient } from "../infrastructure/providers/outlook/outlook-client.js";

describe("Outlook Graph request timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails a Graph call that never resolves instead of waiting forever", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls += 1;
      if (String(url).includes("/oauth2/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const abort = () => {
          const error = new Error("The operation was aborted");
          error.name = "TimeoutError";
          reject(error);
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });

    const client = new OutlookClient({
      clientId: "id",
      clientSecret: "secret",
      tenantId: "common",
      requestTimeoutMs: 20,
      retryDelayMs: 0,
    });

    await expect(
      client.listMailFolderMessages({
        refreshToken: "refresh",
        folderId: "folder",
        pageSize: 50,
        pageCursor: null,
      })
    ).rejects.toThrow(/timed out/);
    expect(calls).toBeGreaterThan(1);
  });
});
