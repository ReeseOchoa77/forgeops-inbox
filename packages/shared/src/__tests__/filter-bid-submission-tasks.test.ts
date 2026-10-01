import { describe, expect, it } from "vitest";
import {
  filterOutBidSubmissionTasks,
  isBidSubmissionOpportunityTask,
  subjectLooksLikeBidInvitation,
} from "../bidding/filter-bid-submission-tasks.js";

describe("filter bid-submission opportunity Tasks", () => {
  it("suppresses bid-deadline-only Tasks for BID_OPPORTUNITY", () => {
    const tasks = [
      {
        title: "Submit bid for Garden City Elementary",
        description: "Bids due October 15.",
      },
    ];
    expect(
      filterOutBidSubmissionTasks(tasks, {
        businessTypeKey: "BID_OPPORTUNITY",
        subject: "Invitation to Bid — Garden City Elementary",
      })
    ).toEqual([]);
  });

  it("suppresses reminder / pricing-due / proposal-due shapes", () => {
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Submit your proposal", description: "Due October 15" },
        { businessTypeKey: "BID_OPPORTUNITY" }
      )
    ).toBe(true);
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Pricing due Friday at 2 PM", description: "" },
        { businessTypeKey: "BID_OPPORTUNITY" }
      )
    ).toBe(true);
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Reminder: submit your proposal", description: "" },
        {
          businessTypeKey: "BID_OPPORTUNITY",
          subject: "Reminder: submit your proposal by October 15",
        }
      )
    ).toBe(true);
  });

  it("suppresses BID_UPDATE deadline-only Tasks", () => {
    expect(
      filterOutBidSubmissionTasks(
        [{ title: "Update bid deadline", description: "Extended to October 22" }],
        { businessTypeKey: "BID_UPDATE" }
      )
    ).toEqual([]);
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Submit bid", description: "Bid deadline extended to October 22" },
        { businessTypeKey: "BID_UPDATE" }
      )
    ).toBe(true);
  });

  it("keeps confirm-intent Task and drops submit-bid in mixed emails", () => {
    const kept = filterOutBidSubmissionTasks(
      [
        {
          title: "Submit bid",
          description: "Bid due October 15",
        },
        {
          title: "Confirm intent to bid",
          description: "Please confirm by October 5",
        },
      ],
      { businessTypeKey: "BID_OPPORTUNITY" }
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.title).toBe("Confirm intent to bid");
  });

  it("keeps RSVP / questions / substitution Tasks", () => {
    const kept = filterOutBidSubmissionTasks(
      [
        { title: "RSVP for mandatory pre-bid walkthrough", description: "By Oct 7" },
        { title: "Submit bidder questions", description: "By Oct 8" },
        { title: "Submit substitution request", description: "By Oct 10" },
        { title: "Submit proposal by Oct 15", description: "Opportunity deadline" },
      ],
      { businessTypeKey: "BID_OPPORTUNITY" }
    );
    expect(kept.map((t) => t.title)).toEqual([
      "RSVP for mandatory pre-bid walkthrough",
      "Submit bidder questions",
      "Submit substitution request",
    ]);
  });

  it("does not keyword-suppress ESTIMATE_QUOTE Provide pricing", () => {
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Provide pricing", description: "Reply with quote" },
        { businessTypeKey: "ESTIMATE_QUOTE" }
      )
    ).toBe(false);
    expect(
      filterOutBidSubmissionTasks(
        [{ title: "Provide pricing", description: "Reply with quote" }],
        { businessTypeKey: "ESTIMATE_QUOTE" }
      )
    ).toHaveLength(1);
  });

  it("does not suppress non-bidding subtypes", () => {
    expect(
      filterOutBidSubmissionTasks(
        [{ title: "Send revised dimensions", description: "By Friday" }],
        { businessTypeKey: "PROJECT_COORDINATION" }
      )
    ).toHaveLength(1);
    expect(
      filterOutBidSubmissionTasks(
        [{ title: "Sign and return the contract", description: "By Friday" }],
        { businessTypeKey: "PURCHASE_ORDER_CONTRACT" }
      )
    ).toHaveLength(1);
    expect(
      filterOutBidSubmissionTasks(
        [{ title: "Confirm material quantities", description: "By Friday" }],
        { businessTypeKey: "MATERIAL_PURCHASING" }
      )
    ).toHaveLength(1);
  });

  it("uses invitation subject as context when subtype missing (heuristic/n8n)", () => {
    expect(
      subjectLooksLikeBidInvitation(
        "Invitation to Bid — Garden City Elementary. Bids due October 15."
      )
    ).toBe(true);
    expect(
      filterOutBidSubmissionTasks(
        [
          {
            title: "Invitation to Bid — Garden City Elementary",
            description: "Bids due October 15.",
          },
        ],
        {
          businessTypeKey: null,
          subject: "Invitation to Bid — Garden City Elementary",
        }
      )
    ).toEqual([]);
  });

  it("never treats filter as applying outside bidding context", () => {
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Submit bid package drawings", description: "Internal fab package" },
        { businessTypeKey: "SHOP_DRAWINGS", subject: "Shop drawings" }
      )
    ).toBe(false);
  });
});
