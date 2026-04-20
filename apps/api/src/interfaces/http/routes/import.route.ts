import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const normalizeName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

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

const customerRowSchema = z.object({
  name: z.string().min(1),
  primaryEmail: z.string().email().optional().nullable(),
  domain: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const vendorRowSchema = z.object({
  name: z.string().min(1),
  primaryEmail: z.string().email().optional().nullable(),
  domain: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const jobRowSchema = z.object({
  name: z.string().min(1),
  jobNumber: z.string().optional().nullable(),
  customerName: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "COMPLETED", "ON_HOLD", "CANCELLED"]).optional().nullable(),
  externalRef: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const importBodySchema = z.object({
  rows: z.array(z.record(z.unknown())).min(1).max(5000)
});

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headerLine = lines[0]!;
  const headers = headerLine.split(",").map(h => h.trim().replace(/^"|"$/g, ""));

  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i]!.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      const val = values[j];
      if (key && val !== undefined && val !== "") {
        row[key] = val;
      }
    }
    if (Object.keys(row).length > 0) {
      rows.push(row);
    }
  }

  return rows;
}

export const registerImportRoutes = async (
  app: FastifyInstance
): Promise<void> => {

  app.post(
    "/api/v1/workspaces/:workspaceId/import/customers",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      let rows: Array<Record<string, unknown>>;
      const contentType = (request.headers["content-type"] ?? "").toLowerCase();

      if (contentType.includes("text/csv")) {
        const csvText = request.body as string;
        rows = parseCsv(typeof csvText === "string" ? csvText : String(csvText));
      } else {
        const body = importBodySchema.parse(request.body);
        rows = body.rows;
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const parsed = customerRowSchema.parse(rows[i]);
          const normalized = normalizeName(parsed.name);
          if (!normalized) { skipped++; continue; }

          await app.services.prisma.customer.upsert({
            where: {
              workspaceId_normalizedName: {
                workspaceId: params.workspaceId,
                normalizedName: normalized
              }
            },
            update: {
              name: parsed.name.trim(),
              primaryEmail: parsed.primaryEmail?.toLowerCase().trim() ?? null,
              domain: parsed.domain?.toLowerCase().trim() ?? null,
              phone: parsed.phone?.trim() ?? null,
              externalRef: parsed.externalRef?.trim() ?? null,
              notes: parsed.notes?.trim() ?? null
            },
            create: {
              workspaceId: params.workspaceId,
              name: parsed.name.trim(),
              normalizedName: normalized,
              primaryEmail: parsed.primaryEmail?.toLowerCase().trim() ?? null,
              domain: parsed.domain?.toLowerCase().trim() ?? null,
              phone: parsed.phone?.trim() ?? null,
              externalRef: parsed.externalRef?.trim() ?? null,
              notes: parsed.notes?.trim() ?? null
            }
          });

          const exists = await app.services.prisma.customer.findUnique({
            where: {
              workspaceId_normalizedName: {
                workspaceId: params.workspaceId,
                normalizedName: normalized
              }
            },
            select: { createdAt: true, updatedAt: true }
          });

          if (exists && exists.createdAt.getTime() === exists.updatedAt.getTime()) {
            created++;
          } else {
            updated++;
          }
        } catch (e) {
          errors.push({ row: i + 1, error: e instanceof Error ? e.message : "Invalid row" });
          skipped++;
        }
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "CUSTOMER",
        entityId: params.workspaceId,
        action: "import.customers",
        metadata: { totalRows: rows.length, created, updated, skipped, errorCount: errors.length },
        request
      });

      return reply.send({
        status: "completed",
        entity: "customer",
        totalRows: rows.length,
        created,
        updated,
        skipped,
        errors: errors.slice(0, 20)
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/import/vendors",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      let rows: Array<Record<string, unknown>>;
      const contentType = (request.headers["content-type"] ?? "").toLowerCase();

      if (contentType.includes("text/csv")) {
        const csvText = request.body as string;
        rows = parseCsv(typeof csvText === "string" ? csvText : String(csvText));
      } else {
        const body = importBodySchema.parse(request.body);
        rows = body.rows;
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const parsed = vendorRowSchema.parse(rows[i]);
          const normalized = normalizeName(parsed.name);
          if (!normalized) { skipped++; continue; }

          await app.services.prisma.vendor.upsert({
            where: {
              workspaceId_normalizedName: {
                workspaceId: params.workspaceId,
                normalizedName: normalized
              }
            },
            update: {
              name: parsed.name.trim(),
              primaryEmail: parsed.primaryEmail?.toLowerCase().trim() ?? null,
              domain: parsed.domain?.toLowerCase().trim() ?? null,
              phone: parsed.phone?.trim() ?? null,
              externalRef: parsed.externalRef?.trim() ?? null,
              notes: parsed.notes?.trim() ?? null
            },
            create: {
              workspaceId: params.workspaceId,
              name: parsed.name.trim(),
              normalizedName: normalized,
              primaryEmail: parsed.primaryEmail?.toLowerCase().trim() ?? null,
              domain: parsed.domain?.toLowerCase().trim() ?? null,
              phone: parsed.phone?.trim() ?? null,
              externalRef: parsed.externalRef?.trim() ?? null,
              notes: parsed.notes?.trim() ?? null
            }
          });

          const exists = await app.services.prisma.vendor.findUnique({
            where: {
              workspaceId_normalizedName: {
                workspaceId: params.workspaceId,
                normalizedName: normalized
              }
            },
            select: { createdAt: true, updatedAt: true }
          });

          if (exists && exists.createdAt.getTime() === exists.updatedAt.getTime()) {
            created++;
          } else {
            updated++;
          }
        } catch (e) {
          errors.push({ row: i + 1, error: e instanceof Error ? e.message : "Invalid row" });
          skipped++;
        }
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "VENDOR",
        entityId: params.workspaceId,
        action: "import.vendors",
        metadata: { totalRows: rows.length, created, updated, skipped, errorCount: errors.length },
        request
      });

      return reply.send({
        status: "completed",
        entity: "vendor",
        totalRows: rows.length,
        created,
        updated,
        skipped,
        errors: errors.slice(0, 20)
      });
    }
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/import/jobs",
    async (request, reply) => {
      const params = workspaceParamsSchema.parse(request.params);
      const { session, membership } = await requireAdmin(app, request, params.workspaceId);
      if (!session) return reply.code(401).send({ message: "Authentication required" });
      if (!membership) return reply.code(403).send({ message: "Admin or Owner role required" });

      let rows: Array<Record<string, unknown>>;
      const contentType = (request.headers["content-type"] ?? "").toLowerCase();

      if (contentType.includes("text/csv")) {
        const csvText = request.body as string;
        rows = parseCsv(typeof csvText === "string" ? csvText : String(csvText));
      } else {
        const body = importBodySchema.parse(request.body);
        rows = body.rows;
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: Array<{ row: number; error: string }> = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const parsed = jobRowSchema.parse(rows[i]);
          const normalized = normalizeName(parsed.name);
          if (!normalized) { skipped++; continue; }

          let customerId: string | null = null;
          if (parsed.customerName) {
            const customerNorm = normalizeName(parsed.customerName);
            const customer = await app.services.prisma.customer.findUnique({
              where: {
                workspaceId_normalizedName: {
                  workspaceId: params.workspaceId,
                  normalizedName: customerNorm
                }
              },
              select: { id: true }
            });
            customerId = customer?.id ?? null;
          }

          await app.services.prisma.job.upsert({
            where: {
              workspaceId_normalizedName: {
                workspaceId: params.workspaceId,
                normalizedName: normalized
              }
            },
            update: {
              name: parsed.name.trim(),
              jobNumber: parsed.jobNumber?.trim() ?? null,
              customerId,
              status: parsed.status ?? "ACTIVE",
              externalRef: parsed.externalRef?.trim() ?? null,
              notes: parsed.notes?.trim() ?? null
            },
            create: {
              workspaceId: params.workspaceId,
              name: parsed.name.trim(),
              normalizedName: normalized,
              jobNumber: parsed.jobNumber?.trim() ?? null,
              customerId,
              status: parsed.status ?? "ACTIVE",
              externalRef: parsed.externalRef?.trim() ?? null,
              notes: parsed.notes?.trim() ?? null
            }
          });

          const exists = await app.services.prisma.job.findUnique({
            where: {
              workspaceId_normalizedName: {
                workspaceId: params.workspaceId,
                normalizedName: normalized
              }
            },
            select: { createdAt: true, updatedAt: true }
          });

          if (exists && exists.createdAt.getTime() === exists.updatedAt.getTime()) {
            created++;
          } else {
            updated++;
          }
        } catch (e) {
          errors.push({ row: i + 1, error: e instanceof Error ? e.message : "Invalid row" });
          skipped++;
        }
      }

      await app.services.auditEventLogger.log({
        workspaceId: params.workspaceId,
        actorUserId: session.userId,
        entityType: "JOB",
        entityId: params.workspaceId,
        action: "import.jobs",
        metadata: { totalRows: rows.length, created, updated, skipped, errorCount: errors.length },
        request
      });

      return reply.send({
        status: "completed",
        entity: "job",
        totalRows: rows.length,
        created,
        updated,
        skipped,
        errors: errors.slice(0, 20)
      });
    }
  );
};
