/**
 * Graph-backed resolution of Projects/Bid Invites + Quotes.
 */

import {
  resolveBiddingWorkflowFolders as resolveBiddingWorkflowFoldersPure,
  type BiddingWorkflowFolderResolution,
} from "@forgeops/shared";

import {
  listAllMailFoldersAtLevel,
} from "./outlook-mail-folders.js";

export type { BiddingWorkflowFolderResolution };

export async function resolveBiddingWorkflowFolders(
  accessToken: string
): Promise<
  | { ok: true; result: BiddingWorkflowFolderResolution }
  | { ok: false; code: "PROJECTS_NOT_FOUND" | "PROJECTS_AMBIGUOUS"; message: string }
> {
  return resolveBiddingWorkflowFoldersPure({
    listTopLevelFolders: async () => listAllMailFoldersAtLevel(accessToken),
    listChildFolders: async (parentId) =>
      listAllMailFoldersAtLevel(accessToken, parentId),
  });
}

export { formatMissingBiddingFolders, bidAnalysisTargetFolderIds } from "@forgeops/shared";
