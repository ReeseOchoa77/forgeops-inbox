import { describe, expect, it } from "vitest";
import {
  activeBiddingJobBidDueWhere,
  calendarIneligibleBiddingTaskWhere,
  classifierRawBiddingOpportunityTaskWhere,
  formatBidDueCalendarTitle,
  isRawBiddingOpportunityBusinessType,
  isTaskEligibleForCalendar,
  RAW_BIDDING_OPPORTUNITY_BUSINESS_TYPES,
  shouldSynthesizeBidDueCalendarItem,
  type CalendarTaskEligibilityInput,
} from "../calendar/bidding-calendar-inclusion.js";
import { classifierGeneratedTaskKeyFilter } from "../classifier-generated-tasks.js";

function fixture(partial: {
  businessTypeKey?: string | null;
  viaClassificationFk?: boolean;
  sourceMessageId?: string | null;
  jobId?: string | null;
  job?: CalendarTaskEligibilityInput["sourceMessage"] extends infer S
    ? S extends { job?: infer J }
      ? J
      : never
    : never;
}): CalendarTaskEligibilityInput {
  const businessTypeKey = partial.businessTypeKey ?? null;
  const sourceMessageId =
    partial.sourceMessageId === undefined ? "msg-1" : partial.sourceMessageId;
  if (sourceMessageId === null) {
    return {
      classification: partial.viaClassificationFk
        ? { businessTypeKey }
        : null,
      sourceMessage: null,
    };
  }
  return {
    classification: partial.viaClassificationFk
      ? { businessTypeKey }
      : null,
    sourceMessage: {
      id: sourceMessageId,
      jobId: partial.jobId ?? null,
      classifications: businessTypeKey
        ? [{ businessTypeKey }]
        : [],
      ...(partial.job !== undefined ? { job: partial.job } : {}),
    },
  };
}

