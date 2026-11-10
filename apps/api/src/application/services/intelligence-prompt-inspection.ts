/**
 * Resolve Intelligence Registry inspectionKeys to live prompt/instruction text.
 * Never duplicates prompt bodies into the registry — imports canonical modules.
 */
import {
  INLINE_IMAGE_RELEVANCE_INSTRUCTIONS,
  SCOPE_DETAIL_PROMPT_RULES,
  biddingIntakeSystemPrompt,
  bidFieldExtractionSystemPrompt,
  businessSubtypeSystemPrompt,
  entitySelectionSystemPrompt,
  existingJobAdjudicationSystemPrompt,
  quoteFieldExtractionSystemPrompt,
  quoteMatchAdjudicationSystemPrompt,
  semanticSignalSystemPrompt,
  taskExtractionSystemPrompt,
} from "@forgeops/ai";

const PROMPT_MAP: Record<string, string> = {
  semanticSignalSystemPrompt,
  businessSubtypeSystemPrompt,
  entitySelectionSystemPrompt,
  taskExtractionSystemPrompt,
  biddingIntakeSystemPrompt,
  bidFieldExtractionSystemPrompt,
  quoteFieldExtractionSystemPrompt,
  quoteMatchAdjudicationSystemPrompt,
  existingJobAdjudicationSystemPrompt,
  SCOPE_DETAIL_PROMPT_RULES,
  INLINE_IMAGE_RELEVANCE_INSTRUCTIONS,
  importExtractionPrompt:
    "Hardcoded EXTRACTION_PROMPT in apps/api ai-import.route.ts (inspect source for canonical text).",
  documentAiAnalysisSystemPrompt:
    "Inline system message in document-library.service runDocumentAiAnalysis (inspect source for canonical text).",
};

export type InspectedInstruction = {
  key: string;
  available: boolean;
  text: string | null;
  note?: string;
};

export function inspectIntelligenceInstructions(
  keys: string[]
): InspectedInstruction[] {
  return keys.map((key) => {
    const text = PROMPT_MAP[key];
    if (text == null) {
      return {
        key,
        available: false,
        text: null,
        note: "No inspection adapter for this key yet.",
      };
    }
    if (text.startsWith("Hardcoded") || text.startsWith("Inline")) {
      return { key, available: true, text: null, note: text };
    }
    return { key, available: true, text };
  });
}
