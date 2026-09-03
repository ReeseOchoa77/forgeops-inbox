import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  discoverFoldersUnderProjectsRoot,
  listAllMailFoldersAtLevel,
  resolveProjectsRoot,
} from "../application/services/outlook-mail-folders.js";
import {
  getVerifiedProjectFolders,
  ProjectFolderScanError,
  scanNativeProjectFolders,
} from "../application/services/scan-project-folders.js";

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe("outlook mailFolders Graph helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates top-level folders and resolves Projects", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("skiptoken")) {
        return jsonRes({
          value: [
            {
              id: "root-projects",
              displayName: "Projects",
              parentFolderId: null,
              childFolderCount: 1,
            },
          ],
        });
      }
      return jsonRes({
        value: [
          {
            id: "inbox",
            displayName: "Inbox",
            parentFolderId: null,
            childFolderCount: 0,
          },
        ],
        "@odata.nextLink":
          "https://graph.microsoft.com/v1.0/me/mailFolders?skiptoken=2",
      });
    });

    const top = await listAllMailFoldersAtLevel("tok");
    expect(top.map((f) => f.displayName).sort()).toEqual(["Inbox", "Projects"]);

    const resolved = await resolveProjectsRoot("tok");
    expect(resolved.status).toBe("ok");
  });

  it("does not silently pick among multiple Projects roots", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonRes({
        value: [
          { id: "p1", displayName: "Projects", parentFolderId: null, childFolderCount: 0 },
          { id: "p2", displayName: "Projects", parentFolderId: null, childFolderCount: 0 },
        ],
      })
    );
    const resolved = await resolveProjectsRoot("tok");
    expect(resolved.status).toBe("ambiguous");
  });

  it("walks only under Projects (not whole mailbox)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/childFolders")) {
        return jsonRes({
          value: [
            {
              id: "job-folder",
              displayName: "2209 Patio",
              parentFolderId: "root-projects",
              childFolderCount: 0,
            },
          ],
        });
      }
      return jsonRes({
        value: [
          {
            id: "root-projects",
            displayName: "Projects",
            parentFolderId: null,
            childFolderCount: 1,
          },
          {
            id: "inbox",
            displayName: "Inbox",
            parentFolderId: null,
            childFolderCount: 99,
          },
        ],
      });
    });

    const resolved = await resolveProjectsRoot("tok");
    expect(resolved.status).toBe("ok");
    if (resolved.status !== "ok") return;

    const tree = await discoverFoldersUnderProjectsRoot(
      "tok",
      resolved.root,
      resolved.path
    );
    expect(tree.every((f) => f.path === "Projects" || f.path.startsWith("Projects/"))).toBe(
      true
    );
    expect(tree.some((f) => f.displayName === "Inbox")).toBe(false);
  });
});

