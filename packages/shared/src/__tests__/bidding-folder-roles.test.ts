import { describe, expect, it } from "vitest";
import {
  BiddingFolderRole,
  biddingFolderPath,
  biddingFolderRoleFromDisplayName,
  isBiddingWorkflowFolderName,
} from "../bidding/bidding-folder-roles.js";
import {
  bidAnalysisTargetFolderIds,
  formatMissingBiddingFolders,
  resolveBiddingWorkflowFolders,
} from "../bidding/resolve-bidding-workflow-folders.js";
import {
  QUOTE_AUTO_LINK_THRESHOLD,
  QUOTE_REVIEW_THRESHOLD,
  buildBidCandidateIdentityKey,
  scoreQuoteToBidCandidate,
} from "../bidding/bid-candidate-identity.js";

describe("bidding folder roles", () => {
  it("recognizes Bid Invites and Quotes case-insensitively", () => {
    expect(biddingFolderRoleFromDisplayName("Bid Invites")).toBe(
      BiddingFolderRole.BID_INVITES
    );
    expect(biddingFolderRoleFromDisplayName("  quotes ")).toBe(
      BiddingFolderRole.QUOTES
    );
    expect(isBiddingWorkflowFolderName("Bid Invites")).toBe(true);
    expect(isBiddingWorkflowFolderName("Quotes")).toBe(true);
    expect(isBiddingWorkflowFolderName("25-104 Project Falcon")).toBe(false);
  });

  it("builds semantic paths", () => {
    expect(biddingFolderPath(BiddingFolderRole.BID_INVITES)).toBe(
      "Projects/Bid Invites"
    );
    expect(biddingFolderPath(BiddingFolderRole.QUOTES)).toBe("Projects/Quotes");
  });
});

describe("resolveBiddingWorkflowFolders", () => {
  it("resolves only Bid Invites + Quotes under Projects — not other children", async () => {
    const openedChildren: string[] = [];
    const resolution = await resolveBiddingWorkflowFolders({
      listTopLevelFolders: async () => [
        { id: "root", displayName: "Projects" },
        { id: "inbox", displayName: "Inbox" },
      ],
      listChildFolders: async (parentId) => {
        openedChildren.push(parentId);
        expect(parentId).toBe("root");
        return [
          { id: "invites", displayName: "Bid Invites" },
          { id: "quotes", displayName: "Quotes" },
          { id: "falcon", displayName: "25-104 Project Falcon" },
          { id: "other", displayName: "Nova Academy" },
        ];
      },
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(openedChildren).toEqual(["root"]);
    expect(resolution.result.bidInvites?.id).toBe("invites");
    expect(resolution.result.quotes?.id).toBe("quotes");
    expect(bidAnalysisTargetFolderIds(resolution.result)).toEqual([
      "invites",
      "quotes",
    ]);
    expect(bidAnalysisTargetFolderIds(resolution.result)).not.toContain("falcon");
    expect(bidAnalysisTargetFolderIds(resolution.result)).not.toContain("other");
  });

  it("reports missing roles clearly without scanning fallback folders", async () => {
    const resolution = await resolveBiddingWorkflowFolders({
      listTopLevelFolders: async () => [{ id: "root", displayName: "Projects" }],
      listChildFolders: async () => [
        { id: "falcon", displayName: "25-104 Project Falcon" },
      ],
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.result.missingRoles).toEqual([
      BiddingFolderRole.BID_INVITES,
      BiddingFolderRole.QUOTES,
    ]);
    expect(formatMissingBiddingFolders(resolution.result.missingRoles)).toBe(
      "Projects/Bid Invites, Projects/Quotes"
    );
    expect(bidAnalysisTargetFolderIds(resolution.result)).toEqual([]);
  });
});

describe("bid candidate identity + quote scoring", () => {
  it("groups by project number preferentially", () => {
    expect(
      buildBidCandidateIdentityKey({
        projectNumber: "25104",
        projectName: "Project Falcon",
      })
    ).toBe("num:25104");
  });

  it("keeps unrelated names separate", () => {
    const a = buildBidCandidateIdentityKey({ projectName: "Project Falcon" });
    const b = buildBidCandidateIdentityKey({ projectName: "Nova Academy" });
    expect(a).not.toBe(b);
  });

  it("scores strong quote matches above auto-link without AI", () => {
    const scored = scoreQuoteToBidCandidate({
      quoteProjectName: "Project Falcon",
      quoteProjectNumber: "25104",
      quoteCustomerName: "Mortenson",
      quoteAttachmentNames: ["Project Falcon Structural Quote.pdf"],
      candidate: {
        proposedProjectName: "Project Falcon",
        proposedJobNumber: "25104",
        proposedCustomerName: "Mortenson",
      },
    });
    expect(scored.score).toBeGreaterThanOrEqual(QUOTE_AUTO_LINK_THRESHOLD);
    expect(scored.evidence).toContain("project_number");
  });

  it("leaves weak quote matches below review threshold", () => {
    const scored = scoreQuoteToBidCandidate({
      quoteProjectName: "Unrelated Warehouse",
      candidate: {
        proposedProjectName: "Project Falcon",
        proposedJobNumber: "25104",
      },
    });
    expect(scored.score).toBeLessThan(QUOTE_REVIEW_THRESHOLD);
  });
});
