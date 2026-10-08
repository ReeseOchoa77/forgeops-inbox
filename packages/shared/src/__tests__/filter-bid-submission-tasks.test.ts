import { describe, expect, it } from "vitest";
import {
  filterOutBidSubmissionTasks,
  isBidSubmissionOpportunityTask,
  isRawBiddingOpportunityContext,
  subjectLooksLikeBidInvitation,
} from "../bidding/filter-bid-submission-tasks.js";

describe("filter bid-submission opportunity Tasks (V1: suppress all auto Tasks)", () => {
  it("suppresses all auto Tasks for BID_OPPORTUNITY", () => {
    const tasks = [
      {
        title: "Submit bid for Garden City Elementary",
        description: "Bids due October 15.",
      },
      {
        title: "Confirm intent to bid",
        description: "Please confirm by October 5",
      },
      { title: "RSVP for mandatory pre-bid walkthrough", description: "By Oct 7" },
    ];
    expect(
      filterOutBidSubmissionTasks(tasks, {
        businessTypeKey: "BID_OPPORTUNITY",
        subject: "Invitation to Bid — Garden City Elementary",
      })
    ).toEqual([]);
    expect(
      isRawBiddingOpportunityContext({ businessTypeKey: "BID_OPPORTUNITY" })
    ).toBe(true);
  });

  it("suppresses all auto Tasks for BID_UPDATE", () => {
    expect(
      filterOutBidSubmissionTasks(
        [
          { title: "Update bid deadline", description: "Extended to October 22" },
          { title: "Submit bid", description: "Bid deadline extended" },
        ],
        { businessTypeKey: "BID_UPDATE" }
      )
    ).toEqual([]);
  });

  it("legacy isBidSubmissionOpportunityTask is true for any task in bidding context", () => {
    expect(
      isBidSubmissionOpportunityTask(
        { title: "Anything", description: "" },
        { businessTypeKey: "BID_OPPORTUNITY" }
      )
    ).toBe(true);
  });

  it("does not suppress ESTIMATE_QUOTE Provide pricing", () => {
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
          { title: "Confirm intent to bid", description: "By Oct 5" },
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
    expect(
      isRawBiddingOpportunityContext({
        businessTypeKey: "SHOP_DRAWINGS",
        subject: "Shop drawings",
      })
    ).toBe(false);
  });
});
