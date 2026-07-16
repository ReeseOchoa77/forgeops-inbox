import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  normalizeName,
  normalizeEmail,
  extractDomain,
  findDuplicates
} from "@forgeops/shared";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIMETYPES = [
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel"
];

interface ExtractedRecord {
  recordType: "CUSTOMER" | "VENDOR" | "JOB";
  displayName: string;
  normalizedName: string;
  aliases: string[];
  address: string | null;
  phone: string | null;
  email: string | null;
  domain: string | null;
  confidence: number;
  possibleDuplicateIds: string[];
  warnings: string[];
}

interface ExtractionPreview {
  documentId: string;
  records: ExtractedRecord[];
  summary: {
    rowsRead: number;
    validRecords: number;
    possibleDuplicates: number;
    warnings: number;
  };
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9+]/g, "");
  return digits.length >= 7 ? digits : null;
}

function detectAliases(displayName: string, normalizedName: string): string[] {
  const aliases: string[] = [];
  const collapsed = normalizedName.replace(/\s+/g, "");
  if (collapsed !== normalizedName.replace(/\s+/g, "")) {
    aliases.push(collapsed);
  }
  if (displayName.toLowerCase().trim() !== normalizedName) {
    aliases.push(displayName.trim());
  }
  return [...new Set(aliases)].filter(Boolean);
}

async function parsePdfToRows(buffer: Buffer): Promise<Array<{ name: string; phone?: string | undefined; email?: string | undefined; address?: string | undefined }>> {
  const pdfMod = await import("pdf-parse") as unknown as Record<string, unknown>;
  const pdfParse = (typeof pdfMod === "function" ? pdfMod : pdfMod["default"] ?? pdfMod) as (buf: Buffer) => Promise<{ text: string }>;
  const result = await pdfParse(buffer);
  const text = result.text;

  const rows: Array<{ name: string; phone?: string; email?: string; address?: string }> = [];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

  for (const line of lines) {
    if (line.length < 3 || line.length > 300) continue;
    if (/^(page|date|report|printed|total|count|#|---|===)/i.test(line)) continue;
    if (/^\d+$/.test(line.trim())) continue;

    const phoneMatch = line.match(phoneRegex);
    const emailMatch = line.match(emailRegex);

    let name = line;
    if (phoneMatch) name = name.replace(phoneMatch[0], "").trim();
    if (emailMatch) name = name.replace(emailMatch[0], "").trim();
    name = name.replace(/[,;|]+$/, "").trim();

    if (name.length < 2) continue;
    if (/^\d+\s/.test(name) && name.split(/\s+/).length > 3) {
      const parts = name.split(/\s{2,}|\t/);
      if (parts.length >= 2) {
        name = parts[0]!.replace(/^\d+\s*/, "").trim();
      }
    }

    if (name.length >= 2 && !/^\d+$/.test(name)) {
      const row: { name: string; phone?: string; email?: string } = { name };
      if (phoneMatch?.[0]) row.phone = phoneMatch[0];
      if (emailMatch?.[0]) row.email = emailMatch[0];
      rows.push(row);
    }
  }

  return rows;
}

function parseCsvToRows(text: string): Array<{ name: string; phone?: string | undefined; email?: string | undefined; address?: string | undefined }> {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0]!.toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""));
  const nameCol = header.findIndex(h => /^(name|company|customer|vendor|organization)$/i.test(h));
  const phoneCol = header.findIndex(h => /^(phone|telephone|tel)$/i.test(h));
  const emailCol = header.findIndex(h => /^(email|e-mail)$/i.test(h));
  const addressCol = header.findIndex(h => /^(address|addr|street)$/i.test(h));

  if (nameCol < 0) {
    return lines.slice(1).map(line => ({ name: line.split(",")[0]?.replace(/"/g, "").trim() ?? "" })).filter(r => r.name.length >= 2);
  }

  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c => c.replace(/"/g, "").trim());
    return {
      name: cols[nameCol] ?? "",
      phone: phoneCol >= 0 ? cols[phoneCol] : undefined,
      email: emailCol >= 0 ? cols[emailCol] : undefined,
      address: addressCol >= 0 ? cols[addressCol] : undefined
    };
  }).filter(r => r.name.length >= 2);
}

function parseXlsxToRows(buffer: Buffer): Array<{ name: string; phone?: string | undefined; email?: string | undefined; address?: string | undefined }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName]!;
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  return jsonRows.map(row => {
    const name = String(row["Name"] ?? row["name"] ?? row["Company"] ?? row["company"] ?? row["Customer"] ?? row["Vendor"] ?? "").trim();
    const phone = String(row["Phone"] ?? row["phone"] ?? row["Telephone"] ?? "").trim() || undefined;
    const email = String(row["Email"] ?? row["email"] ?? row["E-mail"] ?? "").trim() || undefined;
    const address = String(row["Address"] ?? row["address"] ?? "").trim() || undefined;
    return { name, phone, email, address };
  }).filter(r => r.name.length >= 2);
}

