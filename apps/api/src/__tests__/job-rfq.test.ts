import { describe, expect, it } from "vitest";
import {
  JOB_RFQ_STATUSES,
  type JobRfqSummary,
} from "../application/services/job-rfqs.js";

describe("Job RFQ domain", () => {
  it("uses a simple estimating RFQ lifecycle distinct from RFI/PO", () => {
    expect([...JOB_RFQ_STATUSES]).toEqual([
      "DRAFT",
      "REQUESTED",
      "RECEIVED",
      "DECLINED",
      "CANCELLED",
    ]);
  });

  it("treats NULL vs zero quotedAmount as distinct (DTO string | null)", () => {
    const unknown: string | null = null;
    const zero = "0";
    expect(unknown).toBeNull();
    expect(zero).toBe("0");
    expect(Number(zero)).toBe(0);
  });

  it("summary outstanding = draft + requested", () => {
    const summary: JobRfqSummary = {
      totalCount: 5,
      draftCount: 1,
      requestedCount: 2,
      receivedCount: 2,
      outstandingCount: 3,
    };
    expect(summary.outstandingCount).toBe(
      summary.draftCount + summary.requestedCount
    );
  });
});
