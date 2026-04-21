import type { FastifyInstance } from "fastify";
import { z } from "zod";
import OpenAI from "openai";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const requireAdmin = async (
  app: FastifyInstance,
  request: Parameters<typeof getSessionFromRequest>[0],
  workspaceId: string
) => {
  const session = await getSessionFromRequest(request);
  if (!session) return { session: null, membership: null };

  const membership = await requireWorkspaceMembership(
    app.services.prisma,
    session.userId,
    workspaceId
  );

  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return { session, membership: null };
  }

  return { session, membership };
};

function parseCsvToText(text: string): string {
  return text.slice(0, 15000);
}

async function parsePdfToText(buffer: Buffer): Promise<string> {
  // pdf-parse v2 exports { PDFParse } class
  const { PDFParse } = await import("pdf-parse") as unknown as {
    PDFParse: new () => { loadPDF: (buf: Buffer) => Promise<{ getAllText: () => string }> }
  };
  const parser = new PDFParse();
  const pdf = await parser.loadPDF(buffer);
  return pdf.getAllText().slice(0, 15000);
}

const EXTRACTION_PROMPT = `You are a data extraction assistant for a business operations platform.

The user has uploaded a document that likely contains a list of business contacts, customers, vendors, or jobs/projects.

Analyze the text and extract structured records. For each record found, determine:

1. entityType: one of "customer", "vendor", "contact", "job" — pick the most likely type based on context. If the document clearly looks like a customer list, mark all as "customer". If it's a vendor list, mark all as "vendor". If ambiguous, use "contact".

2. For each record, extract whatever fields are present:
   - name (required)
   - email (if present)
   - phone (if present)
   - domain (if present or inferable from email)
   - company (if different from name)
   - jobNumber (for jobs only)
   - notes (any extra context)

Return a JSON object with this exact shape:
{
  "inferredType": "customer" | "vendor" | "contact" | "job",
  "confidence": "high" | "medium" | "low",
  "records": [
    {
      "name": "...",
      "email": "..." or null,
      "phone": "..." or null,
      "domain": "..." or null,
      "company": "..." or null,
      "jobNumber": "..." or null,
      "notes": "..." or null
    }
  ]
}

Rules:
- Only return valid JSON, nothing else
- Maximum 200 records
- If the document doesn't contain list-like data, return {"inferredType":"unknown","confidence":"low","records":[]}
- Normalize emails to lowercase
- Extract domain from email if domain isn't explicitly stated
- Be conservative: only extract records you're reasonably confident about`;

const extractionResultSchema = z.object({
  inferredType: z.enum(["customer", "vendor", "contact", "job", "unknown"]),
  confidence: z.enum(["high", "medium", "low"]),
  records: z.array(z.object({
    name: z.string().min(1),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    jobNumber: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
  })).max(200)
});

export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const registerAiImportRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/import/extract",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      if (!app.services.env.OPENAI_API_KEY) {
        return reply.code(503).send({ message: "OpenAI API key is not configured. AI-assisted import is unavailable." });
      }

      const contentType = (request.headers["content-type"] ?? "").toLowerCase();
      let documentText: string;

      try {
        if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
          const body = request.body as string;
          documentText = parseCsvToText(typeof body === "string" ? body : String(body));
        } else if (contentType.includes("application/pdf")) {
          const body = request.body as Buffer;
          documentText = await parsePdfToText(Buffer.isBuffer(body) ? body : Buffer.from(body as ArrayBuffer));
        } else if (contentType.includes("application/json")) {
          const body = z.object({ text: z.string().min(1).max(20000) }).parse(request.body);
          documentText = body.text;
        } else {
          return reply.code(400).send({
            message: "Unsupported file type. Upload a CSV, TXT, or PDF file.",
            supportedTypes: ["text/csv", "text/plain", "application/pdf"]
          });
        }
      } catch (e) {
        return reply.code(400).send({
          message: `Failed to parse file: ${e instanceof Error ? e.message : "unknown error"}`
        });
      }

      if (!documentText.trim()) {
        return reply.code(400).send({ message: "The uploaded file appears to be empty." });
      }

      try {
        const openai = new OpenAI({ apiKey: app.services.env.OPENAI_API_KEY });

        const completion = await openai.chat.completions.create({
          model: app.services.env.OPENAI_MODEL,
          messages: [
            { role: "system", content: EXTRACTION_PROMPT },
            { role: "user", content: `Here is the document content:\n\n${documentText}` }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        });

        const rawContent = completion.choices[0]?.message?.content;
        if (!rawContent) {
          return reply.code(500).send({ message: "AI did not return a response." });
        }

        const parsed = JSON.parse(rawContent);
        const result = extractionResultSchema.parse(parsed);

        await app.services.auditEventLogger.log({
          workspaceId: params.workspaceId,
          actorUserId: session.userId,
          entityType: "IMPORT",
          entityId: params.workspaceId,
          action: "import.ai_extraction",
          metadata: {
            inferredType: result.inferredType,
            confidence: result.confidence,
            recordCount: result.records.length,
            documentLength: documentText.length
          },
          request
        });

        return reply.send({
          status: "extracted",
          extraction: result
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "AI extraction failed";
        app.log.error({ event: "ai_import_error", error: message });
        return reply.code(500).send({ message: `AI extraction failed: ${message}` });
      }
    }
  );
};
