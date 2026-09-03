/**
 * Microsoft Graph mailFolders helpers for native /Projects discovery.
 * Uses caller-supplied access token (from existing InboxConnection OAuth).
 */

export type GraphMailFolder = {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  childFolderCount: number;
};

export type ProjectsRootResolution =
  | {
      status: "ok";
      root: GraphMailFolder;
      path: string;
    }
  | {
      status: "not_found";
      message: string;
    }
  | {
      status: "ambiguous";
      message: string;
      candidates: Array<{ id: string; displayName: string; path: string }>;
    };

type GraphFoldersPage = {
  value?: Array<{
    id: string;
    displayName: string;
    parentFolderId?: string | null;
    childFolderCount?: number;
  }>;
  "@odata.nextLink"?: string;
};

const SELECT = "$select=id,displayName,parentFolderId,childFolderCount";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function graphFetchJson<T>(
  url: string,
  accessToken: string,
  opts?: { maxRetries?: number }
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 4;
  let attempt = 0;
  let lastStatus = 0;
  let lastBody = "";

  while (attempt <= maxRetries) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    lastStatus = res.status;
    if (res.ok) {
      return (await res.json()) as T;
    }

    const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
    lastBody = await res.text().catch(() => "");
    if (!retryable || attempt === maxRetries) {
      throw new Error(`Graph request failed (${res.status}): ${lastBody.slice(0, 200)}`);
    }

    const retryAfter = Number(res.headers.get("Retry-After") || "0");
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt);
    await sleep(delayMs);
    attempt += 1;
  }

  throw new Error(`Graph request failed (${lastStatus}): ${lastBody.slice(0, 200)}`);
}

export async function listMailFoldersPage(
  accessToken: string,
  opts?: { parentFolderId?: string; url?: string }
): Promise<{ folders: GraphMailFolder[]; nextLink: string | null }> {
  const url =
    opts?.url ??
    (opts?.parentFolderId
      ? `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(opts.parentFolderId)}/childFolders?${SELECT}&$top=100`
      : `https://graph.microsoft.com/v1.0/me/mailFolders?${SELECT}&$top=100`);

  const data = await graphFetchJson<GraphFoldersPage>(url, accessToken);
  const folders: GraphMailFolder[] = (data.value ?? []).map((f) => ({
    id: f.id,
    displayName: f.displayName,
    parentFolderId: f.parentFolderId ?? opts?.parentFolderId ?? null,
    childFolderCount: f.childFolderCount ?? 0,
  }));
  return { folders, nextLink: data["@odata.nextLink"] ?? null };
}

/** Paginate all folders at one level (top-level or children of parent). */
export async function listAllMailFoldersAtLevel(
  accessToken: string,
  parentFolderId?: string
): Promise<GraphMailFolder[]> {
  const out: GraphMailFolder[] = [];
  let next: string | null = null;
  let first = true;
  while (first || next) {
    const page = await listMailFoldersPage(accessToken, {
      ...(first
        ? parentFolderId
          ? { parentFolderId }
          : {}
        : { url: next! }),
    });
    out.push(...page.folders);
    next = page.nextLink;
    first = false;
  }
  return out;
}

function buildPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/**
 * Resolve the Projects root among top-level mail folders (paginated).
 * Does not recurse the whole mailbox — only top-level for resolution.
 */
export async function resolveProjectsRoot(
  accessToken: string,
  rootDisplayName = "Projects"
): Promise<ProjectsRootResolution> {
  const topLevel = await listAllMailFoldersAtLevel(accessToken);
  const needle = rootDisplayName.trim().toLowerCase();
  const hits = topLevel.filter((f) => f.displayName.trim().toLowerCase() === needle);

  if (hits.length === 0) {
    return {
      status: "not_found",
      message: `No top-level "${rootDisplayName}" mail folder found in this mailbox`,
    };
  }
  if (hits.length > 1) {
    return {
      status: "ambiguous",
      message: `Multiple top-level "${rootDisplayName}" folders found — refine mailbox or rename duplicates`,
      candidates: hits.map((h) => ({
        id: h.id,
        displayName: h.displayName,
        path: h.displayName,
      })),
    };
  }

  const root = hits[0]!;
  return { status: "ok", root, path: root.displayName };
}

export type DiscoveredGraphFolder = GraphMailFolder & {
  path: string;
  /** True for the Projects root itself (not a job candidate). */
  isRoot: boolean;
};

/**
 * Walk descendants under Projects (BFS). Does not scan unrelated mailbox trees.
 */
export async function discoverFoldersUnderProjectsRoot(
  accessToken: string,
  root: GraphMailFolder,
  rootPath: string
): Promise<DiscoveredGraphFolder[]> {
  const results: DiscoveredGraphFolder[] = [
    { ...root, path: rootPath, isRoot: true },
  ];

  type QueueItem = { id: string; path: string };
  const queue: QueueItem[] = [{ id: root.id, path: rootPath }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = await listAllMailFoldersAtLevel(accessToken, current.id);
    for (const child of children) {
      const path = buildPath(current.path, child.displayName);
      results.push({ ...child, path, isRoot: false });
      if (child.childFolderCount > 0) {
        queue.push({ id: child.id, path });
      }
    }
  }

  return results;
}
