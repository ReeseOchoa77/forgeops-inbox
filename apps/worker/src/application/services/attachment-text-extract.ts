/**
 * Cached PDF text extraction for Bidding Analysis.
 * Reuses EmailAttachment.extractedText — no OCR by default.
 */

import type { PrismaClient } from "@prisma/client";
import { isPdfTextUsable, selectRelevantPdfText } from "@forgeops/shared";

/** Cap stored extracted text (full extract before section select for AI). */
export const ATTACHMENT_TEXT_STORE_MAX_CHARS = 80_000;
const MIN_USABLE_CHARS = 40;

export type AttachmentTextResult = {
  attachmentId: string;
  filename: string;
  status: "READY" | "TEXT_UNAVAILABLE" | "FAILED" | "SKIPPED" | "NONE";
  text: string | null;
  relevantText: string | null;
};

function isPdfAttachment(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    mimeType === "application/pdf" ||
    mimeType === "application/x-pdf"
  );
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const PDFParse = mod.PDFParse;
  const verbosity = mod.VerbosityLevel?.ERRORS ?? 0;
  if (!PDFParse || typeof PDFParse !== "function") {
    throw new Error("pdf-parse module did not export PDFParse class");
  }
  if (buffer.length < 5 || buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("File does not appear to be a valid PDF");
  }
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity });
  try {
    const result = await parser.getText();
    return (result.text ?? "").slice(0, ATTACHMENT_TEXT_STORE_MAX_CHARS);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/**
 * Ensure PDF attachments for an email have cached text extraction.
 * Skips when not uploaded / not PDF / storage unavailable.
 */
export async function ensureEmailAttachmentTexts(input: {
  prisma: PrismaClient;
  workspaceId: string;
  emailMessageId: string;
  readObject: ((storageKey: string) => Promise<Buffer | null>) | null;
}): Promise<AttachmentTextResult[]> {
  const attachments = await input.prisma.emailAttachment.findMany({
    where: {
      workspaceId: input.workspaceId,
      emailMessageId: input.emailMessageId,
      isInline: false,
    },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      storageKey: true,
      uploadStatus: true,
      textExtractStatus: true,
      extractedText: true,
      sizeBytes: true,
    },
    take: 25,
  });

  const results: AttachmentTextResult[] = [];

  for (const att of attachments) {
    if (!isPdfAttachment(att.filename, att.mimeType)) {
      if (att.textExtractStatus === "NONE") {
        await input.prisma.emailAttachment.update({
          where: { id: att.id },
          data: {
            textExtractStatus: "SKIPPED",
            textExtractError: "not_pdf",
            textExtractedAt: new Date(),
          },
        });
      }
      results.push({
        attachmentId: att.id,
        filename: att.filename,
        status: "SKIPPED",
        text: null,
        relevantText: null,
      });
      continue;
    }

    if (
      att.textExtractStatus === "READY" &&
      typeof att.extractedText === "string"
    ) {
      results.push({
        attachmentId: att.id,
        filename: att.filename,
        status: "READY",
        text: att.extractedText,
        relevantText: selectRelevantPdfText(att.extractedText),
      });
      continue;
    }

    if (
      att.textExtractStatus === "TEXT_UNAVAILABLE" ||
      att.textExtractStatus === "FAILED" ||
      att.textExtractStatus === "SKIPPED"
    ) {
      results.push({
        attachmentId: att.id,
        filename: att.filename,
        status: att.textExtractStatus,
        text: null,
        relevantText: null,
      });
      continue;
    }

    if (
      att.uploadStatus !== "UPLOADED" ||
      !att.storageKey ||
      !input.readObject
    ) {
      await input.prisma.emailAttachment.update({
        where: { id: att.id },
        data: {
          textExtractStatus: "SKIPPED",
          textExtractError: !input.readObject
            ? "storage_unavailable"
            : "not_uploaded",
          textExtractedAt: new Date(),
        },
      });
      results.push({
        attachmentId: att.id,
        filename: att.filename,
        status: "SKIPPED",
        text: null,
        relevantText: null,
      });
      continue;
    }

    try {
      const buf = await input.readObject(att.storageKey);
      if (!buf || buf.length === 0) {
        await input.prisma.emailAttachment.update({
          where: { id: att.id },
          data: {
            textExtractStatus: "FAILED",
            textExtractError: "empty_object",
            textExtractedAt: new Date(),
          },
        });
        results.push({
          attachmentId: att.id,
          filename: att.filename,
          status: "FAILED",
          text: null,
          relevantText: null,
        });
        continue;
      }

      const text = await extractPdfText(buf);
      if (!isPdfTextUsable(text, MIN_USABLE_CHARS)) {
        await input.prisma.emailAttachment.update({
          where: { id: att.id },
          data: {
            textExtractStatus: "TEXT_UNAVAILABLE",
            extractedText: null,
            extractedTextChars: text.replace(/\s+/g, " ").trim().length,
            textExtractError: "REQUIRES_OCR",
            textExtractedAt: new Date(),
          },
        });
        results.push({
          attachmentId: att.id,
          filename: att.filename,
          status: "TEXT_UNAVAILABLE",
          text: null,
          relevantText: null,
        });
        continue;
      }

      await input.prisma.emailAttachment.update({
        where: { id: att.id },
        data: {
          textExtractStatus: "READY",
          extractedText: text,
          extractedTextChars: text.length,
          textExtractError: null,
          textExtractedAt: new Date(),
        },
      });
      results.push({
        attachmentId: att.id,
        filename: att.filename,
        status: "READY",
        text,
        relevantText: selectRelevantPdfText(text),
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.slice(0, 200) : "extract_failed";
      await input.prisma.emailAttachment.update({
        where: { id: att.id },
        data: {
          textExtractStatus: "FAILED",
          textExtractError: msg,
          textExtractedAt: new Date(),
        },
      });
      results.push({
        attachmentId: att.id,
        filename: att.filename,
        status: "FAILED",
        text: null,
        relevantText: null,
      });
    }
  }

  return results;
}

/** Merge usable PDF texts for deterministic/AI extract (bounded). */
export function mergeAttachmentPdfTexts(
  results: AttachmentTextResult[],
  maxChars = 14_000
): {
  combinedRelevant: string;
  attachmentIdsUsed: string[];
  hasTextUnavailable: boolean;
  hasUsablePdfText: boolean;
} {
  const parts: string[] = [];
  const ids: string[] = [];
  let hasTextUnavailable = false;
  for (const r of results) {
    if (r.status === "TEXT_UNAVAILABLE") hasTextUnavailable = true;
    if (r.status !== "READY" || !r.relevantText) continue;
    parts.push(`--- ${r.filename} ---\n${r.relevantText}`);
    ids.push(r.attachmentId);
  }
  let combined = parts.join("\n\n");
  if (combined.length > maxChars) combined = combined.slice(0, maxChars);
  return {
    combinedRelevant: combined,
    attachmentIdsUsed: ids,
    hasTextUnavailable,
    hasUsablePdfText: combined.length >= MIN_USABLE_CHARS,
  };
}