export const registerDocumentImportRoutes = async (app: FastifyInstance): Promise<void> => {

  app.post(
    "/api/v1/workspaces/:workspaceId/reference/documents/upload-and-extract",
    async (request, reply) => {
      const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
      if (!membership || !["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(membership.role)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      const parts = request.parts();
      let fileBuffer: Buffer | null = null;
      let filename = "document";
      let mimeType = "application/octet-stream";
      let entityType: "CUSTOMER" | "VENDOR" | "JOB" = "CUSTOMER";

      for await (const part of parts) {
        if (part.type === "file") {
          if (!ALLOWED_MIMETYPES.includes(part.mimetype)) {
            return reply.code(400).send({
              message: `Unsupported file type: ${part.mimetype}. Allowed: PDF, CSV, XLSX`
            });
          }
          fileBuffer = await part.toBuffer();
          if (fileBuffer.length > MAX_FILE_SIZE) {
            return reply.code(400).send({ message: `File too large. Maximum: ${MAX_FILE_SIZE / 1024 / 1024}MB` });
          }
          filename = (part.filename ?? "document").replace(/[^a-zA-Z0-9._-]/g, "_");
          mimeType = part.mimetype;
        } else if (part.fieldname === "entityType") {
          const val = (part.value as string).toUpperCase();
          if (val === "CUSTOMER" || val === "VENDOR" || val === "JOB") {
            entityType = val;
          }
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ message: "No file uploaded" });
      }

      let rawRows: Array<{ name: string; phone?: string | undefined; email?: string | undefined; address?: string | undefined }> = [];
      let extractedText = "";

      try {
        if (mimeType === "application/pdf") {
          rawRows = await parsePdfToRows(fileBuffer);
          const pdfMod = await import("pdf-parse") as unknown as Record<string, unknown>;
          const pdfParse = (typeof pdfMod === "function" ? pdfMod : pdfMod["default"] ?? pdfMod) as (buf: Buffer) => Promise<{ text: string }>;
          const result = await pdfParse(fileBuffer);
          extractedText = result.text;
        } else if (mimeType === "text/csv") {
          extractedText = fileBuffer.toString("utf-8");
          rawRows = parseCsvToRows(extractedText);
        } else {
          rawRows = parseXlsxToRows(fileBuffer);
          extractedText = rawRows.map(r => `${r.name}|${r.phone ?? ""}|${r.email ?? ""}`).join("\n");
        }
      } catch (e) {
        return reply.code(422).send({
          message: `Failed to parse document: ${e instanceof Error ? e.message : "Unknown error"}`
        });
      }

      const existingEntities = entityType === "CUSTOMER"
        ? await app.services.prisma.customer.findMany({
            where: { workspaceId },
            select: { id: true, name: true, normalizedName: true }
          })
        : entityType === "VENDOR"
          ? await app.services.prisma.vendor.findMany({
              where: { workspaceId },
              select: { id: true, name: true, normalizedName: true }
            })
          : await app.services.prisma.job.findMany({
              where: { workspaceId },
              select: { id: true, name: true, normalizedName: true }
            });

      const records: ExtractedRecord[] = [];
      let possibleDuplicateCount = 0;
      let warningCount = 0;

      for (const row of rawRows) {
        const normalized = normalizeName(row.name);
        const aliases = detectAliases(row.name, normalized);
        const domain = row.email ? extractDomain(row.email) : null;
        const phone = normalizePhone(row.phone);
        const duplicates = findDuplicates(normalized, row.name, existingEntities);
        const warnings: string[] = [];

        if (!normalized || normalized.length < 2) {
          warnings.push("Name too short after normalization");
          warningCount++;
        }

        if (duplicates.length > 0) {
          possibleDuplicateCount++;
          if (duplicates[0]!.score >= 0.95) {
            warnings.push(`Probable duplicate of "${duplicates[0]!.existingName}" (${Math.round(duplicates[0]!.score * 100)}%)`);
          }
        }

        records.push({
          recordType: entityType,
          displayName: row.name,
          normalizedName: normalized,
          aliases,
          address: row.address ?? null,
          phone,
          email: row.email?.toLowerCase() ?? null,
          domain,
          confidence: duplicates.length > 0 ? 1 - duplicates[0]!.score : 1.0,
          possibleDuplicateIds: duplicates.map(d => d.existingId),
          warnings
        });
      }

      const preview: ExtractionPreview = {
        documentId: "",
        records,
        summary: {
          rowsRead: rawRows.length,
          validRecords: records.filter(r => r.warnings.length === 0 || !r.warnings.some(w => w.includes("too short"))).length,
          possibleDuplicates: possibleDuplicateCount,
          warnings: warningCount
        }
      };

      const doc = await app.services.prisma.knowledgeDocument.create({
        data: {
          workspaceId,
          filename,
          mimeType,
          status: "READY",
          documentType: entityType === "CUSTOMER" ? "CUSTOMER_LIST" : entityType === "VENDOR" ? "VENDOR_LIST" : "JOB_LIST",
          extractedText: extractedText.slice(0, 500_000),
          extractedJson: preview as unknown as Prisma.InputJsonValue,
          fileSize: fileBuffer.length,
          createdBy: session.userId
        }
      });

      preview.documentId = doc.id;

      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: session.userId,
        entityType: "KNOWLEDGE_DOCUMENT",
        entityId: doc.id,
        action: "reference.document_uploaded_and_extracted",
        metadata: {
          filename,
          mimeType,
          entityType,
          rowsRead: rawRows.length,
          validRecords: preview.summary.validRecords,
          possibleDuplicates: possibleDuplicateCount
        },
        request
      });

      return reply.code(201).send(preview);
    }
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/reference/documents/:documentId/preview",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        documentId: z.string().min(1)
      }).parse(request.params);

      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

      const doc = await app.services.prisma.knowledgeDocument.findFirst({
        where: { id: params.documentId, workspaceId: params.workspaceId },
        select: { id: true, extractedJson: true, status: true, filename: true }
      });

      if (!doc) return reply.code(404).send({ message: "Document not found" });
      if (!doc.extractedJson) return reply.code(404).send({ message: "No extracted data available" });

      return reply.send(doc.extractedJson);
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/reference/documents/:documentId/commit",
    async (request, reply) => {
      const params = z.object({
        workspaceId: z.string().min(1),
        documentId: z.string().min(1)
      }).parse(request.params);

      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
      if (!membership || !["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(membership.role)) {
        return reply.code(403).send({ message: "Edit permission required" });
      }

      const body = z.object({
        selectedIndices: z.array(z.number().int().nonnegative()).optional(),
        skipDuplicates: z.boolean().default(true)
      }).parse(request.body);

      const doc = await app.services.prisma.knowledgeDocument.findFirst({
        where: { id: params.documentId, workspaceId: params.workspaceId },
        select: { id: true, extractedJson: true }
      });

      if (!doc?.extractedJson) {
        return reply.code(404).send({ message: "Document or extracted data not found" });
      }

      const preview = doc.extractedJson as unknown as ExtractionPreview;
      let records = preview.records;

      if (body.selectedIndices && body.selectedIndices.length > 0) {
        records = body.selectedIndices.map(i => records[i]!).filter(Boolean);
      }

      if (body.skipDuplicates) {
        records = records.filter(r => r.possibleDuplicateIds.length === 0);
      }

      const importRun = await app.services.prisma.importRun.create({
        data: {
          workspaceId: params.workspaceId,
          knowledgeDocumentId: doc.id,
          importType: records[0]?.recordType ?? "CUSTOMER",
          status: "PROCESSING",
          rowsRead: records.length
        }
      });

      let created = 0;
      let skipped = 0;
      const errors: Array<{ row: number; error: string }> = [];

      await app.services.prisma.$transaction(async (tx) => {
        for (let i = 0; i < records.length; i++) {
          const rec = records[i]!;
          try {
            const isCustomer = rec.recordType === "CUSTOMER";
            const isVendor = rec.recordType === "VENDOR";

            let entityId: string;

            if (isCustomer) {
              const entity = await tx.customer.upsert({
                where: { workspaceId_normalizedName: { workspaceId: params.workspaceId, normalizedName: rec.normalizedName } },
                update: {
                  ...(rec.email ? { primaryEmail: rec.email } : {}),
                  ...(rec.phone ? { phone: rec.phone } : {}),
                  ...(rec.domain ? { domain: rec.domain } : {})
                },
                create: {
                  workspaceId: params.workspaceId,
                  name: rec.displayName,
                  normalizedName: rec.normalizedName,
                  primaryEmail: rec.email,
                  domain: rec.domain,
                  phone: rec.phone
                }
              });
              entityId = entity.id;
            } else if (isVendor) {
              const entity = await tx.vendor.upsert({
                where: { workspaceId_normalizedName: { workspaceId: params.workspaceId, normalizedName: rec.normalizedName } },
                update: {
                  ...(rec.email ? { primaryEmail: rec.email } : {}),
                  ...(rec.phone ? { phone: rec.phone } : {}),
                  ...(rec.domain ? { domain: rec.domain } : {})
                },
                create: {
                  workspaceId: params.workspaceId,
                  name: rec.displayName,
                  normalizedName: rec.normalizedName,
                  primaryEmail: rec.email,
                  domain: rec.domain,
                  phone: rec.phone
                }
              });
              entityId = entity.id;
            } else {
              const entity = await tx.job.upsert({
                where: { workspaceId_normalizedName: { workspaceId: params.workspaceId, normalizedName: rec.normalizedName } },
                update: {},
                create: {
                  workspaceId: params.workspaceId,
                  name: rec.displayName,
                  normalizedName: rec.normalizedName
                }
              });
              entityId = entity.id;
            }

            await tx.entityAlias.upsert({
              where: {
                workspaceId_entityType_normalizedAlias: {
                  workspaceId: params.workspaceId,
                  entityType: rec.recordType,
                  normalizedAlias: rec.normalizedName
                }
              },
              update: {},
              create: {
                workspaceId: params.workspaceId,
                entityType: rec.recordType,
                ...(isCustomer ? { customerId: entityId } : isVendor ? { vendorId: entityId } : { jobId: entityId }),
                alias: rec.displayName,
                normalizedAlias: rec.normalizedName,
                source: "IMPORT"
              }
            });

            for (const alias of rec.aliases) {
              const normalizedAlias = normalizeName(alias);
              if (normalizedAlias && normalizedAlias !== rec.normalizedName) {
                await tx.entityAlias.upsert({
                  where: {
                    workspaceId_entityType_normalizedAlias: {
                      workspaceId: params.workspaceId,
                      entityType: rec.recordType,
                      normalizedAlias
                    }
                  },
                  update: {},
                  create: {
                    workspaceId: params.workspaceId,
                    entityType: rec.recordType,
                    ...(isCustomer ? { customerId: entityId } : isVendor ? { vendorId: entityId } : { jobId: entityId }),
                    alias,
                    normalizedAlias,
                    source: "IMPORT"
                  }
                });
              }
            }

            if (rec.email) {
              const ne = normalizeEmail(rec.email);
              await tx.entityContact.create({
                data: {
                  workspaceId: params.workspaceId,
                  ...(isCustomer ? { customerId: entityId } : isVendor ? { vendorId: entityId } : {}),
                  email: rec.email,
                  normalizedEmail: ne,
                  domain: rec.domain ?? extractDomain(rec.email),
                  phone: rec.phone,
                  source: "IMPORT"
                }
              }).catch(() => {});
            }

            created++;
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
              skipped++;
            } else {
              errors.push({ row: i, error: e instanceof Error ? e.message : "Unknown" });
            }
          }
        }
      }, { timeout: 60_000 });

      await app.services.prisma.importRun.update({
        where: { id: importRun.id },
        data: {
          status: errors.length > 0 ? "FAILED" : "COMPLETED",
          createdCount: created,
          skippedCount: skipped,
          errorCount: errors.length,
          errorsJson: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          completedAt: new Date()
        }
      });

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "IMPORT_RUN",
        entityId: importRun.id,
        action: "reference.document_import_committed",
        metadata: { documentId: doc.id, created, skipped, errors: errors.length },
        request
      });

      return reply.send({
        importRunId: importRun.id,
        status: errors.length > 0 ? "partial" : "completed",
        created,
        skipped,
        errors
      });
    }
  );
};
