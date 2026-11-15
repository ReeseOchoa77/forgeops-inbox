/**
 * Deterministic stratified sampling for Subtype Discovery.
 * Avoids newest-only bias by sampling across time strata (+ optional mailbox strata).
 */

import type {
  SubtypeDiscoveryConfig,
  SubtypeDiscoverySamplePreset,
} from "./types.js";

export type SampleCandidate = {
  id: string;
  receivedAt: Date | null;
  inboxConnectionId: string | null;
};

export type SamplePlan = {
  requestedCount: number | null;
  eligibleCount: number;
  selectedIds: string[];
  samplingMethod: string;
  capped: boolean;
};

export function resolveRequestedSampleSize(
  config: Pick<SubtypeDiscoveryConfig, "samplePreset" | "customCount">,
  eligibleCount: number
): { requested: number | null; preset: SubtypeDiscoverySamplePreset } {
  switch (config.samplePreset) {
    case "ALL_ELIGIBLE":
      return { requested: null, preset: "ALL_ELIGIBLE" };
    case "500":
      return { requested: 500, preset: "500" };
    case "2500":
      return { requested: 2500, preset: "2500" };
    case "10000":
      return { requested: 10000, preset: "10000" };
    case "CUSTOM": {
      const n =
        typeof config.customCount === "number" &&
        Number.isInteger(config.customCount) &&
        config.customCount > 0
          ? Math.min(config.customCount, 10_000)
          : 500;
      return { requested: n, preset: "CUSTOM" };
    }
    default:
      return { requested: 500, preset: "500" };
  }
}

/** FNV-1a 32-bit — stable hash for deterministic shuffle keys. */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic stratified sample:
 * 1. Sort by receivedAt ascending (nulls last), then id.
 * 2. Split into time quintiles (and mailbox buckets when multiple).
 * 3. Round-robin take from each stratum using hash-ordered ids within stratum.
 */
export function sampleEmailsDeterministic(
  candidates: SampleCandidate[],
  requestedCount: number | null,
  seed = "subtype-discovery-v1"
): SamplePlan {
  const eligibleCount = candidates.length;
  if (eligibleCount === 0) {
    return {
      requestedCount,
      eligibleCount: 0,
      selectedIds: [],
      samplingMethod: "empty",
      capped: false,
    };
  }

  if (requestedCount == null || requestedCount >= eligibleCount) {
    const ids = [...candidates]
      .sort(compareCandidates)
      .map((c) => c.id);
    return {
      requestedCount,
      eligibleCount,
      selectedIds: ids,
      samplingMethod:
        requestedCount == null
          ? "all_eligible_sorted"
          : "all_eligible_requested_gte_available",
      capped: requestedCount != null && requestedCount > eligibleCount,
    };
  }

  const target = Math.max(1, Math.min(requestedCount, eligibleCount));
  const sorted = [...candidates].sort(compareCandidates);
  const strata = buildStrata(sorted);
  const selected: string[] = [];
  const selectedSet = new Set<string>();

  // Round-robin across strata with deterministic within-stratum order.
  const queues = strata.map((stratum) =>
    [...stratum].sort(
      (a, b) =>
        fnv1a32(`${seed}:${a.id}`) - fnv1a32(`${seed}:${b.id}`) ||
        a.id.localeCompare(b.id)
    )
  );

  let guard = 0;
  while (selected.length < target && guard < eligibleCount * 3) {
    guard += 1;
    let progressed = false;
    for (const q of queues) {
      while (q.length > 0) {
        const next = q.shift()!;
        if (selectedSet.has(next.id)) continue;
        selectedSet.add(next.id);
        selected.push(next.id);
        progressed = true;
        break;
      }
      if (selected.length >= target) break;
    }
    if (!progressed) break;
  }

  return {
    requestedCount,
    eligibleCount,
    selectedIds: selected,
    samplingMethod: `stratified_time_mailbox_quintiles_fnv1a:${seed}`,
    capped: false,
  };
}

function compareCandidates(a: SampleCandidate, b: SampleCandidate): number {
  const at = a.receivedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bt = b.receivedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

function buildStrata(sorted: SampleCandidate[]): SampleCandidate[][] {
  if (sorted.length === 0) return [];
  const mailboxIds = [
    ...new Set(sorted.map((c) => c.inboxConnectionId ?? "_none")),
  ];
  const useMailbox = mailboxIds.length > 1;

  if (!useMailbox) {
    return splitQuintiles(sorted);
  }

  const byMailbox = new Map<string, SampleCandidate[]>();
  for (const c of sorted) {
    const key = c.inboxConnectionId ?? "_none";
    const list = byMailbox.get(key) ?? [];
    list.push(c);
    byMailbox.set(key, list);
  }

  const strata: SampleCandidate[][] = [];
  for (const list of byMailbox.values()) {
    strata.push(...splitQuintiles(list));
  }
  return strata.filter((s) => s.length > 0);
}

function splitQuintiles(list: SampleCandidate[]): SampleCandidate[][] {
  if (list.length === 0) return [];
  const n = Math.min(5, list.length);
  const strata: SampleCandidate[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < list.length; i++) {
    const bucket = Math.min(n - 1, Math.floor((i * n) / list.length));
    strata[bucket]!.push(list[i]!);
  }
  return strata;
}

export function validateDiscoveryConfig(
  raw: Partial<SubtypeDiscoveryConfig>
): { ok: true; config: SubtypeDiscoveryConfig } | { ok: false; error: string } {
  const preset = raw.samplePreset ?? "500";
  if (
    preset !== "ALL_ELIGIBLE" &&
    preset !== "500" &&
    preset !== "2500" &&
    preset !== "10000" &&
    preset !== "CUSTOM"
  ) {
    return { ok: false, error: "Invalid samplePreset" };
  }
  const mailboxCategory = raw.mailboxCategory ?? "BUSINESS";
  if (
    mailboxCategory !== "BUSINESS" &&
    mailboxCategory !== "PERSONAL" &&
    mailboxCategory !== "ALL"
  ) {
    return { ok: false, error: "Invalid mailboxCategory" };
  }
  let customCount: number | null = null;
  if (preset === "CUSTOM") {
    if (
      typeof raw.customCount !== "number" ||
      !Number.isInteger(raw.customCount) ||
      raw.customCount < 1 ||
      raw.customCount > 10_000
    ) {
      return {
        ok: false,
        error: "CUSTOM sample requires integer customCount between 1 and 10000",
      };
    }
    customCount = raw.customCount;
  }
  return {
    ok: true,
    config: {
      samplePreset: preset,
      customCount,
      mailboxCategory,
      inboxConnectionId: raw.inboxConnectionId ?? null,
      receivedAfter: raw.receivedAfter ?? null,
      receivedBefore: raw.receivedBefore ?? null,
    },
  };
}
