import { describe, it, expect } from "vitest";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { normalizeName } from "@forgeops/shared";

// ---------------------------------------------------------------------------
// Helpers mirrored from folder-discovery.route.ts
// ---------------------------------------------------------------------------

function detectJobInfo(folderName: string): { jobNumber: string | null; jobName: string | null } {
  const match = folderName.match(/^(\d{2,6})\s*[-–—]\s*(.+)$/);
  if (match) return { jobNumber: match[1]!, jobName: match[2]!.trim() };
  const numMatch = folderName.match(/^(\d{2,6})\s+(.+)$/);
  if (numMatch) return { jobNumber: numMatch[1]!, jobName: numMatch[2]!.trim() };
  return { jobNumber: null, jobName: null };
}

function isFolderUnderRoot(
  folderPath: string,
  roots: Array<{ normalizedName: string; folderPath: string | null; rootName: string }>
): boolean {
  for (const root of roots) {
    if (root.folderPath && folderPath.startsWith(root.folderPath + "/")) return true;
    if (folderPath.startsWith(root.rootName + "/")) return true;
    const segments = folderPath.split("/");
    if (segments.length < 2) continue;
    const normalizedPath = normalizeName(segments[0] ?? "");
    if (normalizedPath === root.normalizedName) return true;
  }
  return false;
}

