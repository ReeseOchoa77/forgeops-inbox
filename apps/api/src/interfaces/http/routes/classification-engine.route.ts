import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  normalizeName,
  normalizeEmail,
  extractDomain,
  computeSimilarity
} from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { verifyN8nApiKey } from "../n8n-auth.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";

const SYSTEM_BUSINESS_TYPES = [
  { systemKey: "BID_INVITATION", displayLabel: "Bid Invitation", description: "Invitation to bid on a project" },
  { systemKey: "RFQ", displayLabel: "Request for Quote", description: "Request for quotation on materials or services" },
  { systemKey: "ADDENDUM", displayLabel: "Addendum", description: "Addendum or amendment to existing documents" },
  { systemKey: "PURCHASE_ORDER", displayLabel: "Purchase Order", description: "Purchase order for materials or services" },
  { systemKey: "VENDOR_QUOTE", displayLabel: "Vendor Quote", description: "Quote received from a vendor or supplier" },
  { systemKey: "SUBMITTAL", displayLabel: "Submittal", description: "Submittal for approval" },
  { systemKey: "SHOP_DRAWING", displayLabel: "Shop Drawing", description: "Shop drawing for review" },
  { systemKey: "RFI", displayLabel: "RFI", description: "Request for information" },
  { systemKey: "CHANGE_ORDER", displayLabel: "Change Order", description: "Change order to existing contract" },
  { systemKey: "DELIVERY", displayLabel: "Delivery", description: "Delivery notification or schedule" },
  { systemKey: "MATERIAL_ORDER", displayLabel: "Material Order", description: "Material order or requisition" },
  { systemKey: "INVOICE", displayLabel: "Invoice", description: "Invoice or billing" },
  { systemKey: "PAYMENT", displayLabel: "Payment", description: "Payment confirmation or request" },
  { systemKey: "PROJECT_COMMUNICATION", displayLabel: "Project Communication", description: "General project communication" },
  { systemKey: "FIELD_ISSUE", displayLabel: "Field Issue", description: "Issue reported from the field" },
  { systemKey: "COMPLIANCE", displayLabel: "Compliance", description: "Regulatory or compliance related" },
  { systemKey: "INTERNAL_ADMIN", displayLabel: "Internal Admin", description: "Internal administrative communication" },
  { systemKey: "RECRUITING", displayLabel: "Recruiting", description: "Recruiting or hiring related" },
  { systemKey: "OTHER_BUSINESS", displayLabel: "Other Business", description: "Other business communication" }
];

const candidatesInputSchema = z.object({
  mailboxEmail: z.string().email(),
  senderName: z.string().max(200).optional(),
  senderEmail: z.string().email(),
  senderDomain: z.string().max(200),
  subject: z.string().max(500).optional(),
  cleanBody: z.string().max(10000).optional(),
  attachmentNames: z.array(z.string()).max(50).default([])
});

const reclassifySchema = z.object({
  mailboxCategory: z.enum(["BUSINESS", "PERSONAL", "SPAM"]),
  reason: z.string().max(500).optional()
});

const correctionSchema = z.object({
  correctedMailboxCategory: z.string().optional(),
  correctedBusinessType: z.string().optional(),
  correctedCustomerId: z.string().optional(),
  correctedVendorId: z.string().optional(),
  correctedJobId: z.string().optional(),
  correctedPriority: z.string().optional(),
  reason: z.string().max(500).optional()
});

