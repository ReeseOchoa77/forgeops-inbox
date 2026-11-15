/**
 * Subtype Discovery Engine — shared types (read-only recommendations).
 * Does not mutate Classification rows or BUSINESS_SUBTYPE taxonomy.
 */

export const SUBTYPE_DISCOVERY_PIPELINE_VERSION = "subtype-discovery-v1";
export const SUBTYPE_DISCOVERY_EMBEDDING_MODEL = "text-embedding-3-small";
export const SUBTYPE_DISCOVERY_INTERPRET_MODEL_DEFAULT = "chat-latest";
export const SUBTYPE_DISCOVERY_CLUSTER_ALGORITHM = "cosine-connected-components-v1";

export const SUBTYPE_DISCOVERY_SAMPLE_PRESETS = [
  "ALL_ELIGIBLE",
  "500",
  "2500",
  "10000",
  "CUSTOM",
] as const;

export type SubtypeDiscoverySamplePreset =
  (typeof SUBTYPE_DISCOVERY_SAMPLE_PRESETS)[number];

export type SubtypeDiscoveryMailboxCategoryFilter =
  | "BUSINESS"
  | "PERSONAL"
  | "ALL";

export type SubtypeDiscoveryRunStatus =
  | "PENDING"
  | "RUNNING"
  | "CANCELLING"
  | "CANCELLED"
  | "COMPLETED"
  | "FAILED";

export type SubtypeDiscoveryRecommendationKind =
  | "NEW_SUBTYPE"
  | "EXISTING_MATCH"
  | "REFINEMENT"
  | "MERGE_CANDIDATE"
  | "UNCLEAR";

export type SubtypeDiscoveryConfig = {
  samplePreset: SubtypeDiscoverySamplePreset;
  /** Used when samplePreset === CUSTOM; ignored otherwise. */
  customCount: number | null;
  mailboxCategory: SubtypeDiscoveryMailboxCategoryFilter;
  /** Optional inbox connection filter. */
  inboxConnectionId: string | null;
  receivedAfter: string | null;
  receivedBefore: string | null;
};

export type SubtypeDiscoveryPreparedEmail = {
  emailMessageId: string;
  subject: string | null;
  /** Truncated cleaned body for analysis (not persisted as full body). */
  analysisText: string;
  mailboxCategory: string | null;
  businessTypeKey: string | null;
  inboxConnectionId: string | null;
  receivedAt: string | null;
};

export type SubtypeDiscoveryCluster = {
  clusterId: string;
  emailMessageIds: string[];
  representativeIds: string[];
  /** Mean pairwise cosine similarity within cluster (reproducible). */
  meanInternalSimilarity: number;
};

export type SubtypeDiscoveryExampleEmail = {
  emailMessageId: string;
  subject: string | null;
  snippet: string | null;
  mailboxCategory: string | null;
  businessTypeKey: string | null;
};

export type SubtypeDiscoveryRecommendation = {
  id: string;
  clusterId: string;
  kind: SubtypeDiscoveryRecommendationKind;
  suggestedSubtypeName: string | null;
  recommendedParentType: "BUSINESS" | "PERSONAL" | null;
  definition: string | null;
  inclusionCriteria: string | null;
  exclusionCriteria: string | null;
  supportingEmailCount: number;
  /** supportingEmailCount / emailsAnalyzed (0–1). Documented share, not a confidence score. */
  shareOfAnalyzed: number;
  similarExistingSubtypes: string[];
  overlapNotes: string | null;
  rationale: string;
  examples: SubtypeDiscoveryExampleEmail[];
  /**
   * Supporting email ids for review/eval (capped). Not full bodies.
   * Used for proposed-assignment simulation — not classifier output.
   */
  supportingEmailIds?: string[];
  /** Reproducible cluster cohesion (mean internal cosine). Not a model "confidence %". */
  clusterCohesion: number;
};

export type SubtypeDiscoverySummary = {
  emailsEligible: number;
  emailsSelected: number;
  emailsPrepared: number;
  emailsExcluded: number;
  emailsAnalyzed: number;
  clustersDiscovered: number;
  proposedNewSubtypes: number;
  existingSubtypeMatches: number;
  refinements: number;
  mergeCandidates: number;
  unresolvedClusters: number;
  durationMs: number;
  samplingMethod: string;
  embeddingModel: string;
  interpretModel: string;
  clusterAlgorithm: string;
  pipelineVersion: string;
};

export type SubtypeDiscoveryProgress = {
  phase:
    | "QUEUED"
    | "SAMPLING"
    | "PREPARING"
    | "EMBEDDING"
    | "CLUSTERING"
    | "INTERPRETING"
    | "PERSISTING"
    | "DONE"
    | "CANCELLED"
    | "FAILED";
  emailsEligible: number;
  emailsSelected: number;
  emailsPrepared: number;
  emailsEmbedded: number;
  clustersFound: number;
  clustersInterpreted: number;
  message: string | null;
};

export function emptySubtypeDiscoveryProgress(): SubtypeDiscoveryProgress {
  return {
    phase: "QUEUED",
    emailsEligible: 0,
    emailsSelected: 0,
    emailsPrepared: 0,
    emailsEmbedded: 0,
    clustersFound: 0,
    clustersInterpreted: 0,
    message: null,
  };
}

export type SubtypeDiscoveryJobPayload = {
  workspaceId: string;
  runId: string;
  initiatedBy?: string;
};

export type SubtypeDiscoveryJobResult = {
  runId: string;
  status: SubtypeDiscoveryRunStatus;
  recommendationCount: number;
};
