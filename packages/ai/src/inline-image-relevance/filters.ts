import { INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION } from "./constants.js";

/**
 * Stored inline images only. Regular attachments are excluded.
 * Filename is not part of the filter.
 */
export function inlineImageCandidateWhere(input: {
  workspaceId: string;
  afterAttachmentId?: string | null;
  force: boolean;
}) {
  return {
    workspaceId: input.workspaceId,
    isInline: true as const,
    uploadStatus: "UPLOADED" as const,
    mimeType: { startsWith: "image/", mode: "insensitive" as const },
    ...(input.afterAttachmentId ? { id: { gt: input.afterAttachmentId } } : {}),
    ...(input.force
      ? {}
      : {
          relevanceClassifications: {
            none: { analyzerVersion: INLINE_IMAGE_RELEVANCE_ANALYZER_VERSION },
          },
        }),
  };
}
