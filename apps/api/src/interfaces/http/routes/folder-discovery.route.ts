import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeName } from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";

const JOB_NUMBER_PATTERNS = [
  /^(\d{2,4}[-.]?\d{2,6})\s/,
  /^#?(\d{4,8})\s/,
  /\b(\d{2,4}[-.]?\d{2,4}[-.]?\d{1,4})\b/
];

function detectJobNumber(folderName: string): string | null {
  for (const pattern of JOB_NUMBER_PATTERNS) {
    const match = folderName.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function buildFolderPath(parentPath: string | null, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

export const registerFolderDiscoveryRoutes = async (app: FastifyInstance): Promise<void> => {

  // --- Sync folders from Outlook ---
  app.post("/api/v1/workspaces/:workspaceId/folders/discover", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership || !["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(membership.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = z.object({
      connectionId: z.string().min(1)
    }).parse(request.body);

    const connection = await app.services.prisma.inboxConnection.findFirst({
      where: { id: body.connectionId, workspaceId, status: "ACTIVE" },
      select: { id: true, provider: true, email: true, encryptedRefreshToken: true }
    });

    if (!connection || !connection.encryptedRefreshToken) {
      return reply.code(404).send({ message: "Active connection not found" });
    }

    if (connection.provider !== "OUTLOOK") {
      return reply.code(400).send({ message: "Folder discovery is currently supported for Outlook only" });
    }

    const refreshToken = app.services.tokenCipher.decrypt(connection.encryptedRefreshToken);
    const env = app.services.env;

    if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) {
      return reply.code(503).send({ message: "Outlook not configured" });
    }

    const tokenUrl = `https://login.microsoftonline.com/${env.OUTLOOK_TENANT_ID}/oauth2/v2.0/token`;
    const tokenBody = new URLSearchParams({
      client_id: env.OUTLOOK_CLIENT_ID,
      client_secret: env.OUTLOOK_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/Mail.Read offline_access"
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString()
    });

    if (!tokenRes.ok) return reply.code(502).send({ message: "Token refresh failed" });
    const tokens = await tokenRes.json() as { access_token: string };

    const allFolders: Array<{ id: string; displayName: string; parentFolderId: string | null; childFolderCount: number }> = [];

    async function fetchFolders(parentId?: string, parentPath?: string) {
      const url = parentId
        ? `https://graph.microsoft.com/v1.0/me/mailFolders/${parentId}/childFolders?$select=id,displayName,parentFolderId,childFolderCount&$top=100`
        : `https://graph.microsoft.com/v1.0/me/mailFolders?$select=id,displayName,parentFolderId,childFolderCount&$top=100`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      if (!res.ok) return;

      const data = await res.json() as { value: Array<{ id: string; displayName: string; parentFolderId: string | null; childFolderCount: number }> };
      for (const folder of data.value) {
        const path = buildFolderPath(parentPath ?? null, folder.displayName);
        allFolders.push({ ...folder, parentFolderId: parentId ?? null });

        if (folder.childFolderCount > 0) {
          await fetchFolders(folder.id, path);
        }
      }
    }

    try {
      await fetchFolders();
    } catch (e) {
      return reply.code(502).send({ message: `Folder fetch failed: ${e instanceof Error ? e.message : "unknown"}` });
    }

    const roots = await app.services.prisma.jobFolderRoot.findMany({
      where: { workspaceId, active: true },
      select: { normalizedName: true }
    });
    const rootNames = new Set(roots.map(r => r.normalizedName));

    const rootFolderIds = new Set<string>();
    for (const folder of allFolders) {
      if (rootNames.has(normalizeName(folder.displayName))) {
        rootFolderIds.add(folder.id);
      }
    }

    function isUnderJobRoot(folderId: string, visited = new Set<string>()): boolean {
      if (rootFolderIds.has(folderId)) return true;
      if (visited.has(folderId)) return false;
      visited.add(folderId);
      const folder = allFolders.find(f => f.id === folderId);
      if (!folder?.parentFolderId) return false;
      return isUnderJobRoot(folder.parentFolderId, visited);
    }

    let discovered = 0;
    let updated = 0;
    const parentPaths = new Map<string, string>();
    for (const folder of allFolders) {
      const parentPath = folder.parentFolderId ? parentPaths.get(folder.parentFolderId) : undefined;
      const path = buildFolderPath(parentPath ?? null, folder.displayName);
      parentPaths.set(folder.id, path);
    }

    for (const folder of allFolders) {
      const normalized = normalizeName(folder.displayName);
      const jobNumber = detectJobNumber(folder.displayName);
      const path = parentPaths.get(folder.id) ?? folder.displayName;
      const isJobCandidate = isUnderJobRoot(folder.id);

      const existing = await app.services.prisma.discoveredFolder.findFirst({
        where: { workspaceId, providerFolderId: folder.id }
      });

      if (existing) {
        await app.services.prisma.discoveredFolder.update({
          where: { id: existing.id },
          data: {
            rawFolderName: folder.displayName,
            normalizedFolderName: normalized,
            detectedJobNumber: jobNumber,
            folderPath: path,
            parentProviderFolderId: folder.parentFolderId,
            childFolderCount: folder.childFolderCount,
            lastSeenAt: new Date()
          }
        });
        updated++;
      } else if (isJobCandidate && !rootFolderIds.has(folder.id)) {
        await app.services.prisma.discoveredFolder.create({
          data: {
            workspaceId,
            provider: "OUTLOOK",
            mailboxEmail: connection.email,
            providerFolderId: folder.id,
            parentProviderFolderId: folder.parentFolderId,
            folderPath: path,
            rawFolderName: folder.displayName,
            normalizedFolderName: normalized,
            detectedJobNumber: jobNumber,
            status: "DISCOVERED",
            childFolderCount: folder.childFolderCount
          }
        });
        discovered++;
      }
    }

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: session.userId,
      entityType: "FOLDER_DISCOVERY",
      entityId: connection.id,
      action: "folders.discovered",
      metadata: { totalFolders: allFolders.length, discovered, updated, jobRoots: [...rootNames] },
      request
    });

    return reply.send({ status: "ok", totalFolders: allFolders.length, discovered, updated });
  });

  // --- List discovered folders ---
  app.get("/api/v1/workspaces/:workspaceId/folders", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const query = z.object({ status: z.enum(["DISCOVERED", "APPROVED", "IGNORED"]).optional() }).parse(request.query);

    const folders = await app.services.prisma.discoveredFolder.findMany({
      where: { workspaceId, ...(query.status ? { status: query.status } : {}) },
      orderBy: [{ status: "asc" }, { folderPath: "asc" }],
      include: {
        matchedJob: { select: { id: true, name: true, jobNumber: true } }
      }
    });

    return reply.send({ folders });
  });

  // --- Approve/Ignore/Match folder ---
  app.patch("/api/v1/workspaces/:workspaceId/folders/:folderId", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), folderId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      status: z.enum(["APPROVED", "IGNORED"]),
      matchedJobId: z.string().nullable().optional()
    }).parse(request.body);

    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership || !["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(membership.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const folder = await app.services.prisma.discoveredFolder.findFirst({
      where: { id: params.folderId, workspaceId: params.workspaceId }
    });

    if (!folder) return reply.code(404).send({ message: "Folder not found" });

    const updateData: Record<string, unknown> = { status: body.status };
    if (body.matchedJobId !== undefined) updateData.matchedJobId = body.matchedJobId;

    await app.services.prisma.discoveredFolder.update({
      where: { id: params.folderId },
      data: updateData
    });

    if (body.status === "APPROVED") {
      const aliasName = folder.rawFolderName;
      const normalizedAlias = normalizeName(aliasName);

      if (body.matchedJobId) {
        await app.services.prisma.entityAlias.upsert({
          where: {
            workspaceId_entityType_normalizedAlias: {
              workspaceId: params.workspaceId,
              entityType: "JOB",
              normalizedAlias
            }
          },
          update: { jobId: body.matchedJobId },
          create: {
            workspaceId: params.workspaceId,
            entityType: "JOB",
            jobId: body.matchedJobId,
            alias: aliasName,
            normalizedAlias,
            source: "IMPORT"
          }
        });
      }
    }

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "DISCOVERED_FOLDER",
      entityId: params.folderId,
      action: `folder.${body.status.toLowerCase()}`,
      metadata: { folderName: folder.rawFolderName, matchedJobId: body.matchedJobId ?? null },
      request
    });

    return reply.send({ status: body.status });
  });

  // --- Job folder roots CRUD ---
  app.get("/api/v1/workspaces/:workspaceId/folders/roots", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const roots = await app.services.prisma.jobFolderRoot.findMany({
      where: { workspaceId },
      orderBy: { rootName: "asc" }
    });

    return reply.send({ roots });
  });

  app.post("/api/v1/workspaces/:workspaceId/folders/roots", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const body = z.object({ rootName: z.string().min(1).max(200) }).parse(request.body);

    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      return reply.code(403).send({ message: "Admin permission required" });
    }

    const normalized = normalizeName(body.rootName);
    const root = await app.services.prisma.jobFolderRoot.upsert({
      where: { workspaceId_normalizedName: { workspaceId, normalizedName: normalized } },
      update: { rootName: body.rootName, active: true },
      create: { workspaceId, rootName: body.rootName, normalizedName: normalized }
    });

    return reply.code(201).send({ root });
  });
};
