import { describe, expect, it, vi } from "vitest";
import { searchEmailParticipants } from "../application/services/search-email-participants.js";

describe("searchEmailParticipants", () => {
  it("returns nothing for empty query without querying", async () => {
    const findMany = vi.fn();
    const out = await searchEmailParticipants(
      { emailMessage: { findMany } } as never,
      { workspaceId: "ws-1", q: "  ", role: "sender" }
    );
    expect(out).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("scopes sender suggestions to workspace and dedupes addresses", async () => {
    const findMany = vi.fn(async () => [
      { senderEmail: "Reese.Ochoa@neruanet.ai", senderName: "Reese Ochoa" },
      { senderEmail: "reese.ochoa@neruanet.ai", senderName: null },
      { senderEmail: "reese@tekstl.net", senderName: "Reese Ochoa" },
    ]);
    const out = await searchEmailParticipants(
      { emailMessage: { findMany } } as never,
      { workspaceId: "ws-1", q: "ree", role: "sender", limit: 8 }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-1" }),
      })
    );
    expect(out.map((p) => p.email.toLowerCase())).toEqual([
      "reese.ochoa@neruanet.ai",
      "reese@tekstl.net",
    ]);
    expect(out[0]?.name).toBe("Reese Ochoa");
  });

  it("uses recipient To/Cc fields when role is recipient", async () => {
    const findMany = vi.fn(async () => [
      {
        toAddresses: [{ email: "gc@builder.com", name: "GC" }],
        ccAddresses: [{ email: "reese.ochoa@neruanet.ai", name: "Reese Ochoa" }],
      },
    ]);
    const out = await searchEmailParticipants(
      { emailMessage: { findMany } } as never,
      { workspaceId: "ws-9", q: "neruanet", role: "recipient" }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-9" }),
      })
    );
    const payload = JSON.stringify(findMany.mock.calls[0]);
    expect(payload).toContain("toAddresses");
    expect(payload).toContain("ccAddresses");
    expect(out).toEqual([
      { email: "reese.ochoa@neruanet.ai", name: "Reese Ochoa" },
    ]);
  });

  it("hides unmatched text such as stairway", async () => {
    const findMany = vi.fn(async () => [
      { senderEmail: "reese.ochoa@neruanet.ai", senderName: "Reese Ochoa" },
    ]);
    const out = await searchEmailParticipants(
      { emailMessage: { findMany } } as never,
      { workspaceId: "ws-1", q: "stairway", role: "sender" }
    );
    expect(out).toEqual([]);
  });
});
