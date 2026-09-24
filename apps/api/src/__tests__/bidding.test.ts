import { describe, expect, it } from "vitest";
import { clearInboxMessageWhere } from "../application/services/clear-inbox.js";
import {
  ACTIVE_BID_STATUS,
  BIDDING_LIST_JOB_SELECT,
  USER_BID_ASSIGNMENT,
  activeBidFromClassification,
  assignmentAllowed,
  bidMatchesDueFilter,
  biddingSummary,
  presentBiddingList,
  statusAfterRemoveFromBidding,
  threadJobConflicts,
} from "../application/services/bidding.js";

const now = new Date("2026-09-24T15:00:00.000Z");

describe("active bidding vs email classification", () => {
  it("does not turn a bidding-classified email into an active bid", () => {
    expect(activeBidFromClassification("BID_OPPORTUNITY")).toBeNull();
    expect(activeBidFromClassification("BID_UPDATE")).toBeNull();
    expect(activeBidFromClassification("ESTIMATE_QUOTE")).toBeNull();
    expect(activeBidFromClassification("GENERAL")).toBeNull();
  });

  it("keeps workflow state when classification changes", () => {
    expect(statusAfterRemoveFromBidding(ACTIVE_BID_STATUS)).toBe("LEAD");
    expect(activeBidFromClassification("REQUEST")).toBeNull();
  });
});

describe("add to bidding", () => {
  it("uses a user assignment the matcher cannot override", () => {
    expect(USER_BID_ASSIGNMENT).toEqual({
      jobAssignmentSource: "USER_ASSIGNED",
      jobAssignmentIsManual: true,
    });
  });

  it("does not treat the same job as a conflict", () => {
    expect(
      threadJobConflicts(
        [
          { jobId: "job-a", jobName: "Nova" },
          { jobId: null },
        ],
        "job-a"
      )
    ).toEqual([]);
  });

  it("requires confirmation before moving a thread off another project", () => {
    const conflicts = threadJobConflicts(
      [
        { jobId: "job-a", jobName: "Project A" },
        { jobId: "job-a", jobName: "Project A" },
        { jobId: "job-b", jobName: "Nova" },
      ],
      "job-b"
    );
    expect(conflicts).toEqual([
      { jobId: "job-a", jobName: "Project A", count: 2 },
    ]);
    expect(assignmentAllowed(conflicts, false)).toBe(false);
    expect(assignmentAllowed(conflicts, true)).toBe(true);
  });
});

describe("remove from bidding", () => {
  it("changes workflow state and does not invent a delete", () => {
    expect(statusAfterRemoveFromBidding("BIDDING")).toBe("LEAD");
    expect(statusAfterRemoveFromBidding("ACTIVE")).toBeNull();
    expect(statusAfterRemoveFromBidding("LEAD")).toBeNull();
  });
});

describe("bidding list", () => {
  const jobs = [
    {
      id: "later",
      name: "MSP Data Center",
      jobNumber: "26-200",
      customerName: "Turner",
      bidDueAt: new Date("2026-10-08T00:00:00.000Z"),
    },
    {
      id: "soon",
      name: "Nova Academy",
      jobNumber: "26-184",
      customerName: "Mortenson",
      bidDueAt: new Date("2026-09-28T00:00:00.000Z"),
    },
    {
      id: "past",
      name: "River Plant",
      jobNumber: null,
      customerName: "Ryan",
      bidDueAt: new Date("2026-09-01T00:00:00.000Z"),
    },
    {
      id: "open",
      name: "Undated Shop",
      jobNumber: null,
      customerName: null,
      bidDueAt: null,
    },
  ];
  const activity = new Map([
    [
      "soon",
      { emailCount: 12, threadCount: 4, unreadCount: 3, lastActivityAt: new Date("2026-09-24T14:00:00.000Z") },
    ],
    [
      "later",
      { emailCount: 2, threadCount: 1, unreadCount: 0, lastActivityAt: new Date("2026-09-20T14:00:00.000Z") },
    ],
  ]);

  it("lists only the rows it is given and sorts by soonest due date", () => {
    const listed = presentBiddingList(jobs, activity, { now, sort: "due" });
    expect(listed.map((job) => job.id)).toEqual(["past", "soon", "later", "open"]);
  });

  it("filters due this week without including past-due bids", () => {
    expect(bidMatchesDueFilter(jobs[1]!.bidDueAt, "week", now)).toBe(true);
    expect(bidMatchesDueFilter(jobs[2]!.bidDueAt, "week", now)).toBe(false);
    expect(presentBiddingList(jobs, activity, { now, due: "week" }).map((j) => j.id)).toEqual(["soon"]);
  });

  it("searches project, number, and customer", () => {
    expect(presentBiddingList(jobs, activity, { now, search: "mort" }).map((j) => j.id)).toEqual(["soon"]);
  });

  it("summarizes unread from batched activity, not per row", () => {
    expect(biddingSummary(jobs, activity, now)).toEqual({
      active: 4,
      dueThisWeek: 1,
      pastDue: 1,
      unread: 3,
    });
  });

  it("projects job fields only", () => {
    expect(BIDDING_LIST_JOB_SELECT).not.toContain("bodyText");
    expect(BIDDING_LIST_JOB_SELECT).toContain("bidDueAt");
  });
});

describe("clear inbox", () => {
  it("keeps job-associated bidding emails on the default clear", () => {
    const where = clearInboxMessageWhere({
      workspaceId: "ws",
      inboxConnectionId: "inbox",
      mode: "NON_JOB_ONLY",
    });
    expect(where.jobId).toBeNull();
    const all = clearInboxMessageWhere({
      workspaceId: "ws",
      inboxConnectionId: "inbox",
      mode: "ALL_EMAILS",
    });
    expect(all.jobId).toBeUndefined();
  });
});
