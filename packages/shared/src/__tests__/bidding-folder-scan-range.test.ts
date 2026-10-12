import { describe, expect, it } from "vitest";
import {
  DEFAULT_BIDDING_FOLDER_SCAN_RANGE,
  BiddingFolderScanRangePreset,
  resolveBiddingFolderScanSinceAt,
} from "../bidding/bidding-folder-scan-range.js";

describe("bidding folder scan range", () => {
  it("defaults to 90 days, not all history", () => {
    expect(DEFAULT_BIDDING_FOLDER_SCAN_RANGE).toBe(
      BiddingFolderScanRangePreset.DAYS_90
    );
  });

  it("resolves preset lower bounds for Graph filters", () => {
    const now = new Date("2026-10-12T12:00:00.000Z");
    const since90 = resolveBiddingFolderScanSinceAt({
      preset: BiddingFolderScanRangePreset.DAYS_90,
      now,
    });
    expect(since90).not.toBeNull();
    expect(since90!.getTime()).toBe(
      now.getTime() - 90 * 24 * 60 * 60 * 1000
    );

    expect(
      resolveBiddingFolderScanSinceAt({
        preset: BiddingFolderScanRangePreset.ALL,
        now,
      })
    ).toBeNull();
  });

  it("requires customSinceAt for custom preset", () => {
    expect(() =>
      resolveBiddingFolderScanSinceAt({
        preset: BiddingFolderScanRangePreset.CUSTOM,
      })
    ).toThrow(/customSinceAt/);
  });
});
