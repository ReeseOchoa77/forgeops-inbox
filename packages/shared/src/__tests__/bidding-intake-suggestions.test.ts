import { describe, expect, it } from "vitest";
import { extractBidDueDateDeterministic } from "../bidding/extract-bid-due-date.js";
import {
  suggestBidProjectNameFromSubject,
  suggestedBidName,
} from "../bidding/suggest-bid-project-name.js";
import {
  parseSequentialJobNumber,
  suggestNextJobNumberFromList,
  workspaceCurrentJobNumberCollisionWhere,
  workspaceJobNumbersForSuggestionWhere,
} from "../bidding/suggest-next-job-number.js";

describe("suggestBidProjectNameFromSubject", () => {
  it("strips Invitation to Bid wrappers", () => {
    expect(
      suggestBidProjectNameFromSubject(
        "Invitation to Bid - Garden City Elementary School 2023 Referendum Alterations"
      )
    ).toBe("Garden City Elementary School 2023 Referendum Alterations");
  });

  it("strips ITB prefixes", () => {
    expect(suggestBidProjectNameFromSubject("ITB: Beltline Building #2")).toBe(
      "Beltline Building #2"
    );
  });

  it("strips reminder-to-submit wrappers", () => {
    expect(
      suggestBidProjectNameFromSubject(
        "Reminder to submit your Bid for Forte - EP Office Expansion"
      )
    ).toBe("Forte - EP Office Expansion");
  });

  it("strips RE/FW wrappers then invitation boilerplate", () => {
    expect(
      suggestBidProjectNameFromSubject(
        "RE: FW: Invitation to Bid - Nova Academy Structural Steel"
      )
    ).toBe("Nova Academy Structural Steel");
  });

  it("leaves legitimate project subjects intact", () => {
    expect(
      suggestBidProjectNameFromSubject("Beltline Parking Ramp Stair C")
    ).toBe("Beltline Parking Ramp Stair C");
  });

  it("returns null for empty/strange subjects", () => {
    expect(suggestBidProjectNameFromSubject("")).toBeNull();
    expect(suggestBidProjectNameFromSubject("   ")).toBeNull();
    expect(suggestBidProjectNameFromSubject("Invitation to Bid -")).toBeNull();
  });

  it("suggestedBidName prefers existing job name", () => {
    expect(suggestedBidName("RE: Other", "Nova Academy")).toBe("Nova Academy");
  });
});

describe("suggestNextJobNumberFromList — archived reuse", () => {
  it("A) current 1001–1003, archived 1010 omitted → suggest 1004", () => {
    expect(suggestNextJobNumberFromList(["1001", "1002", "1003"])).toBe("1004");
  });

  it("B/C) current 1001–1003; archived 1004/1005/1050 omitted → still 1004", () => {
    // Caller must pass only non-archived rows.
    expect(suggestNextJobNumberFromList(["1001", "1002", "1003"])).toBe("1004");
    expect(suggestNextJobNumberFromList(["1001", "1002", "1003"])).not.toBe(
      "1005"
    );
    expect(suggestNextJobNumberFromList(["1001", "1002", "1003"])).not.toBe(
      "1051"
    );
  });

  it("I) numeric ordering: 999 then 1000", () => {
    expect(suggestNextJobNumberFromList(["999", "1000"])).toBe("1001");
  });

  it("increments plain numeric job numbers", () => {
    expect(suggestNextJobNumberFromList(["2148", "2100", "1999"])).toBe("2149");
  });

  it("increments year-prefix sequences (shop style 26-200)", () => {
    expect(suggestNextJobNumberFromList(["26-184", "26-200", "25-999"])).toBe(
      "26-201"
    );
  });

  it("ignores non-numeric special job numbers safely", () => {
    expect(suggestNextJobNumberFromList(["J-1000", "ALT-A", "2148"])).toBe(
      "2149"
    );
    expect(parseSequentialJobNumber("J-1000")).toBeNull();
  });

  it("returns null for empty workspace", () => {
    expect(suggestNextJobNumberFromList([])).toBeNull();
    expect(suggestNextJobNumberFromList([null, "", "  "])).toBeNull();
  });

  it("prefers yy-seq over plain when both exist", () => {
    expect(suggestNextJobNumberFromList(["2198", "26-200"])).toBe("26-201");
  });

  it("matrix: after deleting max 3002, current 3000,3001 → suggest 3002", () => {
    expect(suggestNextJobNumberFromList(["3000", "3001"])).toBe("3002");
  });

  it("matrix: delete non-max 3001 → still suggest from current max 3003 → 3004", () => {
    expect(
      suggestNextJobNumberFromList(["3000", "3002", "3003"])
    ).toBe("3004");
  });

  it("exposes current-Job where helpers (archivedAt null)", () => {
    expect(workspaceJobNumbersForSuggestionWhere("ws-1")).toEqual({
      workspaceId: "ws-1",
      archivedAt: null,
      AND: [{ jobNumber: { not: null } }, { jobNumber: { not: "" } }],
    });
    expect(
      workspaceCurrentJobNumberCollisionWhere({
        workspaceId: "ws-1",
        jobNumber: "1004",
      })
    ).toEqual({
      workspaceId: "ws-1",
      jobNumber: "1004",
      archivedAt: null,
    });
    expect(
      workspaceCurrentJobNumberCollisionWhere({
        workspaceId: "ws-1",
        jobNumber: "1004",
        excludeJobId: "job-a",
      })
    ).toEqual({
      workspaceId: "ws-1",
      jobNumber: "1004",
      archivedAt: null,
      id: { not: "job-a" },
    });
  });
});

describe("extractBidDueDateDeterministic", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");

  it("extracts Bids due October 15, 2026", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "ITB Garden City",
        bodyText: "Bids due October 15, 2026 at 2:00 PM",
        now,
      })
    ).toBe("2026-10-15");
  });

  it("extracts Submit by 10/15", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "Pricing request",
        bodyText: "Please submit pricing by 10/15/2026",
        now,
      })
    ).toBe("2026-10-15");
  });

  it("extracts Bid Date: October 15", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "Bid Date: October 15, 2026",
        bodyText: "",
        now,
      })
    ).toBe("2026-10-15");
  });

  it("chooses bid due over pre-bid meeting date in same email", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "Invitation to Bid",
        bodyText:
          "Pre-bid meeting October 10, 2026. Bids are due October 15, 2026.",
        now,
      })
    ).toBe("2026-10-15");
  });

  it("chooses bid due over RFI deadline", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "ITB",
        bodyText:
          "RFI deadline October 8, 2026. Please submit your bid by October 15, 2026.",
        now,
      })
    ).toBe("2026-10-15");
  });

  it("returns null when only a pre-bid meeting date exists", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "Pre-bid walkthrough",
        bodyText: "Pre-bid meeting October 10, 2026 at the site.",
        now,
      })
    ).toBeNull();
  });

  it("returns null when no deadline", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "Interesting project",
        bodyText: "Let us know if you want to pursue this.",
        now,
      })
    ).toBeNull();
  });

  it("returns null for ambiguous bare dates without bid-due context", () => {
    expect(
      extractBidDueDateDeterministic({
        subject: "Project update",
        bodyText: "See you October 15, 2026 for coordination.",
        now,
      })
    ).toBeNull();
  });
});
