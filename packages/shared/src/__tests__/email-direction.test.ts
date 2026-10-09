import { describe, expect, it } from "vitest";
import {
  emailDirectionListWhere,
  mergeEmailDirection,
} from "../email-direction.js";

describe("mergeEmailDirection", () => {
  it("SENT is sticky and never downgrades to RECEIVED", () => {
    expect(
      mergeEmailDirection({ existing: "SENT", incoming: "RECEIVED" })
    ).toBe("SENT");
    expect(
      mergeEmailDirection({ existing: null, incoming: "SENT" })
    ).toBe("SENT");
    expect(
      mergeEmailDirection({ existing: "RECEIVED", incoming: "SENT" })
    ).toBe("SENT");
  });

  it("defaults to RECEIVED when either side is RECEIVED", () => {
    expect(
      mergeEmailDirection({ existing: null, incoming: "RECEIVED" })
    ).toBe("RECEIVED");
  });
});

describe("emailDirectionListWhere", () => {
  it("sentOnly prefers direction=SENT and legacy sender heuristic", () => {
    const where = emailDirectionListWhere({
      sentOnly: true,
      monitoredEmails: ["Estimating@Company.com"],
    });
    expect(where).toEqual({
      OR: [
        { direction: "SENT" },
        {
          AND: [
            { direction: null },
            {
              senderEmail: {
                in: ["estimating@company.com"],
                mode: "insensitive",
              },
            },
          ],
        },
      ],
    });
  });

  it("non-sent prefers direction=RECEIVED and legacy notIn heuristic", () => {
    const where = emailDirectionListWhere({
      sentOnly: false,
      monitoredEmails: ["a@x.com"],
    });
    expect(JSON.stringify(where)).toContain("RECEIVED");
    expect(JSON.stringify(where)).toContain("notIn");
  });
});
