import { describe, expect, it } from "vitest";
import {
  calendarIneligibleBiddingTaskWhere,
  formatBidDueCalendarTitle,
  isTaskEligibleForCalendar,
  shouldSynthesizeBidDueCalendarItem,
  type CalendarTaskEligibilityInput,
} from "@forgeops/shared";

/**
 * Assemble Calendar feed using the SAME eligibility helper as production
 * (isTaskEligibleForCalendar), with relational EmailMessage fixtures.
 */
function assembleCalendarFeed(input: {
  events: Array<{ id: string; type: string; startAt: string; title: string }>;
  tasks: Array<{
    id: string;
    title: string;
    dueAt: string;
    eligibility: CalendarTaskEligibilityInput;
  }>;
  jobs: Array<{
    id: string;
    name: string;
    status: string;
    bidDueAt: string | null;
    archivedAt?: string | null;
  }>;
}) {
  const taskDueItems = input.tasks
    .filter((t) => isTaskEligibleForCalendar(t.eligibility))
    .map((t) => ({
      id: t.id,
      title: t.title,
      startAt: t.dueAt,
      type: "TASK" as const,
      kind: "task" as const,
    }));

  const bidDueItems = input.jobs
    .filter((j) =>
      shouldSynthesizeBidDueCalendarItem({
        status: j.status,
        bidDueAt: j.bidDueAt,
        ...(j.archivedAt !== undefined ? { archivedAt: j.archivedAt } : {}),
      })
    )
    .map((j) => ({
      id: `bid-due:${j.id}`,
      title: formatBidDueCalendarTitle(j.name),
      startAt: j.bidDueAt!,
      type: "BID_DUE" as const,
      kind: "bid_due" as const,
      linkedJobId: j.id,
    }));

  return [
    ...input.events.map((e) => ({ ...e, kind: "event" as const })),
    ...taskDueItems,
    ...bidDueItems,
  ];
}

function biddingEmail(opts: {
  jobId: string | null;
  subtype?: "BID_OPPORTUNITY" | "BID_UPDATE";
  job?: NonNullable<CalendarTaskEligibilityInput["sourceMessage"]>["job"];
}): CalendarTaskEligibilityInput {
  const subtype = opts.subtype ?? "BID_OPPORTUNITY";
  return {
    classification: { businessTypeKey: subtype },
    sourceMessage: {
      id: "msg-bid",
      jobId: opts.jobId,
      classifications: [{ businessTypeKey: subtype }],
      ...(opts.job !== undefined ? { job: opts.job } : {}),
    },
  };
}