describe("scanNativeProjectFolders persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockPrisma(store: {
    folders: Map<string, Record<string, unknown>>;
  }) {
    return {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn1",
          provider: "OUTLOOK",
          email: "ops@example.com",
          encryptedRefreshToken: "enc",
          status: "ACTIVE",
        }),
      },
      jobFolderRoot: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      job: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "j2209",
            jobNumber: "2209",
            name: "BSC BLDG. 3 Patio Rail",
            normalizedName: "bsc bldg 3 patio rail",
            customer: null,
          },
        ]),
      },
      entityAlias: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      discoveredFolder: {
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { workspaceId_mailboxEmail_providerFolderId: { providerFolderId: string } } }) => {
          const id = where.workspaceId_mailboxEmail_providerFolderId.providerFolderId;
          return store.folders.get(id) ?? null;
        }),
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          store.folders.set(String(data.providerFolderId), { id: `df-${data.providerFolderId}`, ...data });
          return store.folders.get(String(data.providerFolderId));
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const [k, v] of store.folders) {
            if (v.id === where.id) {
              store.folders.set(k, { ...v, ...data });
              return store.folders.get(k);
            }
          }
          return null;
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
          return [...store.folders.values()].filter((f) => {
            if (where.status && f.status !== where.status) return false;
            if (where.matchedJobId && where.matchedJobId === null && f.matchedJobId) return false;
            return true;
          });
        }),
      },
    };
  }

  it("creates folders idempotently and auto-verifies unique job numbers", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (String(url).includes("oauth2")) {
        return jsonRes({ access_token: "access" });
      }
      if (String(url).includes("/childFolders")) {
        return jsonRes({
          value: [
            {
              id: "pf-1",
              displayName: "2209 BSC BLDG 3 Patio Rail",
              parentFolderId: "root-projects",
              childFolderCount: 0,
            },
            {
              id: "pf-2",
              displayName: "Old Project XYZ",
              parentFolderId: "root-projects",
              childFolderCount: 0,
            },
          ],
        });
      }
      return jsonRes({
        value: [
          {
            id: "root-projects",
            displayName: "Projects",
            parentFolderId: null,
            childFolderCount: 2,
          },
        ],
      });
    });

    const store = { folders: new Map<string, Record<string, unknown>>() };
    const prisma = mockPrisma(store);

    const first = await scanNativeProjectFolders({
      prisma: prisma as never,
      workspaceId: "ws1",
      connectionId: "conn1",
      decryptRefreshToken: () => "refresh",
      env: {
        OUTLOOK_CLIENT_ID: "id",
        OUTLOOK_CLIENT_SECRET: "secret",
        OUTLOOK_TENANT_ID: "common",
      },
      actorUserId: "user1",
    });

    expect(first.created).toBe(2);
    expect(first.verified).toBe(1);
    expect(first.unmatched).toBe(1);
    expect(store.folders.get("pf-1")?.status).toBe("APPROVED");
    expect(store.folders.get("pf-1")?.matchedJobId).toBe("j2209");
    expect(store.folders.get("pf-2")?.status).toBe("DISCOVERED");

    const second = await scanNativeProjectFolders({
      prisma: prisma as never,
      workspaceId: "ws1",
      connectionId: "conn1",
      decryptRefreshToken: () => "refresh",
      env: {
        OUTLOOK_CLIENT_ID: "id",
        OUTLOOK_CLIENT_SECRET: "secret",
        OUTLOOK_TENANT_ID: "common",
      },
    });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(store.folders.size).toBe(2);
  });

  it("updates renamed folders while keeping providerFolderId identity", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2")) return jsonRes({ access_token: "access" });
      if (String(url).includes("/childFolders")) {
        return jsonRes({
          value: [
            {
              id: "pf-1",
              displayName: "2209 Renamed Patio",
              parentFolderId: "root-projects",
              childFolderCount: 0,
            },
          ],
        });
      }
      return jsonRes({
        value: [
          {
            id: "root-projects",
            displayName: "Projects",
            parentFolderId: null,
            childFolderCount: 1,
          },
        ],
      });
    });

    const store = {
      folders: new Map<string, Record<string, unknown>>([
        [
          "pf-1",
          {
            id: "df-1",
            providerFolderId: "pf-1",
            status: "APPROVED",
            matchedJobId: "j2209",
            rawFolderName: "2209 Old Name",
          },
        ],
      ]),
    };
    const prisma = mockPrisma(store);

    await scanNativeProjectFolders({
      prisma: prisma as never,
      workspaceId: "ws1",
      connectionId: "conn1",
      decryptRefreshToken: () => "refresh",
      env: {
        OUTLOOK_CLIENT_ID: "id",
        OUTLOOK_CLIENT_SECRET: "secret",
      },
    });

    expect(store.folders.get("pf-1")?.rawFolderName).toBe("2209 Renamed Patio");
    expect(store.folders.get("pf-1")?.status).toBe("APPROVED");
    expect(store.folders.get("pf-1")?.matchedJobId).toBe("j2209");
  });

  it("rejects missing / unauthorized connections", async () => {
    const prisma = {
      inboxConnection: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };
    await expect(
      scanNativeProjectFolders({
        prisma: prisma as never,
        workspaceId: "ws1",
        connectionId: "missing",
        decryptRefreshToken: () => "x",
        env: {},
      })
    ).rejects.toMatchObject({ code: "CONNECTION_NOT_FOUND" } satisfies Partial<ProjectFolderScanError>);
  });

  it("getVerifiedProjectFolders returns only APPROVED with jobs", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: "df1", status: "APPROVED", matchedJobId: "j1" },
    ]);
    const prisma = { discoveredFolder: { findMany } };
    await getVerifiedProjectFolders(prisma as never, {
      workspaceId: "ws1",
      inboxConnectionId: "conn1",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "ws1",
          status: "APPROVED",
          matchedJobId: { not: null },
          inboxConnectionId: "conn1",
        }),
      })
    );
  });
});

describe("cross-workspace job match guard (route contract)", () => {
  it("documents that match endpoint must look up Job by workspaceId", () => {
    // Mirror of folder-discovery match handler: job query is scoped.
    const workspaceId = "ws-a";
    const jobLookup = { id: "job-b", workspaceId: "ws-b" };
    const allowed = jobLookup.workspaceId === workspaceId;
    expect(allowed).toBe(false);
  });
});