describe("bidding calendar inclusion (V1)", () => {
  it("identifies raw bidding opportunity business types", () => {
    expect(isRawBiddingOpportunityBusinessType("BID_OPPORTUNITY")).toBe(true);
    expect(isRawBiddingOpportunityBusinessType("BID_UPDATE")).toBe(true);
    expect(isRawBiddingOpportunityBusinessType("ESTIMATE_QUOTE")).toBe(false);
    expect(isRawBiddingOpportunityBusinessType(null)).toBe(false);
    expect([...RAW_BIDDING_OPPORTUNITY_BUSINESS_TYPES]).toEqual([
      "BID_OPPORTUNITY",
      "BID_UPDATE",
    ]);
  });

  it("builds Prisma Calendar exclusion on bidding + unassigned / Bid Due duplicate", () => {
    const where = calendarIneligibleBiddingTaskWhere();
    expect(where).toMatchObject({
      AND: [
        {
          OR: [
            {
              classification: {
                businessTypeKey: {
                  in: ["BID_OPPORTUNITY", "BID_UPDATE"],
                },
              },
            },
            {
              sourceMessage: {
                classifications: {
                  some: {
                    businessTypeKey: {
                      in: ["BID_OPPORTUNITY", "BID_UPDATE"],
                    },
                  },
                },
              },
            },
          ],
        },
        {
          OR: expect.arrayContaining([
            { sourceMessage: { jobId: null } },
            { sourceMessageId: null },
          ]),
        },
      ],
    });
    // Must NOT gate Calendar on classifier sourceTaskKey (n8n uses opaque SHA keys).
    const json = JSON.stringify(where);
    expect(json).not.toContain("native:");
    expect(json).not.toContain("heuristic-primary");
  });

  it("keeps classifierRawBiddingOpportunityTaskWhere for Tasks-list (classifier keys)", () => {
    expect(classifierRawBiddingOpportunityTaskWhere()).toEqual({
      AND: [
        classifierGeneratedTaskKeyFilter(),
        {
          OR: [
            {
              classification: {
                businessTypeKey: {
                  in: ["BID_OPPORTUNITY", "BID_UPDATE"],
                },
              },
            },
            {
              sourceMessage: {
                classifications: {
                  some: {
                    businessTypeKey: {
                      in: ["BID_OPPORTUNITY", "BID_UPDATE"],
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    });
  });

  it("builds active BIDDING + bidDueAt where for synthetic Bid Due", () => {
    expect(activeBiddingJobBidDueWhere("ws-1")).toEqual({
      workspaceId: "ws-1",
      status: "BIDDING",
      bidDueAt: { not: null },
      archivedAt: null,
    });
  });

  it("formats Bid Due calendar title from job name", () => {
    expect(formatBidDueCalendarTitle("Prieto Battery")).toBe(
      "Bid Due — Prieto Battery"
    );
    expect(formatBidDueCalendarTitle("  ")).toBe("Bid Due — Untitled job");
  });

  it("matrix: synthesize Bid Due only for active BIDDING + bidDueAt", () => {
    expect(
      shouldSynthesizeBidDueCalendarItem({
        status: "BIDDING",
        bidDueAt: new Date("2026-10-14"),
      })
    ).toBe(true);
    expect(
      shouldSynthesizeBidDueCalendarItem({
        status: "BIDDING",
        bidDueAt: null,
      })
    ).toBe(false);
    expect(
      shouldSynthesizeBidDueCalendarItem({
        status: "ACTIVE",
        bidDueAt: new Date("2026-10-14"),
      })
    ).toBe(false);
  });
});

describe("isTaskEligibleForCalendar — source EmailMessage.jobId rule", () => {
  it("CASE 1: BID_OPPORTUNITY + jobId null → excluded", () => {
    expect(
      isTaskEligibleForCalendar(
        fixture({ businessTypeKey: "BID_OPPORTUNITY", jobId: null })
      )
    ).toBe(false);
  });

  it("CASE 2: BID_UPDATE + jobId null → excluded", () => {
    expect(
      isTaskEligibleForCalendar(
        fixture({ businessTypeKey: "BID_UPDATE", jobId: null })
      )
    ).toBe(false);
  });

  it("CASE 3: BID_OPPORTUNITY + assigned BIDDING Job with bidDueAt → excluded (duplicate)", () => {
    expect(
      isTaskEligibleForCalendar(
        fixture({
          businessTypeKey: "BID_OPPORTUNITY",
          jobId: "job-1",
          job: {
            id: "job-1",
            status: "BIDDING",
            bidDueAt: "2026-10-14T00:00:00.000Z",
          },
        })
      )
    ).toBe(false);
  });

  it("CASE 3b: BID_OPPORTUNITY + assigned BIDDING Job without bidDueAt → eligible", () => {
    expect(
      isTaskEligibleForCalendar(
        fixture({
          businessTypeKey: "BID_OPPORTUNITY",
          jobId: "job-1",
          job: {
            id: "job-1",
            status: "BIDDING",
            bidDueAt: null,
          },
        })
      )
    ).toBe(true);
  });

  it("assign then unassign updates eligibility dynamically", () => {
    const assigned = fixture({
      businessTypeKey: "BID_OPPORTUNITY",
      jobId: "job-1",
      job: { id: "job-1", status: "BIDDING", bidDueAt: null },
    });
    expect(isTaskEligibleForCalendar(assigned)).toBe(true);

    const unassigned = fixture({
      businessTypeKey: "BID_OPPORTUNITY",
      jobId: null,
      job: null,
    });
    expect(isTaskEligibleForCalendar(unassigned)).toBe(false);
  });

  it("CASE 6: normal non-bidding email Task + jobId null → eligible", () => {
    expect(
      isTaskEligibleForCalendar(
        fixture({
          businessTypeKey: "SUBMITTAL_SHOP_DRAWING",
          jobId: null,
        })
      )
    ).toBe(true);
  });

  it("manual Task without source email → eligible (not bidding email-derived)", () => {
    expect(
      isTaskEligibleForCalendar({
        classification: null,
        sourceMessage: null,
      })
    ).toBe(true);
  });

  it("CASE 9: bidding email assigned to non-BIDDING Job → eligible as normal Task", () => {
    // Not a Bid Due item (Job status ≠ BIDDING). Task itself may appear;
    // canonical Bid Due is still only BIDDING + bidDueAt.
    expect(
      isTaskEligibleForCalendar(
        fixture({
          businessTypeKey: "BID_OPPORTUNITY",
          jobId: "job-active",
          job: {
            id: "job-active",
            status: "ACTIVE",
            bidDueAt: "2026-10-14T00:00:00.000Z",
          },
        })
      )
    ).toBe(true);
  });

  it("unrelated BIDDING Jobs do not make an unassigned bidding email eligible", () => {
    // Eligibility only inspects THIS source email's jobId — not workspace Jobs.
    expect(
      isTaskEligibleForCalendar(
        fixture({ businessTypeKey: "BID_OPPORTUNITY", jobId: null })
      )
    ).toBe(false);
  });

  it("detects bidding via Task.classification FK when message classifications empty", () => {
    expect(
      isTaskEligibleForCalendar({
        classification: { businessTypeKey: "BID_OPPORTUNITY" },
        sourceMessage: {
          id: "msg-1",
          jobId: null,
          classifications: [],
        },
      })
    ).toBe(false);
  });

  it("n8n-shaped opaque sourceTaskKey is irrelevant — jobId null still excludes", () => {
    // Provenance is classification + sourceMessage.jobId, not sourceTaskKey.
    expect(
      isTaskEligibleForCalendar(
        fixture({ businessTypeKey: "BID_OPPORTUNITY", jobId: null })
      )
    ).toBe(false);
  });
});
