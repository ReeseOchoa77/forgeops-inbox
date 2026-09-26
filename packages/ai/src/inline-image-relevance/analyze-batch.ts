import { createHash } from "node:crypto";

import {
  INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
  INLINE_IMAGE_VISION_MAX_BYTES,
  isVisionSupportedImageMime,
  normalizeImageMimeType,
  type InlineImageRelevanceMethod,
} from "./constants.js";
import {
  deterministicInlineImageDecision,
  oversizeImageDecision,
  unsupportedImageDecision,
  type InlineImageDecision,
} from "./deterministic.js";
import { readImageDimensions } from "./dimensions.js";
import { hashReuseDecision, type HashReuseSource } from "./hash-reuse.js";

export type InlineImageCandidate = {
  id: string;
  workspaceId: string;
  isInline: boolean;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  storageKey: string | null;
};

export type StoredInlineImageRelevance = {
  emailAttachmentId: string;
  workspaceId: string;
  relevance: InlineImageDecision["relevance"];
  noiseReason: InlineImageDecision["noiseReason"];
  confidence: number;
  method: InlineImageRelevanceMethod;
  evidence: string;
  contentChecksum: string | null;
};

export type InlineImageRelevanceSave = {
  workspaceId: string;
  emailAttachmentId: string;
  decision: InlineImageDecision;
  contentChecksum: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type InlineImageRelevanceBatchDeps = {
  listCandidates: () => Promise<InlineImageCandidate[]>;
  countRemaining: (workspaceId: string) => Promise<number>;
  findExisting: (input: {
    workspaceId: string;
    emailAttachmentId: string;
  }) => Promise<StoredInlineImageRelevance | null>;
  findHumanHash: (input: {
    workspaceId: string;
    checksum: string;
    excludeAttachmentId: string;
  }) => Promise<HashReuseSource | null>;
  findModelHash: (input: {
    workspaceId: string;
    checksum: string;
    excludeAttachmentId: string;
  }) => Promise<HashReuseSource | null>;
  countRecurrence: (input: {
    workspaceId: string;
    checksum: string;
  }) => Promise<{ messageCount: number; threadCount: number }>;
  readBytes: (storageKey: string) => Promise<Buffer>;
  classifyVision: (input: {
    mimeType: string;
    bytes: Buffer;
    width: number | null;
    height: number | null;
    sizeBytes: number;
  }) => Promise<{ decision: InlineImageDecision; inputTokens: number; outputTokens: number }>;
  save: (row: InlineImageRelevanceSave) => Promise<void>;
};

export type InlineImageRelevanceBatchResult = {
  analyzed: number;
  reused: number;
  failed: number;
  unsupported: number;
  remaining: number;
  deterministic: number;
  hashHuman: number;
  hashModel: number;
  vision: number;
  uncertain: number;
  relevant: number;
  noise: number;
  visionCalls: number;
  inputTokens: number;
  outputTokens: number;
  lastAttachmentId: string | null;
  pageFull: boolean;
};

export class InlineImageVisionUnavailableError extends Error {
  constructor(message = "OpenAI is not configured") {
    super(message);
    this.name = "InlineImageVisionUnavailableError";
  }
}

function emptyResult(pageFull: boolean): InlineImageRelevanceBatchResult {
  return {
    analyzed: 0,
    reused: 0,
    failed: 0,
    unsupported: 0,
    remaining: 0,
    deterministic: 0,
    hashHuman: 0,
    hashModel: 0,
    vision: 0,
    uncertain: 0,
    relevant: 0,
    noise: 0,
    visionCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    lastAttachmentId: null,
    pageFull,
  };
}

function tally(stats: InlineImageRelevanceBatchResult, decision: InlineImageDecision): void {
  stats.analyzed += 1;
  if (decision.relevance === "RELEVANT") stats.relevant += 1;
  if (decision.relevance === "NOISE") stats.noise += 1;
  if (decision.relevance === "UNCERTAIN") stats.uncertain += 1;
  if (decision.method === "DETERMINISTIC") stats.deterministic += 1;
  if (decision.method === "HUMAN_CONFIRMED_HASH_MATCH") stats.hashHuman += 1;
  if (decision.method === "MODEL_HASH_MATCH") stats.hashModel += 1;
  if (decision.method === "VISION") stats.vision += 1;
}

/**
 * Classify one page of inline images.
 * Writes relevance metadata only. There is no attachment update port.
 * One image failure does not reject the page.
 */
export async function analyzeInlineImageBatch(input: {
  workspaceId: string;
  force: boolean;
  limit: number;
  deps: InlineImageRelevanceBatchDeps;
}): Promise<InlineImageRelevanceBatchResult> {
  const candidates = await input.deps.listCandidates();
  const stats = emptyResult(candidates.length >= input.limit);
  for (const candidate of candidates) {
    if (!candidate.isInline || candidate.workspaceId !== input.workspaceId) {
      stats.lastAttachmentId = candidate.id;
      continue;
    }
    try {
      await classifyOne(input.workspaceId, input.force, candidate, input.deps, stats);
    } catch (error) {
      stats.failed += 1;
      if (error instanceof InlineImageVisionUnavailableError) {
        stats.pageFull = false;
        break;
      }
    }
    stats.lastAttachmentId = candidate.id;
  }
  stats.remaining = await input.deps.countRemaining(input.workspaceId);
  return stats;
}

async function classifyOne(
  workspaceId: string,
  force: boolean,
  candidate: InlineImageCandidate,
  deps: InlineImageRelevanceBatchDeps,
  stats: InlineImageRelevanceBatchResult
): Promise<void> {
  const existing = await deps.findExisting({
    workspaceId,
    emailAttachmentId: candidate.id,
  });
  if (
    existing &&
    existing.workspaceId === workspaceId &&
    existing.emailAttachmentId === candidate.id &&
    (!force || existing.method === "HUMAN" || existing.method === "HUMAN_CONFIRMED_HASH_MATCH")
  ) {
    stats.reused += 1;
    return;
  }

  const mime = normalizeImageMimeType(candidate.mimeType);
  if (!mime.startsWith("image/")) return;

  if (!isVisionSupportedImageMime(mime)) {
    const decision = unsupportedImageDecision();
    await persist(deps, candidate, decision, candidate.checksum, null, null);
    stats.unsupported += 1;
    tally(stats, decision);
    return;
  }

  let checksum = candidate.checksum;
  if (checksum) {
    const human = await reuseHash(workspaceId, checksum, candidate.id, deps, "human");
    if (human) {
      await persist(deps, candidate, human, checksum, null, null);
      tally(stats, human);
      return;
    }
  }

  const quick = deterministicInlineImageDecision({
    mimeType: mime,
    sizeBytes: candidate.sizeBytes,
    width: null,
    height: null,
    messageCount: 0,
    threadCount: 0,
  });
  if (quick) {
    await persist(deps, candidate, quick, checksum, null, null);
    tally(stats, quick);
    return;
  }

  if (candidate.sizeBytes > INLINE_IMAGE_VISION_MAX_BYTES) {
    const decision = oversizeImageDecision();
    await persist(deps, candidate, decision, checksum, null, null);
    tally(stats, decision);
    return;
  }

  if (!candidate.storageKey) {
    stats.failed += 1;
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await deps.readBytes(candidate.storageKey);
  } catch {
    stats.failed += 1;
    return;
  }

  if (!checksum) checksum = sha256Hex(bytes);
  if (!candidate.checksum) {
    const human = await reuseHash(workspaceId, checksum, candidate.id, deps, "human");
    if (human) {
      await persist(deps, candidate, human, checksum, null, null);
      tally(stats, human);
      return;
    }
  }

  const dimensions = readImageDimensions(bytes);
  const strong = deterministicInlineImageDecision({
    mimeType: mime,
    sizeBytes: candidate.sizeBytes,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    messageCount: 0,
    threadCount: 0,
  });
  if (strong) {
    await persist(deps, candidate, strong, checksum, null, null);
    tally(stats, strong);
    return;
  }

  const model = await reuseHash(workspaceId, checksum, candidate.id, deps, "model");
  if (model) {
    await persist(deps, candidate, model, checksum, null, null);
    tally(stats, model);
    return;
  }

  let recurrence = { messageCount: 0, threadCount: 0 };
  if (candidate.checksum && candidate.sizeBytes <= 50_000) {
    recurrence = await deps.countRecurrence({
      workspaceId,
      checksum: candidate.checksum,
    });
  }
  const decided = deterministicInlineImageDecision({
    mimeType: mime,
    sizeBytes: candidate.sizeBytes,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    messageCount: recurrence.messageCount,
    threadCount: recurrence.threadCount,
  });
  if (decided) {
    await persist(deps, candidate, decided, checksum, null, null);
    tally(stats, decided);
    return;
  }

  stats.visionCalls += 1;
  let vision: { decision: InlineImageDecision; inputTokens: number; outputTokens: number };
  try {
    vision = await deps.classifyVision({
      mimeType: mime,
      bytes,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      sizeBytes: candidate.sizeBytes,
    });
  } catch (error) {
    if (error instanceof InlineImageVisionUnavailableError) throw error;
    stats.failed += 1;
    return;
  }
  stats.inputTokens += vision.inputTokens;
  stats.outputTokens += vision.outputTokens;
  await persist(
    deps,
    candidate,
    vision.decision,
    checksum,
    vision.inputTokens,
    vision.outputTokens
  );
  tally(stats, vision.decision);
}

async function reuseHash(
  workspaceId: string,
  checksum: string,
  attachmentId: string,
  deps: InlineImageRelevanceBatchDeps,
  which: "human" | "model"
): Promise<InlineImageDecision | null> {
  const human =
    which === "human"
      ? await deps.findHumanHash({
          workspaceId,
          checksum,
          excludeAttachmentId: attachmentId,
        })
      : null;
  const model =
    which === "model"
      ? await deps.findModelHash({
          workspaceId,
          checksum,
          excludeAttachmentId: attachmentId,
        })
      : null;
  return hashReuseDecision({ workspaceId, human, model });
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function persist(
  deps: InlineImageRelevanceBatchDeps,
  candidate: InlineImageCandidate,
  decision: InlineImageDecision,
  contentChecksum: string | null,
  inputTokens: number | null,
  outputTokens: number | null
): Promise<void> {
  await deps.save({
    workspaceId: candidate.workspaceId,
    emailAttachmentId: candidate.id,
    decision: {
      ...decision,
      analyzerVersion: decision.analyzerVersion || INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION,
    },
    contentChecksum,
    inputTokens,
    outputTokens,
  });
}
