/**
 * Cosine connected-components clustering for Subtype Discovery.
 * Pure TypeScript — no native deps. Deterministic given fixed embeddings + threshold.
 */

import type { SubtypeDiscoveryCluster } from "./types.js";

export function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0 || !Number.isFinite(norm)) {
    return vector.map(() => 0);
  }
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export type ClusterInput = {
  id: string;
  embedding: number[];
};

export type ClusterOptions = {
  /** Edge if cosine similarity >= threshold. Default 0.78. */
  similarityThreshold?: number;
  /** Minimum cluster size to keep as a recommendation candidate. */
  minClusterSize?: number;
  /** Max emails to consider for pairwise edges (subsample large sets). */
  maxPairwiseN?: number;
  /** Max representatives per cluster. */
  maxRepresentatives?: number;
};

/**
 * Build clusters via union-find over pairs with cosine ≥ threshold.
 * For n > maxPairwiseN, sample a deterministic subset for edge building,
 * then assign remaining points to nearest centroid of formed clusters.
 */
export function clusterByCosineConnectedComponents(
  items: ClusterInput[],
  options: ClusterOptions = {}
): {
  clusters: SubtypeDiscoveryCluster[];
  unresolvedIds: string[];
  thresholdUsed: number;
} {
  const threshold = options.similarityThreshold ?? 0.78;
  const minClusterSize = options.minClusterSize ?? 3;
  const maxPairwiseN = options.maxPairwiseN ?? 800;
  const maxRepresentatives = options.maxRepresentatives ?? 5;

  if (items.length === 0) {
    return { clusters: [], unresolvedIds: [], thresholdUsed: threshold };
  }

  const normalized = items.map((it) => ({
    id: it.id,
    embedding: l2Normalize(it.embedding),
  }));

  const core =
    normalized.length <= maxPairwiseN
      ? normalized
      : pickDeterministicSubset(normalized, maxPairwiseN);

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Deterministic attach: lexicographically smaller root wins
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  for (const it of core) parent.set(it.id, it.id);

  for (let i = 0; i < core.length; i++) {
    for (let j = i + 1; j < core.length; j++) {
      const a = core[i]!;
      const b = core[j]!;
      if (cosineSimilarity(a.embedding, b.embedding) >= threshold) {
        union(a.id, b.id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const it of core) {
    const root = find(it.id);
    const list = groups.get(root) ?? [];
    list.push(it.id);
    groups.set(root, list);
  }

  // Assign leftover points (when subsampled) to nearest large-enough group centroid
  if (core.length < normalized.length) {
    const centroids = new Map<string, number[]>();
    for (const [root, ids] of groups) {
      if (ids.length < minClusterSize) continue;
      centroids.set(root, meanEmbedding(ids, normalized));
    }
    for (const it of normalized) {
      if (parent.has(it.id)) continue;
      let bestRoot: string | null = null;
      let bestSim = -1;
      for (const [root, centroid] of centroids) {
        const sim = cosineSimilarity(it.embedding, centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestRoot = root;
        }
      }
      if (bestRoot && bestSim >= threshold) {
        const list = groups.get(bestRoot) ?? [];
        list.push(it.id);
        groups.set(bestRoot, list);
        parent.set(it.id, bestRoot);
      } else {
        parent.set(it.id, it.id);
        groups.set(it.id, [it.id]);
      }
    }
  }

  const embById = new Map(normalized.map((n) => [n.id, n.embedding]));
  const clusters: SubtypeDiscoveryCluster[] = [];
  const unresolvedIds: string[] = [];

  const sortedRoots = [...groups.keys()].sort();
  let clusterIdx = 0;
  for (const root of sortedRoots) {
    const ids = (groups.get(root) ?? []).slice().sort();
    if (ids.length < minClusterSize) {
      unresolvedIds.push(...ids);
      continue;
    }
    clusterIdx += 1;
    const meanInternal = meanPairwiseSimilarity(ids, embById);
    const representatives = pickRepresentatives(
      ids,
      embById,
      maxRepresentatives
    );
    clusters.push({
      clusterId: `c${String(clusterIdx).padStart(3, "0")}`,
      emailMessageIds: ids,
      representativeIds: representatives,
      meanInternalSimilarity: round4(meanInternal),
    });
  }

  return { clusters, unresolvedIds, thresholdUsed: threshold };
}

function pickDeterministicSubset<T extends { id: string }>(
  items: T[],
  n: number
): T[] {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length <= n) return sorted;
  const step = sorted.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(sorted[Math.min(sorted.length - 1, Math.floor(i * step))]!);
  }
  return out;
}

function meanEmbedding(
  ids: string[],
  items: Array<{ id: string; embedding: number[] }>
): number[] {
  const map = new Map(items.map((i) => [i.id, i.embedding]));
  const dim = map.get(ids[0]!)?.length ?? 0;
  const acc = new Array(dim).fill(0);
  let count = 0;
  for (const id of ids) {
    const e = map.get(id);
    if (!e) continue;
    count += 1;
    for (let i = 0; i < dim; i++) acc[i]! += e[i] ?? 0;
  }
  if (count === 0) return acc;
  return l2Normalize(acc.map((v) => v / count));
}

function meanPairwiseSimilarity(
  ids: string[],
  embById: Map<string, number[]>
): number {
  if (ids.length < 2) return 1;
  let sum = 0;
  let count = 0;
  const limit = Math.min(ids.length, 40);
  for (let i = 0; i < limit; i++) {
    for (let j = i + 1; j < limit; j++) {
      const a = embById.get(ids[i]!);
      const b = embById.get(ids[j]!);
      if (!a || !b) continue;
      sum += cosineSimilarity(a, b);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

/** Representatives: closest to centroid, deterministic tie-break by id. */
function pickRepresentatives(
  ids: string[],
  embById: Map<string, number[]>,
  max: number
): string[] {
  const dim = embById.get(ids[0]!)?.length ?? 0;
  const centroid = new Array(dim).fill(0);
  for (const id of ids) {
    const e = embById.get(id);
    if (!e) continue;
    for (let i = 0; i < dim; i++) centroid[i]! += e[i] ?? 0;
  }
  const c = l2Normalize(centroid.map((v) => v / ids.length));
  return [...ids]
    .map((id) => ({
      id,
      sim: cosineSimilarity(embById.get(id) ?? [], c),
    }))
    .sort((a, b) => b.sim - a.sim || a.id.localeCompare(b.id))
    .slice(0, max)
    .map((r) => r.id);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Map existing subtype keys onto a cluster from current labels of member emails.
 * Pure heuristic — not a confidence score.
 */
export function existingSubtypeOverlap(
  memberSubtypeKeys: Array<string | null | undefined>
): { topKeys: string[]; dominantShare: number } {
  const counts = new Map<string, number>();
  let labeled = 0;
  for (const key of memberSubtypeKeys) {
    if (!key) continue;
    labeled += 1;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (labeled === 0) return { topKeys: [], dominantShare: 0 };
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const topKeys = sorted.slice(0, 3).map(([k]) => k);
  const dominantShare = (sorted[0]?.[1] ?? 0) / labeled;
  return { topKeys, dominantShare: round4(dominantShare) };
}
