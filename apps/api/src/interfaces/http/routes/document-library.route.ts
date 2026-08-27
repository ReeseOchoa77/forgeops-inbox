import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ingestKnowledgeDocument } from "../../../application/services/document-library.service.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const wsParams = z.object({ workspaceId: z.string().min(1) });

const EDITOR_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);

/**
 * Company Data / Job-linked document library upload:
 * store original → extract → optional AI analysis.
 */
export const registerDocumentLibraryRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/documents/upload",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(
        app.services.prisma,
        session.userId,
        workspaceId
      );
      if (!membership || !EDITOR_ROLES.has(membership.role)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      let linkedJobId: string | null = null;
      let runAiAnalysis = false;
      let fileBuffer: Buffer | null = null;
      let fileMimeType: string | null = null;
      let fileFilename: string | null = null;

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "field") {
          if (part.fieldname === "linkedJobId") {
            const val = String(part.value ?? "").trim();
            linkedJobId = val || null;
          }
          if (part.fieldname === "runAiAnalysis") {
            runAiAnalysis =
              String(part.value ?? "").toLowerCase() === "true" ||
              String(part.value ?? "") === "1";
          }
          continue;
        }
        if (part.type === "file" && part.fieldname === "file") {
          fileBuffer = await part.toBuffer();
          fileMimeType = part.mimetype ?? null;
          fileFilename = part.filename ?? null;
        }
      }

      if (!fileBuffer || !fileFilename) {
        return reply.code(400).send({ message: "No file provided" });
      }

      try {
        const result = await ingestKnowledgeDocument({
          prisma: app.services.prisma,
          storage: app.services.attachmentStorage,
          workspaceId,
          userId: session.userId,
          filename: fileFilename,
          mimeType: fileMimeType ?? "application/octet-stream",
          buffer: fileBuffer,
          linkedJobId,
          sourceType: linkedJobId ? "JOB_UPLOAD" : "COMPANY_UPLOAD",
          runAiAnalysis,
        });

        const doc = await app.services.prisma.knowledgeDocument.findUnique({
          where: { id: result.documentId },
          select: {
            id: true,
            filename: true,
            mimeType: true,
            fileSize: true,
            status: true,
            sourceType: true,
            linkedJobId: true,
            aiAnalysisStatus: true,
            createdAt: true,
            createdBy: true,
            extractedText: true,
            extractedJson: true,
            aiAnalysisJson: true,
          },
        });

        return reply.code(201).send({
          document: {
            ...doc,
            extractedTextAvailable: Boolean(doc?.extractedText),
            uploadedBy: doc?.createdBy ?? null,
            uploadedAt: doc?.createdAt ?? null,
            processingStatus: doc?.status ?? result.status,
          },
        });
      } catch (e) {
        const statusCode =
          e && typeof e === "object" && "statusCode" in e
            ? Number((e as { statusCode: number }).statusCode)
            : 500;
        return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 500).send({
          message: e instanceof Error ? e.message : "Upload failed",
        });
      }
    }
  );
};