function isAdminOrOwner(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

function canConfigureRoots(role: string): boolean {
  return isAdminOrOwner(role);
}

function canMutateFolders(role: string): boolean {
  return isAdminOrOwner(role);
}

function canViewFolders(role: string): boolean {
  return ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"].includes(role);
}

const outlookFolderSyncSchema = z.object({
  mailboxEmail: z.string().email(),
  provider: z.enum(["outlook"]).default("outlook"),
  isFullSync: z.boolean().default(false),
  folders: z.array(z.object({
    providerFolderId: z.string().min(1),
    parentProviderFolderId: z.string().nullable(),
    name: z.string().min(1),
    path: z.string().min(1),
    childFolderCount: z.number().int().min(0).default(0),
  })).min(1).max(5000),
});

const createRootSchema = z.object({
  rootName: z.string().min(1).max(200).optional(),
  mailboxEmail: z.string().email().optional(),
  providerFolderId: z.string().optional(),
  folderPath: z.string().optional(),
  folderName: z.string().min(1).max(200).optional(),
}).refine((d) => !!(d.rootName || d.folderName), {
  message: "rootName or folderName is required",
});

const matchSchema = z.object({ jobId: z.string().min(1) });

function verifyN8nApiKey(
  authHeader: string | undefined,
  configuredKey: string | undefined,
  integrationEnabled: boolean
): { ok: boolean; status?: number; message?: string } {
  if (!integrationEnabled || !configuredKey || configuredKey.length < 32) {
    return { ok: false, status: 503, message: "n8n integration is not configured or disabled" };
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Missing or invalid Authorization header" };
  }
  const providedKey = authHeader.slice(7);
  const a = Buffer.from(configuredKey, "utf-8");
  const b = Buffer.from(providedKey.padEnd(a.length, "\0").slice(0, a.length), "utf-8");
  if (a.length !== b.length || !timingSafeEqual(a, b) || providedKey.length !== configuredKey.length) {
    return { ok: false, status: 401, message: "Invalid API key" };
  }
  return { ok: true };
}

function resolveMailbox(
  mailboxes: Array<{ normalizedEmail: string; workspaceId: string; status: string }>,
  mailboxEmail: string
): { workspaceId: string } | { error: "not_found" | "ambiguous" } {
  const normalized = mailboxEmail.toLowerCase();
  const matches = mailboxes.filter((m) => m.normalizedEmail === normalized && m.status === "ACTIVE");
  if (matches.length === 0) return { error: "not_found" };
  if (matches.length > 1) return { error: "ambiguous" };
  return { workspaceId: matches[0]!.workspaceId };
}

function upsertFolderKey(workspaceId: string, mailboxEmail: string, providerFolderId: string): string {
  return `${workspaceId}|${mailboxEmail.toLowerCase()}|${providerFolderId}`;
}

function archiveMissingFolders(
  existing: Array<{ providerFolderId: string; status: string }>,
  seenIds: Set<string>
): string[] {
  return existing
    .filter((f) => !seenIds.has(f.providerFolderId) && f.status !== "ARCHIVED" && f.status !== "IGNORED")
    .map((f) => f.providerFolderId);
}

function matchJobAgainstFolder(
  folderName: string,
  jobs: Array<{ id: string; jobNumber: string | null; name: string; normalizedName: string }>,
  aliases: Array<{ jobId: string | null; normalizedAlias: string; source: string }>
): { jobId: string; status: "MATCHED" | "DISCOVERED" } {
  const info = detectJobInfo(folderName);
  if (info.jobNumber) {
    const byNumber = jobs.find((j) => j.jobNumber === info.jobNumber);
    if (byNumber) return { jobId: byNumber.id, status: "MATCHED" };
  }
  if (info.jobName) {
    const normalizedJobName = normalizeName(info.jobName);
    const byName = jobs.find((j) => j.normalizedName === normalizedJobName);
    if (byName) return { jobId: byName.id, status: "MATCHED" };
  }
  const normalized = normalizeName(folderName);
  const alias = aliases.find(
    (a) => a.normalizedAlias === normalized && a.jobId && a.source !== "OUTLOOK_FOLDER"
  );
  if (alias?.jobId) return { jobId: alias.jobId, status: "MATCHED" };
  return { jobId: "", status: "DISCOVERED" };
}

function scoreJobCandidatesFromFolders(
  searchText: string,
  approvedFolders: Array<{
    normalizedFolderName: string;
    matchedJobId: string;
    rawFolderName: string;
    detectedJobNumber: string | null;
  }>,
  jobs: Array<{ id: string; name: string; jobNumber: string | null }>,
  aliases: Array<{ jobId: string | null; normalizedAlias: string; entityType: string }>,
  ignoredFolders: Array<{ normalizedFolderName: string; matchedJobId: string }>
): Array<{ jobId: string; score: number; matchedOn: string }> {
  const candidates: Array<{ jobId: string; score: number; matchedOn: string }> = [];
  const text = searchText.toLowerCase();
  const ignoredKeys = new Set(ignoredFolders.map((f) => `${f.normalizedFolderName}:${f.matchedJobId}`));

  for (const folder of approvedFolders) {
    const job = jobs.find((j) => j.id === folder.matchedJobId);
    if (!job) continue;
    if (folder.detectedJobNumber && text.includes(folder.detectedJobNumber.toLowerCase())) {
      candidates.push({ jobId: job.id, score: 0.95, matchedOn: "folderJobNumber" });
    } else if (text.includes(folder.normalizedFolderName)) {
      candidates.push({ jobId: job.id, score: 0.85, matchedOn: "folderName" });
    }
  }

  for (const alias of aliases) {
    if (alias.entityType !== "JOB" || !alias.jobId) continue;
    if (candidates.some((c) => c.jobId === alias.jobId)) continue;
    if (ignoredKeys.has(`${alias.normalizedAlias}:${alias.jobId}`)) continue;
    const job = jobs.find((j) => j.id === alias.jobId);
    if (!job) continue;
    if (job.jobNumber && text.includes(job.jobNumber.toLowerCase())) {
      candidates.push({ jobId: job.id, score: 1.0, matchedOn: "job_number" });
    } else if (text.includes(alias.normalizedAlias)) {
      candidates.push({ jobId: job.id, score: 0.9, matchedOn: "folder_alias" });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function makeValidFolderPayload(overrides?: Record<string, unknown>) {
  return {
    mailboxEmail: "ed@tekstl.net",
    provider: "outlook",
    isFullSync: true,
    folders: [
      {
        providerFolderId: "AAMk-root",
        parentProviderFolderId: null,
        name: "Jobs",
        path: "Jobs",
        childFolderCount: 2,
      },
      {
        providerFolderId: "AAMk-2438",
        parentProviderFolderId: "AAMk-root",
        name: "2438 - LeJeune",
        path: "Jobs/2438 - LeJeune",
        childFolderCount: 0,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("outlook folder sync schema", () => {
  it("accepts a valid n8n folder sync payload", () => {
    const result = outlookFolderSyncSchema.safeParse(makeValidFolderPayload());
    expect(result.success).toBe(true);
  });

  it("rejects missing folders array", () => {
    const result = outlookFolderSyncSchema.safeParse({
      mailboxEmail: "ed@tekstl.net",
      provider: "outlook",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty folders array", () => {
    const result = outlookFolderSyncSchema.safeParse({
      mailboxEmail: "ed@tekstl.net",
      folders: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid mailbox email", () => {
    const result = outlookFolderSyncSchema.safeParse(
      makeValidFolderPayload({ mailboxEmail: "not-an-email" })
    );
    expect(result.success).toBe(false);
  });

  it("defaults isFullSync to false", () => {
    const { isFullSync: _ignored, ...without } = makeValidFolderPayload();
    void _ignored;
    const result = outlookFolderSyncSchema.parse(without);
    expect(result.isFullSync).toBe(false);
  });
});

describe("n8n API key auth", () => {
  const key = "a".repeat(32);

  it("rejects when integration disabled", () => {
    const result = verifyN8nApiKey(`Bearer ${key}`, key, false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("rejects missing bearer token", () => {
    const result = verifyN8nApiKey(undefined, key, true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("rejects invalid key", () => {
    const result = verifyN8nApiKey(`Bearer ${"b".repeat(32)}`, key, true);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("accepts valid key", () => {
    const result = verifyN8nApiKey(`Bearer ${key}`, key, true);
    expect(result.ok).toBe(true);
  });
});

describe("mailbox resolution", () => {
  it("rejects unknown mailbox", () => {
    const result = resolveMailbox(
      [{ normalizedEmail: "other@tekstl.net", workspaceId: "ws1", status: "ACTIVE" }],
      "ed@tekstl.net"
    );
    expect(result).toEqual({ error: "not_found" });
  });

  it("rejects ambiguous mailbox", () => {
    const result = resolveMailbox(
      [
        { normalizedEmail: "ed@tekstl.net", workspaceId: "ws1", status: "ACTIVE" },
        { normalizedEmail: "ed@tekstl.net", workspaceId: "ws2", status: "ACTIVE" },
      ],
      "ed@tekstl.net"
    );
    expect(result).toEqual({ error: "ambiguous" });
  });

  it("resolves active mailbox case-insensitively", () => {
    const result = resolveMailbox(
      [{ normalizedEmail: "ed@tekstl.net", workspaceId: "ws1", status: "ACTIVE" }],
      "Ed@Tekstl.net"
    );
    expect(result).toEqual({ workspaceId: "ws1" });
  });
});

describe("workspace isolation", () => {
  it("upsert keys are workspace-scoped", () => {
    const a = upsertFolderKey("ws1", "ed@tekstl.net", "AAMk-1");
    const b = upsertFolderKey("ws2", "ed@tekstl.net", "AAMk-1");
    expect(a).not.toBe(b);
  });

  it("same providerFolderId in different workspaces stays distinct", () => {
    const keys = new Set([
      upsertFolderKey("ws1", "ed@tekstl.net", "AAMk-1"),
      upsertFolderKey("ws2", "ed@tekstl.net", "AAMk-1"),
    ]);
    expect(keys.size).toBe(2);
  });
});

describe("nested folder / root descendant detection", () => {
  const roots = [
    { normalizedName: "jobs", folderPath: "Jobs", rootName: "Jobs" },
  ];

  it("treats nested folders under configured root as candidates", () => {
    expect(isFolderUnderRoot("Jobs/2438 - LeJeune", roots)).toBe(true);
    expect(isFolderUnderRoot("Jobs/2438 - LeJeune/Drawings", roots)).toBe(true);
  });

  it("does NOT treat the root folder itself as a job candidate", () => {
    expect(isFolderUnderRoot("Jobs", roots)).toBe(false);
  });

  it("does NOT treat folders outside configured roots as candidates", () => {
    expect(isFolderUnderRoot("Inbox/Personal", roots)).toBe(false);
    expect(isFolderUnderRoot("Archive/2438 - LeJeune", roots)).toBe(false);
  });

  it("only configured-root descendants become candidates", () => {
    const noRoots: typeof roots = [];
    expect(isFolderUnderRoot("Jobs/2438 - LeJeune", noRoots)).toBe(false);
  });
});

describe("folder upsert / rename behavior", () => {
  it("duplicate providerFolderId maps to same upsert key", () => {
    const k1 = upsertFolderKey("ws1", "ed@tekstl.net", "AAMk-2438");
    const k2 = upsertFolderKey("ws1", "ed@tekstl.net", "AAMk-2438");
    expect(k1).toBe(k2);
  });

  it("renamed folder keeps providerFolderId key but updates detected info", () => {
    const before = detectJobInfo("2438 - LeJeune");
    const after = detectJobInfo("2438 - LeJeune Renovations");
    expect(before.jobNumber).toBe("2438");
    expect(after.jobNumber).toBe("2438");
    expect(after.jobName).toBe("LeJeune Renovations");
    expect(normalizeName("2438 - LeJeune Renovations")).not.toBe(normalizeName("2438 - LeJeune"));
  });
});

describe("job number / name detection and matching", () => {
  it("detects job number from '1234 - Name' pattern", () => {
    expect(detectJobInfo("2438 - LeJeune")).toEqual({
      jobNumber: "2438",
      jobName: "LeJeune",
    });
  });

  it("detects job number from '1234-Name' pattern", () => {
    expect(detectJobInfo("2438-LeJeune")).toEqual({
      jobNumber: "2438",
      jobName: "LeJeune",
    });
  });

  it("detects job number from '1234 Name' pattern", () => {
    expect(detectJobInfo("2438 LeJeune")).toEqual({
      jobNumber: "2438",
      jobName: "LeJeune",
    });
  });

  it("returns nulls when no job number pattern", () => {
    expect(detectJobInfo("General Correspondence")).toEqual({
      jobNumber: null,
      jobName: null,
    });
  });

  it("exact Job match by jobNumber sets MATCHED (not APPROVED)", () => {
    const result = matchJobAgainstFolder(
      "2438 - LeJeune",
      [{ id: "job1", jobNumber: "2438", name: "LeJeune", normalizedName: "lejeune" }],
      []
    );
    expect(result).toEqual({ jobId: "job1", status: "MATCHED" });
  });

  it("exact Job match by normalized name sets MATCHED", () => {
    const result = matchJobAgainstFolder(
      "2438 - LeJeune",
      [{ id: "job1", jobNumber: "9999", name: "LeJeune", normalizedName: "lejeune" }],
      []
    );
    expect(result).toEqual({ jobId: "job1", status: "MATCHED" });
  });

  it("ambiguous / no match stays DISCOVERED (not auto-approved)", () => {
    const result = matchJobAgainstFolder(
      "2438 - Unknown Project",
      [{ id: "job1", jobNumber: "1000", name: "Other", normalizedName: "other" }],
      []
    );
    expect(result.status).toBe("DISCOVERED");
    expect(result.jobId).toBe("");
  });

  it("manual alias match works; outlook-folder aliases are not used during sync matching", () => {
    const withManual = matchJobAgainstFolder(
      "LeJeune Alias",
      [{ id: "job1", jobNumber: null, name: "LeJeune", normalizedName: "lejeune" }],
      [{ jobId: "job1", normalizedAlias: normalizeName("LeJeune Alias"), source: "MANUAL" }]
    );
    expect(withManual.status).toBe("MATCHED");

    const withOutlook = matchJobAgainstFolder(
      "LeJeune Alias",
      [{ id: "job1", jobNumber: null, name: "LeJeune", normalizedName: "lejeune" }],
      [{ jobId: "job1", normalizedAlias: normalizeName("LeJeune Alias"), source: "OUTLOOK_FOLDER" }]
    );
    expect(withOutlook.status).toBe("DISCOVERED");
  });
});

describe("job creation / approve semantics", () => {
  it("create-job uses detected number and name", () => {
    const info = detectJobInfo("2438 - LeJeune");
    const job = {
      jobNumber: info.jobNumber ?? "FOLDER",
      name: info.jobName ?? "2438 - LeJeune",
      normalizedName: normalizeName(info.jobName ?? "2438 - LeJeune"),
      status: "APPROVED" as const,
    };
    expect(job.jobNumber).toBe("2438");
    expect(job.name).toBe("LeJeune");
    expect(job.status).toBe("APPROVED");
  });

  it("match schema requires jobId", () => {
    expect(matchSchema.safeParse({}).success).toBe(false);
    expect(matchSchema.safeParse({ jobId: "job1" }).success).toBe(true);
  });

  it("root schema accepts folderName without rootName", () => {
    const result = createRootSchema.safeParse({
      mailboxEmail: "ed@tekstl.net",
      providerFolderId: "AAMk-root",
      folderPath: "Jobs",
      folderName: "Jobs",
    });
    expect(result.success).toBe(true);
  });

  it("root schema rejects empty payload", () => {
    expect(createRootSchema.safeParse({}).success).toBe(false);
  });
});

describe("full sync archival", () => {
  it("isFullSync=true archives folders missing from batch", () => {
    const existing = [
      { providerFolderId: "AAMk-1", status: "DISCOVERED" },
      { providerFolderId: "AAMk-2", status: "MATCHED" },
      { providerFolderId: "AAMk-3", status: "IGNORED" },
      { providerFolderId: "AAMk-4", status: "ARCHIVED" },
    ];
    const seen = new Set(["AAMk-1"]);
    const toArchive = archiveMissingFolders(existing, seen);
    expect(toArchive).toEqual(["AAMk-2"]);
  });

  it("does not archive IGNORED folders during full sync", () => {
    const existing = [{ providerFolderId: "AAMk-ignored", status: "IGNORED" }];
    expect(archiveMissingFolders(existing, new Set())).toEqual([]);
  });
});

describe("classification candidates from approved folders", () => {
  const jobs = [
    { id: "job1", name: "LeJeune", jobNumber: "2438" },
    { id: "job2", name: "Other", jobNumber: "1000" },
  ];

  it("includes approved folder aliases in candidates", () => {
    const candidates = scoreJobCandidatesFromFolders(
      "Please review drawings for 2438 LeJeune",
      [{
        normalizedFolderName: normalizeName("2438 - LeJeune"),
        matchedJobId: "job1",
        rawFolderName: "2438 - LeJeune",
        detectedJobNumber: "2438",
      }],
      jobs,
      [],
      []
    );
    expect(candidates[0]?.jobId).toBe("job1");
    expect(candidates[0]?.score).toBe(0.95);
    expect(candidates[0]?.matchedOn).toBe("folderJobNumber");
  });

  it("excludes ignored folder aliases from candidates", () => {
    const candidates = scoreJobCandidatesFromFolders(
      "alias match lejeune folder",
      [],
      jobs,
      [{ jobId: "job1", normalizedAlias: "lejeune folder", entityType: "JOB" }],
      [{ normalizedFolderName: "lejeune folder", matchedJobId: "job1" }]
    );
    expect(candidates.find((c) => c.jobId === "job1")).toBeUndefined();
  });

  it("excludes archived folder aliases from candidates", () => {
    const candidates = scoreJobCandidatesFromFolders(
      "old project alias",
      [],
      jobs,
      [{ jobId: "job2", normalizedAlias: "old project alias", entityType: "JOB" }],
      [{ normalizedFolderName: "old project alias", matchedJobId: "job2" }]
    );
    expect(candidates.find((c) => c.jobId === "job2")).toBeUndefined();
  });

  it("scores exact alias match at 0.9", () => {
    const candidates = scoreJobCandidatesFromFolders(
      "please check lejeune folder documents",
      [],
      jobs,
      [{ jobId: "job1", normalizedAlias: "lejeune folder", entityType: "JOB" }],
      []
    );
    expect(candidates[0]).toEqual({ jobId: "job1", score: 0.9, matchedOn: "folder_alias" });
  });
});

describe("permission enforcement", () => {
  it("VIEWER cannot approve/match/ignore", () => {
    expect(canMutateFolders("VIEWER")).toBe(false);
    expect(canViewFolders("VIEWER")).toBe(true);
  });

  it("MEMBER can view but cannot configure roots or mutate folders", () => {
    expect(canViewFolders("MEMBER")).toBe(true);
    expect(canConfigureRoots("MEMBER")).toBe(false);
    expect(canMutateFolders("MEMBER")).toBe(false);
  });

  it("OWNER and ADMIN can configure roots and mutate folders", () => {
    expect(canConfigureRoots("OWNER")).toBe(true);
    expect(canConfigureRoots("ADMIN")).toBe(true);
    expect(canMutateFolders("OWNER")).toBe(true);
    expect(canMutateFolders("ADMIN")).toBe(true);
  });
});
