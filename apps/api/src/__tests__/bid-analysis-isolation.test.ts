import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isBiddingWorkflowFolderName } from "@forgeops/shared";

const here = import.meta.dirname;

describe("Project Folder Analysis excludes bidding workflow folders", () => {
  it("scan-project-folders filters Bid Invites / Quotes from Job matching", () => {
    const src = readFileSync(
      join(here, "../application/services/scan-project-folders.ts"),
      "utf8"
    );
    expect(src).toContain("isBiddingWorkflowFolderName");
    expect(src).toMatch(/filter[\s\S]*isBiddingWorkflowFolderName/);
  });

  it("enqueue project-folder analyze drops bidding workflow folders", () => {
    const src = readFileSync(
      join(here, "../application/services/enqueue-project-folder-email-analyze.ts"),
      "utf8"
    );
    expect(src).toContain("isBiddingWorkflowFolderName");
    expect(src).toContain("!isBiddingWorkflowFolderName(v.rawFolderName)");
  });

  it("helpers treat Bid Invites / Quotes as bidding workflow, not unmapped projects", () => {
    expect(isBiddingWorkflowFolderName("Bid Invites")).toBe(true);
    expect(isBiddingWorkflowFolderName("Quotes")).toBe(true);
    expect(isBiddingWorkflowFolderName("25-100 Some Job")).toBe(false);
  });
});

describe("Bid Analysis never auto-creates Jobs", () => {
  it("processor stages candidates only", () => {
    const src = readFileSync(
      join(
        here,
        "../../../worker/src/application/processors/bid-email-analyze.processor.ts"
      ),
      "utf8"
    );
    expect(src).toContain("NEVER creates Jobs");
    expect(src).not.toMatch(/prisma\.job\.create/);
    expect(src).toContain('origin: "BID_ANALYSIS"');
    expect(src).toContain("bidCandidate.create");
  });

  it("promote is separate explicit service", () => {
    const src = readFileSync(
      join(here, "../application/services/promote-bid-candidate.ts"),
      "utf8"
    );
    expect(src).toContain("Analysis never calls this");
    expect(src).toContain("ACTIVE_BID_STATUS");
    expect(src).toContain('status: "CONFIRMED"');
  });

  it("route requires OWNER/ADMIN for promote", () => {
    const src = readFileSync(
      join(here, "../interfaces/http/routes/bid-analysis.route.ts"),
      "utf8"
    );
    expect(src).toContain("canPromoteBidCandidate");
    expect(src).toContain("Only OWNER/ADMIN can create bids from staging");
  });
});
