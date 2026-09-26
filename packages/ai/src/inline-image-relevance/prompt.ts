import { withResponsesJsonObjectInputPrefix } from "../openai/responses-json.js";

export const INLINE_IMAGE_RELEVANCE_INSTRUCTIONS = [
  "You classify whether one inline email image is useful project evidence or email presentation noise.",
  "If the image might contain project-specific visual information, relevance must be RELEVANT.",
  "Keep construction or site photos, steel or fabrication photos, drawing screenshots, plans or details, markups, screenshots of project information, product or reference images, installation photos, damage or field-condition photos, and dimension or detail screenshots.",
  "Use NOISE only when the image is clearly a logo, icon, signature graphic, decorative branding, tracking pixel, badge, or footer graphic.",
  "If you are unsure, use UNCERTAIN.",
  "Do not extract job facts, read drawings, OCR text, or measure quantities.",
  "Do not include chain-of-thought. Return only the JSON object.",
].join(" ");

export function inlineImageRelevanceUserText(input: {
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}): string {
  const width = input.width == null ? "unknown" : String(input.width);
  const height = input.height == null ? "unknown" : String(input.height);
  return withResponsesJsonObjectInputPrefix(
    [
      "Classify this inline email image.",
      `MIME: ${input.mimeType}`,
      `Bytes: ${input.sizeBytes}`,
      `Width: ${width}`,
      `Height: ${height}`,
      "Dimensions are evidence only. A small image is not automatically noise.",
      "Return JSON with exactly these keys: relevance, noiseReason, confidence, evidence.",
      "relevance is RELEVANT, NOISE, or UNCERTAIN.",
      "noiseReason is null unless relevance is NOISE. Then it is LOGO, ICON, SIGNATURE_GRAPHIC, DECORATIVE, TRACKING_PIXEL, BADGE, REPEATED_BRANDING, or OTHER_NOISE.",
      "confidence is a number from 0 to 1.",
      "evidence is one short phrase describing what is visible.",
    ].join("\n")
  );
}
