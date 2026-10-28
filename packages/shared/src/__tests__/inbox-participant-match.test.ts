import { describe, expect, it } from "vitest";
import {
  compactParticipantTokenLabel,
  extractAddressRecords,
  findKnownParticipantToCommit,
  isCompleteEmailAddress,
  rankInboxParticipants,
  scoreInboxParticipantMatch,
} from "../inbox-participant-match.js";

describe("inbox participant match", () => {
  it("ranks exact email first, then prefix, name, username, domain", () => {
    expect(
      scoreInboxParticipantMatch("connorochoa@tekstl.net", "connorochoa@tekstl.net", "Connor")
    ).toBe(1000);
    expect(
      scoreInboxParticipantMatch("conn", "connorochoa@tekstl.net", "Connor Ochoa")
    ).toBeGreaterThan(
      scoreInboxParticipantMatch("conn", "other@tekstl.net", "Accounting")
    );
    expect(
      scoreInboxParticipantMatch("tekstl", "connorochoa@tekstl.net", "Connor")
    ).toBe(600);
    expect(scoreInboxParticipantMatch("ochoa", "x@y.com", "Connor Ochoa")).toBe(500);
  });

  it("dedupes by case-insensitive email and keeps a name", () => {
    const ranked = rankInboxParticipants("conn", [
      { email: "ConnorOchoa@tekstl.net", name: null },
      { email: "connorochoa@tekstl.net", name: "Connor Ochoa" },
      { email: "other@company.com", name: "Connor Smith" },
    ]);
    const connor = ranked.filter(
      (p) => p.email.toLowerCase() === "connorochoa@tekstl.net"
    );
    expect(connor).toHaveLength(1);
    expect(connor[0]?.name).toBe("Connor Ochoa");
  });

  it("does not match unrelated strings", () => {
    expect(scoreInboxParticipantMatch("zzz", "a@b.com", "Alice")).toBe(0);
    expect(scoreInboxParticipantMatch("stairway", "reese.ochoa@neruanet.ai", "Reese Ochoa")).toBe(
      0
    );
  });

  it("matches domain fragments, usernames, and display names", () => {
    expect(
      scoreInboxParticipantMatch("neruanet", "reese.ochoa@neruanet.ai", "Reese Ochoa")
    ).toBe(600);
    expect(
      scoreInboxParticipantMatch("reese", "reese.ochoa@neruanet.ai", "Reese Ochoa")
    ).toBeGreaterThanOrEqual(700);
    expect(
      scoreInboxParticipantMatch("ochoa", "reese.ochoa@neruanet.ai", "Reese Ochoa")
    ).toBe(700);
    expect(
      scoreInboxParticipantMatch("reese@", "reese@tekstl.net", "Reese Ochoa")
    ).toBe(900);
    expect(
      scoreInboxParticipantMatch("reese@", "reese.ochoa@neruanet.ai", "Reese Ochoa")
    ).toBe(900);
  });

  it("bounds ranked suggestions and skips non-matches", () => {
    const ranked = rankInboxParticipants(
      "reese",
      [
        { email: "reese.ochoa@neruanet.ai", name: "Reese Ochoa" },
        { email: "reese@tekstl.net", name: "Reese Ochoa" },
        { email: "other@company.com", name: "Accounting" },
      ],
      8
    );
    expect(ranked.map((p) => p.email)).toEqual([
      "reese.ochoa@neruanet.ai",
      "reese@tekstl.net",
    ]);
    expect(rankInboxParticipants("stairway", ranked, 8)).toEqual([]);
  });

  it("isCompleteEmailAddress rejects normal words", () => {
    expect(isCompleteEmailAddress("stairway")).toBe(false);
    expect(isCompleteEmailAddress("conn")).toBe(false);
    expect(isCompleteEmailAddress("Connor")).toBe(false);
    expect(isCompleteEmailAddress("connorochoa@tekstl.net")).toBe(true);
  });

  it("commits typed text only when it is a complete known email", () => {
    const known = { email: "connorochoa@tekstl.net", name: "Connor Ochoa" };
    expect(findKnownParticipantToCommit("stairway", [known])).toBeNull();
    expect(findKnownParticipantToCommit("Connor", [known])).toBeNull();
    expect(findKnownParticipantToCommit("connorochoa@tekstl.net", [known])).toEqual(
      known
    );
    expect(findKnownParticipantToCommit("nobody@tekstl.net", [known])).toBeNull();
  });

  it("extracts address records from JSON objects and strings", () => {
    expect(
      extractAddressRecords([
        { email: "a@b.com", name: "A" },
        "c@d.com",
        { email: "bad" },
      ])
    ).toEqual([
      { email: "a@b.com", name: "A" },
      { email: "c@d.com", name: null },
      { email: "bad", name: null },
    ]);
  });

  it("compact token prefers unique short name else email", () => {
    const used = new Set<string>();
    expect(
      compactParticipantTokenLabel(
        { email: "connorochoa@tekstl.net", name: "Connor Ochoa" },
        used
      )
    ).toBe("Connor Ochoa");
    used.add("connor ochoa");
    expect(
      compactParticipantTokenLabel(
        { email: "connor.smith@x.com", name: "Connor Ochoa" },
        used
      )
    ).toBe("connor.smith@x.com");
  });
});
