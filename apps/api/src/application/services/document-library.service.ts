import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { AttachmentStorage } from "../../infrastructure/storage/attachment-storage.js";
import {
  buildAiAnalysisPayload,
  extractDocumentContent,
  getExtension,
  validateDocumentUpload,
  type DocumentExtractResult,
} from "./document-content-extractor.js";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "document";
}

function localStorageRoot(): string {
  return process.env.ATTACHMENT_STORAGE_PATH?.trim() || join(process.cwd(), "data", "attachments");
}

async function storeBuffer(input: {
  storage: AttachmentStorage;
  storageKey: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<void> {
  if (input.storage.configured) {
    await input.storage.upload(input.storageKey, input.buffer, input.mimeType);
    return;
  }
  const fullPath = join(localStorageRoot(), input.storageKey);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, input.buffer);
}

export async function ingestKnowledgeDocument(input: {
  prisma: PrismaClient;
  storage: AttachmentStorage;
  workspaceId: string;
  userId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  linkedJobId?: string | null;
  sourceType: "COMPANY_UPLOAD" | "JOB_UPLOAD";
  runAiAnalysis?: boolean;
  /** When reusing an existing JobFile storage key, skip re-upload. */
  existingStorageKey?: string | null;
}): Promise<{
  documentId: string;
  status: string;
  aiAnalysisStatus: string;
  extractKind: DocumentExtractResult["kind"];
}> {
  const validation = validateDocumentUpload({
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
  });
  if (!validation.ok) {
    throw Object.assign(new Error(validation.message), { statusCode: 400 });
  }

  if (input.linkedJobId) {
    const job = await input.prisma.job.findFirst({
      where: { id: input.linkedJobId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!job) {
      throw Object.assign(new Error("Job not found"), { statusCode: 404 });
    }
  }

  const sanitized = sanitizeFilename(input.filename);
  const doc = await input.prisma.knowledgeDocument.create({
    data: {
      workspaceId: input.workspaceId,
      filename: input.filename,
      mimeType: input.mimeType || "application/octet-stream",
      status: "PROCESSING",
      documentType: "OTHER",
      sourceType: input.sourceType,
      linkedJobId: input.linkedJobId ?? null,
      fileSize: input.buffer.length,
      createdBy: input.userId,
      aiAnalysisStatus: input.runAiAnalysis ? "PENDING" : "NOT_REQUESTED",
    },
    select: { id: true },
  });

  const storageKey =
    input.existingStorageKey ??
    `knowledge/${input.workspaceId}/${doc.id}/${sanitized}`;

  try {
    if (!input.existingStorageKey) {
      await storeBuffer({
        storage: input.storage,
        storageKey,
        buffer: input.buffer,
        mimeType: input.mimeType || "application/octet-stream",
      });
    }

    const extract = await extractDocumentContent({
      filename: input.filename,
      mimeType: input.mimeType,
      buffer: input.buffer,
    });

    if (extract.kind === "rejected") {
      await input.prisma.knowledgeDocument.update({
        where: { id: doc.id },
        data: {
          status: "FAILED",
          storageReference: storageKey,
          extractedJson: { error: extract.error ?? "rejected" },
          aiAnalysisStatus: input.runAiAnalysis ? "SKIPPED" : "NOT_REQUESTED",
        },
      });
      return {
        documentId: doc.id,
        status: "FAILED",
        aiAnalysisStatus: input.runAiAnalysis ? "SKIPPED" : "NOT_REQUESTED",
        extractKind: extract.kind,
      };
    }

    let aiAnalysisStatus = input.runAiAnalysis ? "PENDING" : "NOT_REQUESTED";
    let aiAnalysisJson: object | null = null;

    if (input.runAiAnalysis) {
      const payload = buildAiAnalysisPayload(extract);
      if (!payload.trim() || extract.kind === "archive" || extract.kind === "image") {
        aiAnalysisStatus = "SKIPPED";
        aiAnalysisJson = {
          reason:
            extract.kind === "archive"
              ? "ZIP containers are not AI-analyzed"
              : extract.kind === "image"
                ? "Image OCR/vision not enabled"
                : "No extractable text",
        };
      } else {
        try {
          aiAnalysisJson = await runDocumentAiAnalysis(payload);
          if (
            aiAnalysisJson &&
            typeof aiAnalysisJson === "object" &&
            "skipped" in aiAnalysisJson &&
            (aiAnalysisJson as { skipped?: boolean }).skipped
          ) {
            aiAnalysisStatus = "SKIPPED";
          } else {
            aiAnalysisStatus = "READY";
          }
        } catch (e) {
          aiAnalysisStatus = "FAILED";
          aiAnalysisJson = {
            error: e instanceof Error ? e.message : "AI analysis failed",
          };
        }
      }
    }

    await input.prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        status: "READY",
        storageReference: storageKey,
        extractedText: extract.text,
        extractedJson: extract.structured
          ? (extract.structured as object)
          : { format: getExtension(input.filename).replace(".", "") },
        aiAnalysisStatus,
        ...(aiAnalysisJson ? { aiAnalysisJson } : {}),
      },
    });

    // checksum unused today but keeps parity with job files for future dedupe
    createHash("sha256").update(input.buffer).digest("hex");

    return {
      documentId: doc.id,
      status: "READY",
      aiAnalysisStatus,
      extractKind: extract.kind,
    };
  } catch (e) {
    await input.prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        status: "FAILED",
        storageReference: storageKey,
        extractedJson: {
          error: e instanceof Error ? e.message : "Processing failed",
        },
        aiAnalysisStatus: input.runAiAnalysis ? "FAILED" : "NOT_REQUESTED",
      },
    });
    throw e;
  }
}

async function runDocumentAiAnalysis(payload: string): Promise<object> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { skipped: true, reason: "OPENAI_API_KEY not configured" };
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_DOCUMENT_MODEL?.trim() || "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You analyze business documents. Return concise JSON with keys: summary (string), keyPoints (string[]), entities (string[]), risksOrActions (string[]). Do not invent facts not present in the content.",
      },
      {
        role: "user",
        content: `Analyze this extracted document content:\n\n${payload}`,
      },
    ],
    response_format: { type: "json_object" },
  });
  const content = completion.choices[0]?.message?.content ?? "{}";
  return JSON.parse(content) as object;
}
