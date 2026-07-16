import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  normalizeName,
  normalizeEmail,
  extractDomain,
  findDuplicates,
  computeSimilarity
} from "@forgeops/shared";

import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";
import { getSessionFromRequest } from "../authentication.js";

const wsParams = z.object({ workspaceId: z.string().min(1) });

async function requireAuth(app: FastifyInstance, request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply, workspaceId: string) {
  const session = await getSessionFromRequest(request);
  if (!session) { reply.code(401).send({ message: "Authentication required" }); return null; }
  const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
  if (!membership) { reply.code(403).send({ message: "Workspace access denied" }); return null; }
  return { userId: session.userId, role: membership.role };
}

function requireEditor(role: string): boolean {
  return ["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(role);
}

const importPreviewSchema = z.object({
  entityType: z.enum(["CUSTOMER", "VENDOR"]),
  rows: z.array(z.object({
    name: z.string().min(1).max(300),
    email: z.string().max(300).optional(),
    phone: z.string().max(50).optional(),
    domain: z.string().max(200).optional(),
    externalRef: z.string().max(200).optional(),
    notes: z.string().max(2000).optional()
  })).min(1).max(500)
});

const importCommitSchema = z.object({
  entityType: z.enum(["CUSTOMER", "VENDOR"]),
  rows: z.array(z.object({
    name: z.string().min(1).max(300),
    email: z.string().max(300).optional(),
    phone: z.string().max(50).optional(),
    domain: z.string().max(200).optional(),
    externalRef: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    action: z.enum(["create", "skip", "update"]).default("create"),
    existingId: z.string().optional()
  })).min(1).max(500),
  knowledgeDocumentId: z.string().optional()
});

export const registerReferenceDataRoutes = async (app: FastifyInstance): Promise<void> => {

  // -- CUSTOMERS CRUD --
  app.get("/api/v1/workspaces/:workspaceId/reference/customers", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const customers = await app.services.prisma.customer.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { aliases: true, contacts: true, jobs: true } }
      }
    });

    return reply.send({ customers });
  });

  // -- VENDORS CRUD --
  app.get("/api/v1/workspaces/:workspaceId/reference/vendors", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const vendors = await app.services.prisma.vendor.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { aliases: true, contacts: true } }
      }
    });

    return reply.send({ vendors });
  });

  // -- JOBS CRUD --
  app.get("/api/v1/workspaces/:workspaceId/reference/jobs", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const jobs = await app.services.prisma.job.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
      include: {
        customer: { select: { id: true, name: true } },
        _count: { select: { aliases: true } }
      }
    });

    return reply.send({ jobs });
  });

  // -- CONTACTS --
  app.get("/api/v1/workspaces/:workspaceId/reference/contacts", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const contacts = await app.services.prisma.entityContact.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } }
      }
    });

    return reply.send({ contacts });
  });

  // -- ALIASES --
  app.get("/api/v1/workspaces/:workspaceId/reference/aliases", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const aliases = await app.services.prisma.entityAlias.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        job: { select: { id: true, name: true } }
      }
    });

    return reply.send({ aliases });
  });

  // -- IMPORT RUNS --
  app.get("/api/v1/workspaces/:workspaceId/reference/imports", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const imports = await app.services.prisma.importRun.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        knowledgeDocument: { select: { id: true, filename: true } }
      }
    });

    return reply.send({ imports });
  });

  // -- IMPORT PREVIEW --
  app.post("/api/v1/workspaces/:workspaceId/reference/import/preview", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth || !requireEditor(auth.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = importPreviewSchema.parse(request.body);
    const isCustomer = body.entityType === "CUSTOMER";

    const existingEntries = isCustomer
      ? await app.services.prisma.customer.findMany({
          where: { workspaceId },
          select: { id: true, name: true, normalizedName: true }
        })
      : await app.services.prisma.vendor.findMany({
          where: { workspaceId },
          select: { id: true, name: true, normalizedName: true }
        });

    const preview = body.rows.map(row => {
      const normalized = normalizeName(row.name);
      const duplicates = findDuplicates(normalized, row.name, existingEntries);
      return {
        name: row.name,
        normalizedName: normalized,
        email: row.email ?? null,
        phone: row.phone ?? null,
        domain: row.domain ?? (row.email ? extractDomain(row.email) : null),
        duplicates,
        suggestedAction: duplicates.length > 0 && duplicates[0]!.score >= 0.95 ? "skip" as const : "create" as const
      };
    });

    return reply.send({ entityType: body.entityType, preview });
  });

  // -- IMPORT COMMIT --
  app.post("/api/v1/workspaces/:workspaceId/reference/import/commit", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth || !requireEditor(auth.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = importCommitSchema.parse(request.body);
    const isCustomer = body.entityType === "CUSTOMER";
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ row: number; error: string }> = [];

    const importRun = await app.services.prisma.importRun.create({
      data: {
        workspaceId,
        knowledgeDocumentId: body.knowledgeDocumentId ?? null,
        importType: body.entityType,
        status: "PROCESSING",
        rowsRead: body.rows.length
      }
    });

    await app.services.prisma.$transaction(async (tx) => {
      for (let i = 0; i < body.rows.length; i++) {
        const row = body.rows[i]!;
        const normalized = normalizeName(row.name);
        const domain = row.domain ?? (row.email ? extractDomain(row.email) : null);

        try {
          if (row.action === "skip") {
            skipped++;
            continue;
          }

          if (row.action === "update" && row.existingId) {
            if (isCustomer) {
              await tx.customer.update({
                where: { id: row.existingId },
                data: {
                  ...(row.email ? { primaryEmail: row.email.toLowerCase() } : {}),
                  ...(row.phone ? { phone: row.phone } : {}),
                  ...(domain ? { domain } : {}),
                  ...(row.notes ? { notes: row.notes } : {}),
                  ...(row.externalRef ? { externalRef: row.externalRef } : {})
                }
              });
            } else {
              await tx.vendor.update({
                where: { id: row.existingId },
                data: {
                  ...(row.email ? { primaryEmail: row.email.toLowerCase() } : {}),
                  ...(row.phone ? { phone: row.phone } : {}),
                  ...(domain ? { domain } : {}),
                  ...(row.notes ? { notes: row.notes } : {}),
                  ...(row.externalRef ? { externalRef: row.externalRef } : {})
                }
              });
            }

            if (normalized !== normalizeName(row.name)) {
              await tx.entityAlias.upsert({
                where: {
                  workspaceId_entityType_normalizedAlias: {
                    workspaceId,
                    entityType: body.entityType,
                    normalizedAlias: normalized
                  }
                },
                update: {},
                create: {
                  workspaceId,
                  entityType: body.entityType,
                  ...(isCustomer ? { customerId: row.existingId } : { vendorId: row.existingId }),
                  alias: row.name,
                  normalizedAlias: normalized,
                  source: "IMPORT"
                }
              });
            }

            updated++;
            continue;
          }

          let entityId: string;

          if (isCustomer) {
            const entity = await tx.customer.upsert({
              where: {
                workspaceId_normalizedName: { workspaceId, normalizedName: normalized }
              },
              update: {
                ...(row.email ? { primaryEmail: row.email.toLowerCase() } : {}),
                ...(row.phone ? { phone: row.phone } : {}),
                ...(domain ? { domain } : {}),
                ...(row.notes ? { notes: row.notes } : {}),
                ...(row.externalRef ? { externalRef: row.externalRef } : {})
              },
              create: {
                workspaceId,
                name: row.name,
                normalizedName: normalized,
                primaryEmail: row.email?.toLowerCase() ?? null,
                domain,
                phone: row.phone ?? null,
                externalRef: row.externalRef ?? null,
                notes: row.notes ?? null
              }
            });
            entityId = entity.id;
          } else {
            const entity = await tx.vendor.upsert({
              where: {
                workspaceId_normalizedName: { workspaceId, normalizedName: normalized }
              },
              update: {
                ...(row.email ? { primaryEmail: row.email.toLowerCase() } : {}),
                ...(row.phone ? { phone: row.phone } : {}),
                ...(domain ? { domain } : {}),
                ...(row.notes ? { notes: row.notes } : {}),
                ...(row.externalRef ? { externalRef: row.externalRef } : {})
              },
              create: {
                workspaceId,
                name: row.name,
                normalizedName: normalized,
                primaryEmail: row.email?.toLowerCase() ?? null,
                domain,
                phone: row.phone ?? null,
                externalRef: row.externalRef ?? null,
                notes: row.notes ?? null
              }
            });
            entityId = entity.id;
          }

          await tx.entityAlias.upsert({
            where: {
              workspaceId_entityType_normalizedAlias: {
                workspaceId,
                entityType: body.entityType,
                normalizedAlias: normalized
              }
            },
            update: {},
            create: {
              workspaceId,
              entityType: body.entityType,
              ...(isCustomer ? { customerId: entityId } : { vendorId: entityId }),
              alias: row.name,
              normalizedAlias: normalized,
              source: "IMPORT"
            }
          });

          if (row.email) {
            await tx.entityContact.upsert({
              where: { id: `${workspaceId}:${row.email.toLowerCase()}` },
              update: {},
              create: {
                workspaceId,
                ...(isCustomer ? { customerId: entityId } : { vendorId: entityId }),
                email: row.email.toLowerCase(),
                normalizedEmail: normalizeEmail(row.email),
                domain: domain ?? extractDomain(row.email),
                phone: row.phone ?? null,
                source: "IMPORT"
              }
            });
          }

          created++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            skipped++;
          } else {
            errors.push({ row: i, error: e instanceof Error ? e.message : "Unknown error" });
          }
        }
      }
    }, { timeout: 60_000 });

    await app.services.prisma.importRun.update({
      where: { id: importRun.id },
      data: {
        status: errors.length > 0 ? "FAILED" : "COMPLETED",
        createdCount: created,
        updatedCount: updated,
        skippedCount: skipped,
        errorCount: errors.length,
        errorsJson: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        completedAt: new Date()
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "IMPORT_RUN",
      entityId: importRun.id,
      action: "reference.import_completed",
      metadata: { entityType: body.entityType, created, updated, skipped, errors: errors.length },
      request
    });

    return reply.send({
      importRunId: importRun.id,
      status: errors.length > 0 ? "partial" : "completed",
      created,
      updated,
      skipped,
      errors
    });
  });

  // -- CLASSIFICATION CANDIDATES --
  app.post("/api/v1/workspaces/:workspaceId/classification-candidates", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const body = z.object({
      senderName: z.string().max(200).optional(),
      senderEmail: z.string().email(),
      senderDomain: z.string().max(200),
      subject: z.string().max(500).optional(),
      cleanBody: z.string().max(10000).optional(),
      attachmentNames: z.array(z.string()).max(50).default([])
    }).parse(request.body);

    const normalizedSenderEmail = normalizeEmail(body.senderEmail);
    const senderDomain = body.senderDomain.toLowerCase();

    const [contacts, aliases, customers, vendors, jobs] = await Promise.all([
      app.services.prisma.entityContact.findMany({
        where: { workspaceId, OR: [
          { normalizedEmail: normalizedSenderEmail },
          { domain: senderDomain }
        ]},
        select: { id: true, customerId: true, vendorId: true, normalizedEmail: true, domain: true }
      }),
      app.services.prisma.entityAlias.findMany({
        where: { workspaceId },
        select: { id: true, entityType: true, customerId: true, vendorId: true, jobId: true, alias: true, normalizedAlias: true }
      }),
      app.services.prisma.customer.findMany({
        where: { workspaceId },
        select: { id: true, name: true, normalizedName: true, domain: true, primaryEmail: true }
      }),
      app.services.prisma.vendor.findMany({
        where: { workspaceId },
        select: { id: true, name: true, normalizedName: true, domain: true, primaryEmail: true }
      }),
      app.services.prisma.job.findMany({
        where: { workspaceId },
        select: { id: true, name: true, normalizedName: true, jobNumber: true, customerId: true }
      })
    ]);

    const customerCandidates: Array<{ id: string; name: string; matchedOn: string[]; score: number }> = [];
    const vendorCandidates: Array<{ id: string; name: string; matchedOn: string[]; score: number }> = [];
    const jobCandidates: Array<{ id: string; name: string; matchedOn: string[]; score: number }> = [];
    let knownSender = false;

    const scored = new Map<string, { id: string; name: string; matchedOn: Set<string>; score: number; type: "customer" | "vendor" }>();

    function addCandidate(type: "customer" | "vendor", id: string, name: string, matchOn: string, score: number) {
      const key = `${type}:${id}`;
      const existing = scored.get(key);
      if (existing) {
        existing.matchedOn.add(matchOn);
        existing.score = Math.max(existing.score, score);
      } else {
        scored.set(key, { id, name, matchedOn: new Set([matchOn]), score, type });
      }
    }

    for (const contact of contacts) {
      knownSender = true;
      if (contact.normalizedEmail === normalizedSenderEmail) {
        if (contact.customerId) {
          const c = customers.find(x => x.id === contact.customerId);
          if (c) addCandidate("customer", c.id, c.name, "email", 1.0);
        }
        if (contact.vendorId) {
          const v = vendors.find(x => x.id === contact.vendorId);
          if (v) addCandidate("vendor", v.id, v.name, "email", 1.0);
        }
      } else if (contact.domain === senderDomain) {
        if (contact.customerId) {
          const c = customers.find(x => x.id === contact.customerId);
          if (c) addCandidate("customer", c.id, c.name, "domain", 0.85);
        }
        if (contact.vendorId) {
          const v = vendors.find(x => x.id === contact.vendorId);
          if (v) addCandidate("vendor", v.id, v.name, "domain", 0.85);
        }
      }
    }

    for (const c of customers) {
      if (c.domain === senderDomain) addCandidate("customer", c.id, c.name, "domain", 0.85);
      if (c.primaryEmail && normalizeEmail(c.primaryEmail) === normalizedSenderEmail) addCandidate("customer", c.id, c.name, "email", 1.0);
    }

    for (const v of vendors) {
      if (v.domain === senderDomain) addCandidate("vendor", v.id, v.name, "domain", 0.85);
      if (v.primaryEmail && normalizeEmail(v.primaryEmail) === normalizedSenderEmail) addCandidate("vendor", v.id, v.name, "email", 1.0);
    }

    if (body.senderName) {
      const normalizedSender = normalizeName(body.senderName);
      for (const alias of aliases) {
        if (alias.normalizedAlias === normalizedSender) {
          if (alias.entityType === "CUSTOMER" && alias.customerId) {
            const c = customers.find(x => x.id === alias.customerId);
            if (c) addCandidate("customer", c.id, c.name, "alias", 0.90);
          }
          if (alias.entityType === "VENDOR" && alias.vendorId) {
            const v = vendors.find(x => x.id === alias.vendorId);
            if (v) addCandidate("vendor", v.id, v.name, "alias", 0.90);
          }
        }
      }

      for (const c of customers) {
        const sim = computeSimilarity(normalizedSender, c.normalizedName);
        if (sim >= 0.6) addCandidate("customer", c.id, c.name, "name", sim * 0.8);
      }
      for (const v of vendors) {
        const sim = computeSimilarity(normalizedSender, v.normalizedName);
        if (sim >= 0.6) addCandidate("vendor", v.id, v.name, "name", sim * 0.8);
      }
    }

    const searchText = `${body.subject ?? ""} ${body.cleanBody ?? ""}`.toLowerCase();
    for (const job of jobs) {
      if (job.jobNumber && searchText.includes(job.jobNumber.toLowerCase())) {
        jobCandidates.push({ id: job.id, name: job.name, matchedOn: ["jobNumber"], score: 0.95 });
      } else {
        const sim = computeSimilarity(normalizeName(job.name), normalizeName(searchText.slice(0, 200)));
        if (sim >= 0.5) {
          jobCandidates.push({ id: job.id, name: job.name, matchedOn: ["name"], score: sim * 0.7 });
        }
      }
    }

    for (const [, entry] of scored) {
      const candidate = { id: entry.id, name: entry.name, matchedOn: [...entry.matchedOn], score: entry.score };
      if (entry.type === "customer") customerCandidates.push(candidate);
      else vendorCandidates.push(candidate);
    }

    customerCandidates.sort((a, b) => b.score - a.score);
    vendorCandidates.sort((a, b) => b.score - a.score);
    jobCandidates.sort((a, b) => b.score - a.score);

    return reply.send({
      knownSender,
      customerCandidates: customerCandidates.slice(0, 5),
      vendorCandidates: vendorCandidates.slice(0, 5),
      jobCandidates: jobCandidates.slice(0, 5)
    });
  });

  // -- KNOWLEDGE DOCUMENTS --
  app.get("/api/v1/workspaces/:workspaceId/reference/documents", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth) return;

    const docs = await app.services.prisma.knowledgeDocument.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, filename: true, mimeType: true, status: true, documentType: true,
        fileSize: true, createdAt: true, createdBy: true,
        createdByUser: { select: { email: true, name: true } }
      }
    });

    return reply.send({ documents: docs });
  });

  app.post("/api/v1/workspaces/:workspaceId/reference/documents", async (request, reply) => {
    const { workspaceId } = wsParams.parse(request.params);
    const auth = await requireAuth(app, request, reply, workspaceId);
    if (!auth || !requireEditor(auth.role)) {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const body = z.object({
      filename: z.string().min(1).max(200),
      mimeType: z.string().min(1).max(100),
      documentType: z.enum(["CUSTOMER_LIST", "VENDOR_LIST", "JOB_LIST", "CLASSIFICATION_GUIDE", "OTHER"]),
      extractedText: z.string().max(500_000).optional(),
      fileSize: z.number().int().positive().optional()
    }).parse(request.body);

    const sanitizedFilename = body.filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    const doc = await app.services.prisma.knowledgeDocument.create({
      data: {
        workspaceId,
        filename: sanitizedFilename,
        mimeType: body.mimeType,
        documentType: body.documentType,
        status: body.extractedText ? "READY" : "UPLOADED",
        extractedText: body.extractedText ?? null,
        fileSize: body.fileSize ?? null,
        createdBy: auth.userId
      }
    });

    await app.services.auditEventLogger.log({
      workspaceId,
      actorUserId: auth.userId,
      entityType: "KNOWLEDGE_DOCUMENT",
      entityId: doc.id,
      action: "reference.document_created",
      metadata: { filename: sanitizedFilename, documentType: body.documentType },
      request
    });

    return reply.code(201).send({ document: doc });
  });

  app.get("/api/v1/workspaces/:workspaceId/reference/documents/:documentId/text", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), documentId: z.string().min(1) }).parse(request.params);
    const auth = await requireAuth(app, request, reply, params.workspaceId);
    if (!auth) return;

    const doc = await app.services.prisma.knowledgeDocument.findFirst({
      where: { id: params.documentId, workspaceId: params.workspaceId },
      select: { id: true, extractedText: true, status: true, documentType: true, filename: true }
    });

    if (!doc) return reply.code(404).send({ message: "Document not found" });

    return reply.send({ document: doc });
  });
};
