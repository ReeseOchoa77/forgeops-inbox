/**
 * Pure resolution of Projects/Bid Invites + Projects/Quotes.
 * Graph I/O is injected — never BFS all project folders.
 */

import {
  BIDDING_FOLDER_DISPLAY_NAMES,
  BiddingFolderRole,
  biddingFolderRoleFromDisplayName,
  PROJECTS_ROOT_DISPLAY_NAME,
} from "./bidding-folder-roles.js";

export type BiddingFolderRef = {
  id: string;
  displayName: string;
};

export type BiddingWorkflowFolderResolution = {
  projectsRoot: BiddingFolderRef & { path: string };
  bidInvites: BiddingFolderRef | null;
  quotes: BiddingFolderRef | null;
  missingRoles: BiddingFolderRole[];
};

export async function resolveBiddingWorkflowFolders(deps: {
  listTopLevelFolders: () => Promise<BiddingFolderRef[]>;
  listChildFolders: (parentId: string) => Promise<BiddingFolderRef[]>;
  projectsRootName?: string;
}): Promise<
  | { ok: true; result: BiddingWorkflowFolderResolution }
  | {
      ok: false;
      code: "PROJECTS_NOT_FOUND" | "PROJECTS_AMBIGUOUS";
      message: string;
    }
> {
  const rootName = deps.projectsRootName ?? PROJECTS_ROOT_DISPLAY_NAME;
  const needle = rootName.trim().toLowerCase();
  const top = await deps.listTopLevelFolders();
  const hits = top.filter((f) => f.displayName.trim().toLowerCase() === needle);

  if (hits.length === 0) {
    return {
      ok: false,
      code: "PROJECTS_NOT_FOUND",
      message: `No top-level "${rootName}" mail folder found in this mailbox`,
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      code: "PROJECTS_AMBIGUOUS",
      message: `Multiple top-level "${rootName}" folders found`,
    };
  }

  const root = hits[0]!;
  // ONLY direct children — never recurse into project folders.
  const children = await deps.listChildFolders(root.id);

  let bidInvites: BiddingFolderRef | null = null;
  let quotes: BiddingFolderRef | null = null;
  for (const child of children) {
    const role = biddingFolderRoleFromDisplayName(child.displayName);
    if (role === BiddingFolderRole.BID_INVITES) bidInvites = child;
    if (role === BiddingFolderRole.QUOTES) quotes = child;
  }

  const missingRoles: BiddingFolderRole[] = [];
  if (!bidInvites) missingRoles.push(BiddingFolderRole.BID_INVITES);
  if (!quotes) missingRoles.push(BiddingFolderRole.QUOTES);

  return {
    ok: true,
    result: {
      projectsRoot: { ...root, path: root.displayName },
      bidInvites,
      quotes,
      missingRoles,
    },
  };
}

export function formatMissingBiddingFolders(roles: BiddingFolderRole[]): string {
  return roles
    .map((r) => `${PROJECTS_ROOT_DISPLAY_NAME}/${BIDDING_FOLDER_DISPLAY_NAMES[r]}`)
    .join(", ");
}

/**
 * Contract helper: folders that Bid Analysis is allowed to open for messages.
 * Used in tests to prove normal project folders are never targeted.
 */
export function bidAnalysisTargetFolderIds(
  resolution: BiddingWorkflowFolderResolution
): string[] {
  const ids: string[] = [];
  if (resolution.bidInvites) ids.push(resolution.bidInvites.id);
  if (resolution.quotes) ids.push(resolution.quotes.id);
  return ids;
}