describe("calendar feed aggregation contract", () => {
  it("keeps task dues separate from CalendarEvent rows", () => {
    const events = [{ id: "e1", type: "MEETING", startAt: "2026-10-01", title: "Meet" }];
    const taskDueItems = [{ id: "t1", type: "TASK" }];
    const feed = [
      ...events.map((e) => ({ ...e, kind: "event" as const })),
      ...taskDueItems.map((t) => ({ ...t, kind: "task" as const })),
    ];
    expect(feed.filter((i) => i.kind === "task")).toHaveLength(1);
  });

  it("Calendar Prisma exclusion uses relation filters (no N+1 pattern)", () => {
    const where = calendarIneligibleBiddingTaskWhere();
    const json = JSON.stringify(where);
    // Batched relation predicates — not a loop of email ids.
    expect(json).toContain("sourceMessage");
    expect(json).toContain("jobId");
    expect(json).not.toContain("native:");
  });

  it("CASE 1: BID_OPPORTUNITY source email jobId null → Task excluded", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t-bid",
          title: "Submit bid by October 14",
          dueAt: "2026-10-14T00:00:00.000Z",
          eligibility: biddingEmail({ jobId: null }),
        },
      ],
      jobs: [],
    });
    expect(feed).toHaveLength(0);
  });

  it("CASE 2: BID_UPDATE source email jobId null → Task excluded", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t-upd",
          title: "Update bid deadline",
          dueAt: "2026-10-22T00:00:00.000Z",
          eligibility: biddingEmail({
            jobId: null,
            subtype: "BID_UPDATE",
          }),
        },
      ],
      jobs: [],
    });
    expect(feed).toHaveLength(0);
  });

  it("assign then clear jobId flips Calendar eligibility", () => {
    const withJob = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t1",
          title: "Confirm scope",
          dueAt: "2026-10-08T00:00:00.000Z",
          eligibility: biddingEmail({
            jobId: "job-1",
            job: { id: "job-1", status: "BIDDING", bidDueAt: null },
          }),
        },
      ],
      jobs: [],
    });
    expect(withJob.filter((i) => i.kind === "task")).toHaveLength(1);

    const cleared = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t1",
          title: "Confirm scope",
          dueAt: "2026-10-08T00:00:00.000Z",
          eligibility: biddingEmail({ jobId: null, job: null }),
        },
      ],
      jobs: [],
    });
    expect(cleared.filter((i) => i.kind === "task")).toHaveLength(0);
  });

  it("CASE 4: BIDDING Job + bidDueAt → Bid Due once", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [],
      jobs: [
        {
          id: "j1",
          name: "Prieto Battery",
          status: "BIDDING",
          bidDueAt: "2026-10-14T00:00:00.000Z",
        },
      ],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      kind: "bid_due",
      title: "Bid Due — Prieto Battery",
    });
  });

  it("CASE 5: manual Task (no source email) on BIDDING Job remains visible", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t-manual",
          title: "Call GC about scope clarification",
          dueAt: "2026-10-08T00:00:00.000Z",
          eligibility: { classification: null, sourceMessage: null },
        },
      ],
      jobs: [
        {
          id: "j1",
          name: "Prieto Battery",
          status: "BIDDING",
          bidDueAt: "2026-10-14T00:00:00.000Z",
        },
      ],
    });
    expect(feed.filter((i) => i.kind === "task")).toHaveLength(1);
    expect(feed.filter((i) => i.kind === "bid_due")).toHaveLength(1);
  });

  it("CASE 6: normal non-bidding email Task + jobId null → visible", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t-shop",
          title: "Submit shop drawings",
          dueAt: "2026-10-10T00:00:00.000Z",
          eligibility: {
            classification: { businessTypeKey: "SUBMITTAL_SHOP_DRAWING" },
            sourceMessage: {
              id: "msg-shop",
              jobId: null,
              classifications: [
                { businessTypeKey: "SUBMITTAL_SHOP_DRAWING" },
              ],
            },
          },
        },
      ],
      jobs: [],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]?.title).toBe("Submit shop drawings");
  });

  it("no duplicate Bid Due + bidding Task when Job has bidDueAt", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t-dup",
          title: "Submit bid — Prieto Battery",
          dueAt: "2026-10-14T00:00:00.000Z",
          eligibility: biddingEmail({
            jobId: "j1",
            job: {
              id: "j1",
              status: "BIDDING",
              bidDueAt: "2026-10-14T00:00:00.000Z",
            },
          }),
        },
      ],
      jobs: [
        {
          id: "j1",
          name: "Prieto Battery",
          status: "BIDDING",
          bidDueAt: "2026-10-14T00:00:00.000Z",
        },
      ],
    });
    expect(feed.filter((i) => i.kind === "bid_due")).toHaveLength(1);
    expect(feed.filter((i) => i.kind === "task")).toHaveLength(0);
  });

  it("unrelated workspace BIDDING Jobs do not unlock unassigned bidding Task", () => {
    const feed = assembleCalendarFeed({
      events: [],
      tasks: [
        {
          id: "t-orphan",
          title: "Submit bid",
          dueAt: "2026-10-14T00:00:00.000Z",
          eligibility: biddingEmail({ jobId: null }),
        },
      ],
      jobs: [
        {
          id: "other-job",
          name: "Other Bid",
          status: "BIDDING",
          bidDueAt: "2026-10-20T00:00:00.000Z",
        },
      ],
    });
    expect(feed.filter((i) => i.kind === "task")).toHaveLength(0);
    expect(feed.filter((i) => i.kind === "bid_due")).toHaveLength(1);
  });

  it("CalendarEvent path unaffected", () => {
    const feed = assembleCalendarFeed({
      events: [
        {
          id: "e1",
          type: "DEADLINE",
          startAt: "2026-10-20T00:00:00.000Z",
          title: "Milestone kickoff",
        },
      ],
      tasks: [],
      jobs: [],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ kind: "event", type: "DEADLINE" });
  });
});