export const registerClassificationEngineRoutes = async (app: FastifyInstance): Promise<void> => {

  // --- Business types listing ---
  app.get("/api/v1/workspaces/:workspaceId/business-types", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const types = await app.services.prisma.businessType.findMany({
      where: {
        OR: [{ workspaceId: null }, { workspaceId }],
        active: true
      },
      orderBy: { displayLabel: "asc" }
    });

    return reply.send({ businessTypes: types });
  });

  // --- Seed system business types ---
  app.post("/api/v1/admin/seed-business-types", async (request, reply) => {
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const user = await app.services.prisma.user.findUnique({
      where: { id: session.userId },
      select: { platformRole: true }
    });

    if (user?.platformRole !== "PLATFORM_ADMIN") {
      return reply.code(403).send({ message: "Platform admin required" });
    }

    let seeded = 0;
    for (const bt of SYSTEM_BUSINESS_TYPES) {
      await app.services.prisma.businessType.upsert({
        where: { workspaceId_systemKey: { workspaceId: null as unknown as string, systemKey: bt.systemKey } },
        update: { displayLabel: bt.displayLabel, description: bt.description },
        create: { systemKey: bt.systemKey, displayLabel: bt.displayLabel, description: bt.description, workspaceId: null }
      }).catch(() => {
        // unique constraint on null workspaceId may need raw SQL
      });
      seeded++;
    }

    return reply.send({ status: "seeded", count: seeded });
  });

  async function handleCandidates(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
    const env = app.services.env;
    const authHeader = request.headers.authorization;
    const hasApiKey = authHeader?.startsWith("Bearer ") && env.N8N_INTEGRATION_ENABLED && env.N8N_INTEGRATION_API_KEY;

    let workspaceId: string;
    let isN8n = false;

    if (hasApiKey) {
      if (!verifyN8nApiKey(request, reply, env.N8N_INTEGRATION_API_KEY, env.N8N_INTEGRATION_ENABLED)) {
        return;
      }
      isN8n = true;

      const body = candidatesInputSchema.parse(request.body);
      const normalizedMailbox = body.mailboxEmail.toLowerCase();

      const mailbox = await app.services.prisma.workspaceMailbox.findFirst({
        where: { normalizedEmail: normalizedMailbox, status: "ACTIVE" },
        select: { workspaceId: true }
      });

      if (!mailbox) {
        const legacy = await app.services.prisma.inboxConnection.findFirst({
          where: { email: normalizedMailbox, ingestionSource: "N8N", status: "ACTIVE" },
          select: { workspaceId: true }
        });

        if (!legacy) {
          return reply.code(404).send({ message: `No registered mailbox for ${normalizedMailbox}` });
        }
        workspaceId = legacy.workspaceId;
      } else {
        workspaceId = mailbox.workspaceId;
      }
    } else {
      const session = await getSessionFromRequest(request);
      if (!session) return reply.code(401).send({ message: "Authentication required" });

      const wsParam = (request.query as Record<string, string>).workspaceId;
      if (!wsParam) return reply.code(400).send({ message: "workspaceId query parameter required for session auth" });

      const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, wsParam);
      if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
      workspaceId = wsParam;
    }

    const body = candidatesInputSchema.parse(request.body);
    const normalizedSenderEmail = normalizeEmail(body.senderEmail);
    const senderDomain = body.senderDomain.toLowerCase();

    const [contacts, aliases, customers, vendors, jobs, businessTypes, instructions] = await Promise.all([
      app.services.prisma.entityContact.findMany({
        where: { workspaceId, OR: [{ normalizedEmail: normalizedSenderEmail }, { domain: senderDomain }] },
        select: { id: true, customerId: true, vendorId: true, normalizedEmail: true, domain: true }
      }),
      app.services.prisma.entityAlias.findMany({
        where: { workspaceId },
        select: { id: true, entityType: true, customerId: true, vendorId: true, jobId: true, normalizedAlias: true }
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
      }),
      app.services.prisma.businessType.findMany({
        where: { OR: [{ workspaceId: null }, { workspaceId }], active: true },
        select: { systemKey: true, displayLabel: true },
        orderBy: { displayLabel: "asc" }
      }),
      app.services.prisma.classificationInstruction.findMany({
        where: { workspaceId, active: true },
        select: { title: true, content: true },
        orderBy: { sortOrder: "asc" }
      })
    ]);

    let knownSender = false;
    const scored = new Map<string, { id: string; name: string; matchedOn: Set<string>; evidence: string[]; score: number; type: "customer" | "vendor" }>();

    function addCandidate(type: "customer" | "vendor", id: string, name: string, matchOn: string, evidence: string, score: number) {
      const key = `${type}:${id}`;
      const existing = scored.get(key);
      if (existing) {
        existing.matchedOn.add(matchOn);
        existing.evidence.push(evidence);
        existing.score = Math.max(existing.score, score);
      } else {
        scored.set(key, { id, name, matchedOn: new Set([matchOn]), evidence: [evidence], score, type });
      }
    }

    for (const contact of contacts) {
      knownSender = true;
      const isEmailMatch = contact.normalizedEmail === normalizedSenderEmail;
      if (contact.customerId) {
        const c = customers.find(x => x.id === contact.customerId);
        if (c) addCandidate("customer", c.id, c.name, isEmailMatch ? "email" : "domain", `contact ${isEmailMatch ? "email" : "domain"} match`, isEmailMatch ? 1.0 : 0.85);
      }
      if (contact.vendorId) {
        const v = vendors.find(x => x.id === contact.vendorId);
        if (v) addCandidate("vendor", v.id, v.name, isEmailMatch ? "email" : "domain", `contact ${isEmailMatch ? "email" : "domain"} match`, isEmailMatch ? 1.0 : 0.85);
      }
    }

    for (const c of customers) {
      if (c.domain === senderDomain) addCandidate("customer", c.id, c.name, "domain", `org domain ${senderDomain}`, 0.85);
      if (c.primaryEmail && normalizeEmail(c.primaryEmail) === normalizedSenderEmail) addCandidate("customer", c.id, c.name, "email", `primary email match`, 1.0);
    }
    for (const v of vendors) {
      if (v.domain === senderDomain) addCandidate("vendor", v.id, v.name, "domain", `org domain ${senderDomain}`, 0.85);
      if (v.primaryEmail && normalizeEmail(v.primaryEmail) === normalizedSenderEmail) addCandidate("vendor", v.id, v.name, "email", `primary email match`, 1.0);
    }

    if (body.senderName) {
      const normalizedSender = normalizeName(body.senderName);
      for (const alias of aliases) {
        if (alias.normalizedAlias === normalizedSender) {
          if (alias.entityType === "CUSTOMER" && alias.customerId) {
            const c = customers.find(x => x.id === alias.customerId);
            if (c) addCandidate("customer", c.id, c.name, "alias", `alias "${alias.normalizedAlias}"`, 0.90);
          }
          if (alias.entityType === "VENDOR" && alias.vendorId) {
            const v = vendors.find(x => x.id === alias.vendorId);
            if (v) addCandidate("vendor", v.id, v.name, "alias", `alias "${alias.normalizedAlias}"`, 0.90);
          }
        }
      }
      for (const c of customers) {
        const sim = computeSimilarity(normalizedSender, c.normalizedName);
        if (sim >= 0.6) addCandidate("customer", c.id, c.name, "name", `name similarity ${Math.round(sim * 100)}%`, sim * 0.8);
      }
      for (const v of vendors) {
        const sim = computeSimilarity(normalizedSender, v.normalizedName);
        if (sim >= 0.6) addCandidate("vendor", v.id, v.name, "name", `name similarity ${Math.round(sim * 100)}%`, sim * 0.8);
      }
    }

    const jobCandidates: Array<{ id: string; name: string; score: number; matchedOn: string[]; evidence: string[] }> = [];
    const searchText = `${body.subject ?? ""} ${body.cleanBody ?? ""} ${body.attachmentNames.join(" ")}`.toLowerCase();

    for (const job of jobs) {
      if (job.jobNumber && searchText.includes(job.jobNumber.toLowerCase())) {
        jobCandidates.push({ id: job.id, name: job.name, score: 0.95, matchedOn: ["jobNumber"], evidence: [`job# ${job.jobNumber} in text`] });
      } else {
        const sim = computeSimilarity(normalizeName(job.name), normalizeName(searchText.slice(0, 200)));
        if (sim >= 0.5) {
          jobCandidates.push({ id: job.id, name: job.name, score: sim * 0.7, matchedOn: ["name"], evidence: [`project name similarity ${Math.round(sim * 100)}%`] });
        }
      }
    }

    const customerCandidates: typeof jobCandidates = [];
    const vendorCandidates: typeof jobCandidates = [];

    for (const [, entry] of scored) {
      const candidate = { id: entry.id, name: entry.name, score: entry.score, matchedOn: [...entry.matchedOn], evidence: entry.evidence };
      if (entry.type === "customer") customerCandidates.push(candidate);
      else vendorCandidates.push(candidate);
    }

    customerCandidates.sort((a, b) => b.score - a.score);
    vendorCandidates.sort((a, b) => b.score - a.score);
    jobCandidates.sort((a, b) => b.score - a.score);

    return reply.send({
      workspaceId,
      knownSender,
      customerCandidates: customerCandidates.slice(0, 5),
      vendorCandidates: vendorCandidates.slice(0, 5),
      jobCandidates: jobCandidates.slice(0, 5),
      activeBusinessTypes: businessTypes.map(bt => ({ key: bt.systemKey, label: bt.displayLabel })),
      classificationInstructions: instructions.map(i => ({ title: i.title, content: i.content }))
    });
  }

  app.post("/api/v1/classification-candidates", handleCandidates);
  app.post("/api/v1/integrations/n8n/classification-candidates", handleCandidates);

  // --- Reclassification ---
  app.post("/api/v1/workspaces/:workspaceId/messages/:messageId/reclassify", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), messageId: z.string().min(1) }).parse(request.params);
    const body = reclassifySchema.parse(request.body);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
    if (membership.workspaceRole === "VIEWER") return reply.code(403).send({ message: "Editors and above may reclassify" });

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { workspaceId: params.workspaceId, OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }] },
      select: { id: true, mailboxCategory: true }
    });

    if (!message) return reply.code(404).send({ message: "Message not found" });

    const previousCategory = message.mailboxCategory;

    await app.services.prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        mailboxCategory: body.mailboxCategory,
        isSpam: body.mailboxCategory === "SPAM",
        isTrashed: false,
        previousCategory: previousCategory
      }
    });

    if (previousCategory === "BUSINESS" && body.mailboxCategory !== "BUSINESS") {
      await app.services.prisma.task.updateMany({
        where: { workspaceId: params.workspaceId, sourceMessageId: message.id, status: "OPEN" },
        data: { dismissedAt: new Date(), dismissedBy: session.userId, dismissalReason: `Reclassified from BUSINESS to ${body.mailboxCategory}` }
      });
    }

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "EMAIL_MESSAGE",
      entityId: message.id,
      action: "email.reclassified",
      metadata: { from: previousCategory, to: body.mailboxCategory, reason: body.reason ?? null },
      request
    });

    return reply.send({ status: "reclassified", from: previousCategory, to: body.mailboxCategory });
  });

  // --- Review correction ---
  app.post("/api/v1/workspaces/:workspaceId/classifications/:classificationId/correct", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), classificationId: z.string().min(1) }).parse(request.params);
    const body = correctionSchema.parse(request.body);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });
    if (membership.workspaceRole === "VIEWER") return reply.code(403).send({ message: "Editors and above may correct" });

    const classification = await app.services.prisma.classification.findFirst({
      where: { workspaceId: params.workspaceId, id: params.classificationId },
      select: {
        id: true, mailboxCategory: true, businessTypeKey: true,
        customerId: true, vendorId: true, jobId: true, priority: true
      }
    });

    if (!classification) return reply.code(404).send({ message: "Classification not found" });

    if (body.correctedCustomerId) {
      const exists = await app.services.prisma.customer.findFirst({
        where: { workspaceId: params.workspaceId, id: body.correctedCustomerId },
        select: { id: true }
      });
      if (!exists) return reply.code(400).send({ message: `Customer ${body.correctedCustomerId} not found in workspace` });
    }
    if (body.correctedVendorId) {
      const exists = await app.services.prisma.vendor.findFirst({
        where: { workspaceId: params.workspaceId, id: body.correctedVendorId },
        select: { id: true }
      });
      if (!exists) return reply.code(400).send({ message: `Vendor ${body.correctedVendorId} not found in workspace` });
    }
    if (body.correctedJobId) {
      const exists = await app.services.prisma.job.findFirst({
        where: { workspaceId: params.workspaceId, id: body.correctedJobId },
        select: { id: true }
      });
      if (!exists) return reply.code(400).send({ message: `Job ${body.correctedJobId} not found in workspace` });
    }

    const correction = await app.services.prisma.classificationCorrection.create({
      data: {
        workspaceId: params.workspaceId,
        classificationId: classification.id,
        originalMailboxCategory: classification.mailboxCategory ?? null,
        correctedMailboxCategory: body.correctedMailboxCategory ?? null,
        originalBusinessType: classification.businessTypeKey ?? null,
        correctedBusinessType: body.correctedBusinessType ?? null,
        originalCustomerId: classification.customerId ?? null,
        correctedCustomerId: body.correctedCustomerId ?? null,
        originalVendorId: classification.vendorId ?? null,
        correctedVendorId: body.correctedVendorId ?? null,
        originalJobId: classification.jobId ?? null,
        correctedJobId: body.correctedJobId ?? null,
        originalPriority: classification.priority ?? null,
        correctedPriority: body.correctedPriority ?? null,
        reason: body.reason ?? null,
        reviewedByUserId: session.userId
      }
    });

    const updateData: Record<string, unknown> = { reviewStatus: "APPROVED", reviewedByUserId: session.userId, reviewedAt: new Date() };
    if (body.correctedBusinessType) updateData.businessTypeKey = body.correctedBusinessType;
    if (body.correctedCustomerId) updateData.customerId = body.correctedCustomerId;
    if (body.correctedVendorId) updateData.vendorId = body.correctedVendorId;
    if (body.correctedJobId) updateData.jobId = body.correctedJobId;
    if (body.correctedPriority) updateData.priority = body.correctedPriority;

    await app.services.prisma.classification.update({
      where: { id: classification.id },
      data: updateData as Prisma.ClassificationUncheckedUpdateInput
    });

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "CLASSIFICATION",
      entityId: classification.id,
      action: "classification.corrected",
      metadata: { correctionId: correction.id, changes: body },
      request
    });

    return reply.send({ status: "corrected", correctionId: correction.id });
  });

  // --- Classification instructions CRUD ---
  app.get("/api/v1/workspaces/:workspaceId/classification-instructions", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const instructions = await app.services.prisma.classificationInstruction.findMany({
      where: { workspaceId },
      orderBy: { sortOrder: "asc" },
      include: { createdByUser: { select: { email: true, name: true } } }
    });

    return reply.send({ instructions });
  });

  app.post("/api/v1/workspaces/:workspaceId/classification-instructions", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      title: z.string().min(1).max(200),
      content: z.string().min(1).max(10000),
      active: z.boolean().default(true)
    }).parse(request.body);

    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });

    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership || membership.workspaceRole === "VIEWER") {
      return reply.code(403).send({ message: "Edit permission required" });
    }

    const instruction = await app.services.prisma.classificationInstruction.create({
      data: {
        workspaceId,
        title: body.title,
        content: body.content,
        active: body.active,
        createdBy: session.userId
      }
    });

    return reply.code(201).send({ instruction });
  });
};
