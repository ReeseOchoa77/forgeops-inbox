/** Re-export shared package — API and worker share one pipeline implementation. */
export {
  ClassificationCandidatesService,
  assembleClassificationCandidates,
  type ClassificationCandidatesInput,
  type ClassificationCandidateRow,
  type ClassificationCandidatesResult,
  type ClassificationCandidatesSourceData,
} from "@forgeops/native-classification";
