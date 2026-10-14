/**
 * Semantic Outlook folder roles for Bid Analysis.
 * Centralizes Bid Invites / Quotes names — do not scatter string literals.
 */

import { PROJECTS_ROOT_DISPLAY_NAME } from "../project-folders/match-folder-to-job.js";

export const BiddingFolderRole = {
  BID_INVITES: "BID_INVITES",
  QUOTES: "QUOTES",
} as const;

export type BiddingFolderRole =
  (typeof BiddingFolderRole)[keyof typeof BiddingFolderRole];

/** Exact display names under /Projects (case-insensitive match). */
export const BIDDING_FOLDER_DISPLAY_NAMES: Record<BiddingFolderRole, string> = {
  BID_INVITES: "Bid Invites",
  QUOTES: "Quotes",
};

export function normalizeFolderDisplayName(
  name: string | null | undefined
): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function biddingFolderRoleFromDisplayName(
  displayName: string | null | undefined
): BiddingFolderRole | null {
  const n = normalizeFolderDisplayName(displayName);
  if (!n) return null;
  for (const [role, label] of Object.entries(BIDDING_FOLDER_DISPLAY_NAMES) as Array<
    [BiddingFolderRole, string]
  >) {
    if (normalizeFolderDisplayName(label) === n) return role;
  }
  return null;
}

/** True for Bid Invites / Quotes — not ordinary project folders. */
export function isBiddingWorkflowFolderName(
  displayName: string | null | undefined
): boolean {
  return biddingFolderRoleFromDisplayName(displayName) != null;
}

export function biddingFolderPath(
  role: BiddingFolderRole,
  projectsRoot = PROJECTS_ROOT_DISPLAY_NAME
): string {
  return `${projectsRoot}/${BIDDING_FOLDER_DISPLAY_NAMES[role]}`;
}

export { PROJECTS_ROOT_DISPLAY_NAME };
