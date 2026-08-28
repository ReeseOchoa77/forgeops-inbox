import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeName } from "@forgeops/shared";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import {
  enrichJobImportRows,
  parseJobImportFromPlainText,
  parseJobImportWorkbook,
  summarizeJobImport,
  jobNumberKey,
  normalizeJobNumber,
  type EnrichedJobImportRow,
} from "../../../application/services/job-import.js";
import { extractDocumentContent } from "../../../application/services/document-content-extractor.js";
import { getSessionFromRequest } from "../authentication.js";

const wsParams = z.object({ workspaceId: z.string().min(1) });

const confirmRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  import: z.boolean(),
  date: z.string().nullable().optional(),
  jobNumber: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  rawCustomerName: z.string().nullable().optional(),
  /** LINK existing | CREATE new customer | NONE unassigned */
  customerAction: z.enum(["LINK", "CREATE", "NONE"]).default("NONE"),
  customerId: z.string().min(1).nullable().optional(),
});

const confirmBodySchema = z.object({
  filename: z.string().min(1).max(300).optional(),
  rows: z.array(confirmRowSchema).min(1).max(5000),
});

async function requireJobImportAdmin(
  app: FastifyInstance,
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  workspaceId: string
) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    reply.code(401).send({ message: "Authentication required" });
    return null;
  }
  const membership = await requireWorkspaceMembership(
    app.services.prisma,
    session.userId,
    workspaceId
  );
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    reply.code(403).send({ message: "Admin or Owner role required" });
    return null;
  }
  return { userId: session.userId, role: membership.role };
}

async function loadMatchingContext(
  app: FastifyInstance,
  workspaceId: string
) {
  const [customers, aliases, existingJobs] = await Promise.all([
    app.services.prisma.customer.findMany({
      where: { workspaceId },
      select: { id: true, name: true, normalizedName: true },
    }),
    app.services.prisma.entityAlias.findMany({
      where: { workspaceId, entityType: "CUSTOMER" },
      select: {
        customerId: true,
        normalizedAlias: true,
        alias: true,
      },
    }),
    app.services.prisma.job.findMany({
      where: { workspaceId, jobNumber: { not: null } },
      select: {
        id: true,
        jobNumber: true,
        name: true,
        customerId: true,
      },
    }),
  ]);
  return { customers, aliases, existingJobs };
}

function serializePreviewRow(row: EnrichedJobImportRow) {
  return {
    rowIndex: row.rowIndex,
    date: row.date,
    jobNumber: row.jobNumber,
    name: row.name,
    rawCustomerName: row.rawCustomerName,
    matchedCustomerId: row.customerMatch.customerId,
    matchedCustomerName: row.customerMatch.customerName,
    customerStatus: row.customerMatch.status,
    customerCandidates: row.customerMatch.candidates,
    status: row.status,
    selected: row.selected,
    existingJobId: row.existingJobId,
    existingJobName: row.existingJobName,
    errors: row.errors,
    warnings: row.warnings,
    lowConfidence: row.lowConfidence,
  };
}

/**
 * Bulk Job Import — preview then confirm.
 * Historical "Date" maps to Job.startDate (createdAt remains DB insert time).
 */
