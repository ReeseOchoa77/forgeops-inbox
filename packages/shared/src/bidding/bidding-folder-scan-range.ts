/**
 * Conservatively defaulted scan windows for Bidding Folder Analysis discovery.
 * Applied as Graph receivedDateTime lower bounds — not client-side filtering.
 */

export const BiddingFolderScanRangePreset = {
  DAYS_30: "30d",
  DAYS_90: "90d",
  DAYS_180: "180d",
  DAYS_365: "365d",
  ALL: "all",
  CUSTOM: "custom",
} as const;

export type BiddingFolderScanRangePreset =
  (typeof BiddingFolderScanRangePreset)[keyof typeof BiddingFolderScanRangePreset];

/** Product default — not all-history. */
export const DEFAULT_BIDDING_FOLDER_SCAN_RANGE: BiddingFolderScanRangePreset =
  BiddingFolderScanRangePreset.DAYS_90;

export const BIDDING_FOLDER_SCAN_RANGE_OPTIONS: Array<{
  value: BiddingFolderScanRangePreset;
  label: string;
  days: number | null;
}> = [
  { value: BiddingFolderScanRangePreset.DAYS_30, label: "Last 30 days", days: 30 },
  { value: BiddingFolderScanRangePreset.DAYS_90, label: "Last 90 days", days: 90 },
  { value: BiddingFolderScanRangePreset.DAYS_180, label: "Last 6 months", days: 180 },
  { value: BiddingFolderScanRangePreset.DAYS_365, label: "Last 12 months", days: 365 },
  { value: BiddingFolderScanRangePreset.ALL, label: "All history", days: null },
  { value: BiddingFolderScanRangePreset.CUSTOM, label: "Custom range", days: null },
];

export function isBiddingFolderScanRangePreset(
  value: string | null | undefined
): value is BiddingFolderScanRangePreset {
  return BIDDING_FOLDER_SCAN_RANGE_OPTIONS.some((o) => o.value === value);
}

/**
 * Resolve inclusive lower bound for Graph `$filter=receivedDateTime ge …`.
 * `null` means all history (no date filter).
 */
export function resolveBiddingFolderScanSinceAt(input: {
  preset: BiddingFolderScanRangePreset;
  /** Required when preset === custom; YYYY-MM-DD or ISO. */
  customSinceAt?: string | Date | null;
  now?: Date;
}): Date | null {
  const now = input.now ?? new Date();
  if (input.preset === BiddingFolderScanRangePreset.ALL) return null;
  if (input.preset === BiddingFolderScanRangePreset.CUSTOM) {
    const raw = input.customSinceAt;
    if (!raw) throw new Error("customSinceAt is required for custom scan range");
    const d = typeof raw === "string" ? new Date(raw) : raw;
    if (Number.isNaN(d.getTime())) throw new Error("Invalid customSinceAt");
    return d;
  }
  const opt = BIDDING_FOLDER_SCAN_RANGE_OPTIONS.find((o) => o.value === input.preset);
  const days = opt?.days;
  if (days == null) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
