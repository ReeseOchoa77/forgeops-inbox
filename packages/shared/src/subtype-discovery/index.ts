export * from "./types.js";
export * from "./sampling.js";
export * from "./prepare.js";
export * from "./cluster.js";
export * from "./taxonomy-compare.js";
export * from "./review-types.js";
export * from "./taxonomy-eval.js";

import {
  SUBTYPE_DISCOVERY_CLUSTER_ALGORITHM,
  SUBTYPE_DISCOVERY_EMBEDDING_MODEL,
  SUBTYPE_DISCOVERY_INTERPRET_MODEL_DEFAULT,
  SUBTYPE_DISCOVERY_PIPELINE_VERSION,
} from "./types.js";

export function subtypeDiscoveryAlgorithmVersions(input?: {
  interpretModel?: string;
}): {
  pipelineVersion: string;
  embeddingModel: string;
  clusterAlgorithm: string;
  interpretModel: string;
} {
  return {
    pipelineVersion: SUBTYPE_DISCOVERY_PIPELINE_VERSION,
    embeddingModel: SUBTYPE_DISCOVERY_EMBEDDING_MODEL,
    clusterAlgorithm: SUBTYPE_DISCOVERY_CLUSTER_ALGORITHM,
    interpretModel:
      input?.interpretModel ?? SUBTYPE_DISCOVERY_INTERPRET_MODEL_DEFAULT,
  };
}