export const registerJobImportRoutes = async (
  app: FastifyInstance
): Promise<void> => {
  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/import/preview",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireJobImportAdmin(app, request, reply, workspaceId);
      if (!auth) return;

      let fileBuffer: Buffer | null = null;
      let filename = "upload.xlsx";
      let mimeType = "application/octet-stream";

      const contentType = request.headers["content-type"] ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return reply.code(400).send({ message: "Expected multipart file upload" });
      }

      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === "file" && (part.fieldname === "file" || !fileBuffer)) {
          fileBuffer = await part.toBuffer();
          filename = part.filename ?? filename;
          mimeType = part.mimetype ?? mimeType;
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({ message: "No file provided" });
      }

      const lower = filename.toLowerCase();
      let normalizedRows;
      let sheetName: string | null = null;
      let parseWarnings: string[] = [];
      let lowConfidence = false;

      try {
        if (lower.endsWith(".csv") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
          const parsed = parseJobImportWorkbook(fileBuffer, filename);
          normalizedRows = parsed.rows;
          sheetName = parsed.sheetName;
          parseWarnings = parsed.warnings;
        } else if (lower.endsWith(".pdf") || mimeType === "application/pdf") {
          const extract = await extractDocumentContent({
            filename,
            mimeType: "application/pdf",
            buffer: fileBuffer,
          });
          if (!extract.text) {
            return reply.code(400).send({
              message: extract.error ?? "Could not extract text from PDF",
            });
          }
          const parsed = parseJobImportFromPlainText(extract.text);
          normalizedRows = parsed.rows;
          parseWarnings = parsed.warnings;
          lowConfidence = true;
        } else {
          return reply.code(400).send({
            message: "Supported formats: XLSX, XLS, CSV, PDF",
          });
        }
      } catch (e) {
        const status =
          e && typeof e === "object" && "statusCode" in e
            ? Number((e as { statusCode: number }).statusCode)
            : 400;
        return reply
          .code(status >= 400 && status < 600 ? status : 400)
          .send({
            message: e instanceof Error ? e.message : "Failed to parse file",
          });
      }

      if (normalizedRows.length === 0) {
        return reply.code(400).send({ message: "No job rows detected in file" });
      }

      const ctx = await loadMatchingContext(app, workspaceId);
      const enriched = enrichJobImportRows({
        rows: normalizedRows,
        existingJobs: ctx.existingJobs,
        customers: ctx.customers,
        aliases: ctx.aliases,
        lowConfidence,
      });

      return reply.send({
        filename,
        sheetName,
        warnings: parseWarnings,
        /** Historical register Date → Job.startDate (not createdAt). */
        dateFieldMapping: "startDate",
        summary: summarizeJobImport(enriched),
        rows: enriched.map(serializePreviewRow),
        customers: ctx.customers.map((c) => ({ id: c.id, name: c.name })),
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/jobs/import/confirm",
    async (request, reply) => {
      const { workspaceId } = wsParams.parse(request.params);
      const auth = await requireJobImportAdmin(app, request, reply, workspaceId);
      if (!auth) return;

      const body = confirmBodySchema.parse(request.body ?? {});
      const toImport = body.rows.filter((r) => r.import);
      if (toImport.length === 0) {
        return reply.code(400).send({ message: "No rows selected for import" });
      }

      // Re-check duplicates within selection
      const seen = new Set<string>();
      for (const row of toImport) {
        const key = jobNumberKey(normalizeJobNumber(row.jobNumber));
        if (!key) {
          return reply.code(400).send({
            message: `Row ${row.rowIndex}: job number is required`,
          });
        }
        if (seen.has(key)) {
          return reply.code(400).send({
            message: `Duplicate job number in selection: ${row.jobNumber}`,
          });
        }
        seen.add(key);
      }

      const existingJobs = await app.services.prisma.job.findMany({
        where: { workspaceId, jobNumber: { not: null } },
        select: { id: true, jobNumber: true },
      });
      const existingKeys = new Set(
        existingJobs
          .filter((j) => j.jobNumber)
          .map((j) => jobNumberKey(j.jobNumber!))
      );

      const importRun = await app.services.prisma.importRun.create({
        data: {
          workspaceId,
          importType: "JOB",
          status: "PROCESSING",
          rowsRead: body.rows.length,
        },
      });

      let createdCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors: Array<{ rowIndex: number; error: string }> = [];
      const createdJobs: Array<{ id: string; jobNumber: string; name: string }> =
        [];

      for (const row of toImport) {
        const jobNumber = normalizeJobNumber(row.jobNumber);
        const key = jobNumberKey(jobNumber);
        try {
          if (existingKeys.has(key)) {
            skippedCount++;
            errors.push({
              rowIndex: row.rowIndex,
              error: `Job number ${jobNumber} already exists`,
            });
            continue;
          }

          const normalized = normalizeName(row.name);
          if (!normalized) {
            errorCount++;
            errors.push({ rowIndex: row.rowIndex, error: "Invalid job name" });
            continue;
          }

          const nameClash = await app.services.prisma.job.findFirst({
            where: { workspaceId, normalizedName: normalized },
            select: { id: true },
          });
          if (nameClash) {
            skippedCount++;
            errors.push({
              rowIndex: row.rowIndex,
              error: "A job with this name already exists",
            });
            continue;
          }

          let customerId: string | null = null;
          if (row.customerAction === "LINK") {
            if (!row.customerId) {
              errorCount++;
              errors.push({
                rowIndex: row.rowIndex,
                error: "customerId required for LINK",
              });
              continue;
            }
            const customer = await app.services.prisma.customer.findFirst({
              where: { id: row.customerId, workspaceId },
              select: { id: true },
            });
            if (!customer) {
              errorCount++;
              errors.push({
                rowIndex: row.rowIndex,
                error: "Customer not found in workspace",
              });
              continue;
            }
            customerId = customer.id;
          } else if (row.customerAction === "CREATE") {
            const rawName =
              row.rawCustomerName?.trim() ||
              `Customer for ${jobNumber}`;
            const custNorm = normalizeName(rawName);
            if (!custNorm) {
              errorCount++;
              errors.push({
                rowIndex: row.rowIndex,
                error: "Cannot create customer without a name",
              });
              continue;
            }
            const existingCustomer =
              await app.services.prisma.customer.findUnique({
                where: {
                  workspaceId_normalizedName: {
                    workspaceId,
                    normalizedName: custNorm,
                  },
                },
                select: { id: true },
              });
            if (existingCustomer) {
              customerId = existingCustomer.id;
            } else {
              const createdCustomer = await app.services.prisma.customer.create({
                data: {
                  workspaceId,
                  name: rawName,
                  normalizedName: custNorm,
                },
                select: { id: true },
              });
              customerId = createdCustomer.id;
            }
          }

          const startDate =
            row.date && /^\d{4}-\d{2}-\d{2}/.test(row.date)
              ? new Date(`${row.date.slice(0, 10)}T12:00:00.000Z`)
              : null;

          const job = await app.services.prisma.job.create({
            data: {
              workspaceId,
              jobNumber,
              name: row.name.trim(),
              normalizedName: normalized,
              customerId,
              status: "ACTIVE",
              startDate,
              createdByUserId: auth.userId,
            },
            select: { id: true, jobNumber: true, name: true },
          });

          await app.services.prisma.jobActivityLog.create({
            data: {
              jobId: job.id,
              workspaceId,
              actorUserId: auth.userId,
              action: "JOB_CREATED",
              entityType: "JOB",
              entityId: job.id,
              newValue: {
                source: "BULK_IMPORT",
                jobNumber: job.jobNumber,
                importRunId: importRun.id,
              },
            },
          });

          existingKeys.add(key);
          createdCount++;
          createdJobs.push({
            id: job.id,
            jobNumber: job.jobNumber ?? jobNumber,
            name: job.name,
          });
        } catch (e) {
          errorCount++;
          errors.push({
            rowIndex: row.rowIndex,
            error: e instanceof Error ? e.message : "Failed to create job",
          });
        }
      }

      await app.services.prisma.importRun.update({
        where: { id: importRun.id },
        data: {
          status: errorCount > 0 && createdCount === 0 ? "FAILED" : "COMPLETED",
          createdCount,
          skippedCount,
          errorCount,
          ...(errors.length
            ? { errorsJson: errors.slice(0, 100) }
            : {}),
          completedAt: new Date(),
        },
      });

      await app.services.auditEventLogger.log({
        workspaceId,
        actorUserId: auth.userId,
        entityType: "JOB",
        entityId: importRun.id,
        action: "jobs.bulk_import",
        metadata: {
          filename: body.filename ?? null,
          importRunId: importRun.id,
          selected: toImport.length,
          createdCount,
          skippedCount,
          errorCount,
        },
        request,
      });

      return reply.send({
        importRunId: importRun.id,
        status: "completed",
        createdCount,
        skippedCount,
        errorCount,
        errors: errors.slice(0, 50),
        createdJobs: createdJobs.slice(0, 100),
      });
    }
  );
};
