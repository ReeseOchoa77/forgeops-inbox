import { describe, expect, it } from "vitest";
import {
  buildOperationalTasksWhere,
  dueAtRangeBounds,
  operationalUnassignedBiddingTaskWhere,
  taskListOrderBy,
  taskStatusBucketWhere,
} from "../tasks/task-list-filters.js";
import {
  calendarIneligibleBiddingTaskWhere,
  isTaskEligibleForCalendar,
} from "../calendar/bidding-calendar-inclusion.js";
import {
  BUSINESS_SUBTYPE_LABELS,
  businessSubtypeLabel,
} from "../business-subtypes.js";

describe("task list filters", () => {
  it("exposes canonical subtype labels (single source)", () => {
    expect(BUSINESS_SUBTYPE_LABELS.BID_OPPORTUNITY).toBe("Bid Opportunity");
    expect(businessSubtypeLabel("RFI_CLARIFICATION")).toBe("RFI / Clarification");
  });

  it("status OPEN includes in-progress/blocked; COMPLETED is DONE", () => {
    expect(taskStatusBucketWhere("OPEN")).toEqual({
      status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
    });
    expect(taskStatusBucketWhere("COMPLETED")).toEqual({ status: "DONE" });
    expect(taskStatusBucketWhere("ALL")).toBeNull();
  });

  it("due TODAY uses timezone day bounds", () => {
    const now = new Date("2026-10-06T18:00:00.000Z");
    const bounds = dueAtRangeBounds("TODAY", "UTC", now);
    expect(bounds.gte.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(bounds.lt.toISOString()).toBe("2026-10-07T00:00:00.000Z");
  });

  it("operational where excludes unassigned bidding + supports filters", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws",
      inboxConnectionId: "conn",
      status: "OPEN",
      due: "OVERDUE",
      priority: "HIGH",
      source: "EMAIL",
      emailClassification: "BUSINESS",
      businessTypeKey: "RFI_CLARIFICATION",
      sender: "mortenson",
      direction: "INCOMING",
      connectionEmail: "shop@example.com",
      jobFilter: "NONE",
      timezone: "UTC",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    const and = where.AND as unknown[];
    expect(and.length).toBeGreaterThan(5);
    expect(JSON.stringify(where)).toContain("RFI_CLARIFICATION");
    expect(JSON.stringify(where)).toContain("mortenson");
    expect(JSON.stringify(where)).toContain("BID_OPPORTUNITY");
  });

  it("Job-scoped list keeps jobId and can include assigned bidding tasks", () => {
    const where = buildOperationalTasksWhere({
      workspaceId: "ws",
      jobId: "job-1",
      excludeUnassignedBidding: false,
      status: "OPEN",
    });
    expect(JSON.stringify(where)).toContain("job-1");
    expect(JSON.stringify(where)).not.toContain("BID_OPPORTUNITY");
  });

  it("default sort prefers dueAt asc nulls last", () => {
    expect(taskListOrderBy("DUE_DATE")[0]).toEqual({
      dueAt: { sort: "asc", nulls: "last" },
    });
  });
});

describe("bidding opportunity separation (Tasks + Calendar)", () => {
  it("operational exclusion matches bidding + sourceEmail.jobId null", () => {
    const where = operationalUnassignedBiddingTaskWhere();
    expect(where).toMatchObject({
      AND: [
        {
          OR: [
            {
              classification: {
                businessTypeKey: { in: ["BID_OPPORTUNITY", "BID_UPDATE"] },
              },
            },
            expect.any(Object),
          ],
        },
        {
          OR: [
            { sourceMessage: { jobId: null } },
            { sourceMessageId: null },
          ],
        },
      ],
    });
  });

  it("Calendar excludes bidding + unassigned source email", () => {
    expect(
      isTaskEligibleForCalendar({
        classification: null,
        sourceMessage: {
          id: "m1",
          jobId: null,
          classifications: [{ businessTypeKey: "BID_OPPORTUNITY" }],
        },
      })
    ).toBe(false);

    expect(
      isTaskEligibleForCalendar({
        classification: null,
        sourceMessage: {
          id: "m1",
          jobId: "job-bid",
          classifications: [{ businessTypeKey: "BID_OPPORTUNITY" }],
          job: {
            id: "job-bid",
            status: "BIDDING",
            bidDueAt: null,
            archivedAt: null,
          },
        },
      })
    ).toBe(true);

    const cal = calendarIneligibleBiddingTaskWhere();
    expect(JSON.stringify(cal)).toContain("jobId");
    expect(JSON.stringify(cal)).toContain("BID_OPPORTUNITY");
  });
});
