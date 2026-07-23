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
  { systemKey: "BID_OPPORTUNITY", displayLabel: "Bid Opportunity", description: "Invitation or opportunity to bid", displayGroup: "BIDS_ESTIMATING", displayOrder: 1 },
  { systemKey: "BID_UPDATE", displayLabel: "Bid Update / Addendum", description: "Update or addendum to existing bid", displayGroup: "BIDS_ESTIMATING", displayOrder: 2 },
  { systemKey: "ESTIMATE_QUOTE", displayLabel: "Estimate / Quote", description: "Estimate or quote for work or materials", displayGroup: "BIDS_ESTIMATING", displayOrder: 3 },
  { systemKey: "PURCHASE_ORDER_CONTRACT", displayLabel: "Purchase Order / Contract", description: "Purchase order or contract", displayGroup: "PURCHASING", displayOrder: 1 },
  { systemKey: "PROJECT_COORDINATION", displayLabel: "Project Coordination", description: "General project coordination", displayGroup: "PROJECTS", displayOrder: 1 },
  { systemKey: "RFI_CLARIFICATION", displayLabel: "RFI / Clarification", description: "Request for information", displayGroup: "PROJECTS", displayOrder: 2 },
  { systemKey: "SUBMITTAL_SHOP_DRAWING", displayLabel: "Submittal / Shop Drawing", description: "Submittal or shop drawing", displayGroup: "PROJECTS", displayOrder: 3 },
  { systemKey: "CHANGE_ORDER_SCOPE", displayLabel: "Change Order / Scope Change", description: "Change order or scope modification", displayGroup: "PROJECTS", displayOrder: 4 },
  { systemKey: "FABRICATION_PRODUCTION", displayLabel: "Fabrication / Production", description: "Fabrication or production", displayGroup: "PROJECTS", displayOrder: 5 },
  { systemKey: "MATERIAL_PURCHASING", displayLabel: "Material / Vendor / Purchasing", description: "Material orders and vendor communication", displayGroup: "PURCHASING", displayOrder: 2 },
  { systemKey: "DELIVERY_LOGISTICS", displayLabel: "Delivery / Logistics", description: "Delivery and logistics", displayGroup: "PROJECTS", displayOrder: 6 },
  { systemKey: "FIELD_INSTALLATION", displayLabel: "Field Issue / Installation", description: "Field issues and installation", displayGroup: "PROJECTS", displayOrder: 7 },
  { systemKey: "INVOICE_PAYMENT", displayLabel: "Invoice / Payment", description: "Invoice or payment", displayGroup: "ACCOUNTING", displayOrder: 1 },
  { systemKey: "COMPLIANCE_LEGAL", displayLabel: "Compliance / Safety / Legal", description: "Compliance or legal", displayGroup: "INTERNAL", displayOrder: 1 },
  { systemKey: "INTERNAL_ADMIN", displayLabel: "Internal Administration", description: "Internal admin", displayGroup: "INTERNAL", displayOrder: 2 },
  { systemKey: "OTHER_BUSINESS", displayLabel: "Other Business", description: "Other business", displayGroup: "OTHER", displayOrder: 1 }
];

const candidatesInputSchema = z.object({
  mailboxEmail: z.string().email(),
  senderName: z.string().max(200).nullable().optional(),
  senderEmail: z.string().email().or(z.literal("")).default(""),
  senderDomain: z.string().max(200).default("").transform(val => val || ""),
  subject: z.string().max(500).nullable().optional().transform(val => val ?? ""),
  cleanBody: z.string().max(10000).nullable().optional().transform(val => val ?? ""),
  attachmentNames: z.array(z.string()).max(50).nullable().optional().transform(val => val ?? [])
});

const reclassifySchema = z.object({
  mailboxCategory: z.enum(["BUSINESS", "PERSONAL"]),
  businessType: z.string().max(50).nullable().optional(),
  customerId: z.string().nullable().optional(),
  vendorId: z.string().nullable().optional(),
  jobId: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  containsActionRequest: z.boolean().optional(),
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
    const normalizedSenderEmail = body.senderEmail ? normalizeEmail(body.senderEmail) : "";
    const senderDomain = (body.senderDomain || extractDomain(body.senderEmail) || "").toLowerCase();

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
      select: { systemKey: true, displayLabel: true, displayGroup: true, displayOrder: true },
      orderBy: [{ displayGroup: "asc" }, { displayOrder: "asc" }]
      }),
      app.services.prisma.classificationInstruction.findMany({
        where: { workspaceId, active: true },
        select: { title: true, content: true },
        orderBy: { sortOrder: "asc" }
      })
    ]);

    const [senderEvidence, domainEvidence] = await Promise.all([
      normalizedSenderEmail ? app.services.prisma.senderEvidence.findFirst({
        where: { workspaceId, normalizedEmail: normalizedSenderEmail },
        select: { status: true, confidence: true, businessEvidenceCount: true, personalEvidenceCount: true }
      }) : null,
      senderDomain ? app.services.prisma.domainEvidence.findFirst({
        where: { workspaceId, domain: senderDomain },
        select: { status: true, confidence: true, isPublicDomain: true }
      }) : null
    ]);

    let knownSender = false;
    if (senderEvidence && senderEvidence.status !== "OBSERVED") knownSender = true;
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

    const approvedFolders = await app.services.prisma.discoveredFolder.findMany({
      where: { workspaceId, status: "APPROVED", matchedJobId: { not: null } },
      select: { normalizedFolderName: true, matchedJobId: true, rawFolderName: true, detectedJobNumber: true }
    });

    const jobCandidates: Array<{ id: string; name: string; score: number; matchedOn: string[]; evidence: string[] }> = [];
    const searchText = `${body.subject ?? ""} ${body.cleanBody ?? ""} ${body.attachmentNames.join(" ")}`.toLowerCase();

    for (const folder of approvedFolders) {
      if (!folder.matchedJobId) continue;
      const job = jobs.find(j => j.id === folder.matchedJobId);
      if (!job) continue;

      if (folder.detectedJobNumber && searchText.includes(folder.detectedJobNumber.toLowerCase())) {
        jobCandidates.push({ id: job.id, name: job.name, score: 0.95, matchedOn: ["folderJobNumber"], evidence: [`folder job# ${folder.detectedJobNumber}`] });
      } else if (searchText.includes(folder.normalizedFolderName)) {
        jobCandidates.push({ id: job.id, name: job.name, score: 0.85, matchedOn: ["folderName"], evidence: [`folder "${folder.rawFolderName}"`] });
      }
    }

    for (const job of jobs) {
      if (jobCandidates.some(c => c.id === job.id)) continue;
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
      senderEvidence: senderEvidence ? {
        status: senderEvidence.status,
        confidence: Number(senderEvidence.confidence.toString()),
        businessCount: senderEvidence.businessEvidenceCount,
        personalCount: senderEvidence.personalEvidenceCount
      } : null,
      domainEvidence: domainEvidence ? {
        status: domainEvidence.status,
        confidence: Number(domainEvidence.confidence.toString()),
        isPublicDomain: domainEvidence.isPublicDomain
      } : null,
      activeBusinessTypes: businessTypes.map(bt => ({ key: bt.systemKey, label: bt.displayLabel, group: bt.displayGroup, order: bt.displayOrder })),
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
      select: { id: true, mailboxCategory: true, senderEmail: true, senderName: true, threadId: true,
        classifications: { select: { id: true, mailboxCategory: true, businessTypeKey: true, customerId: true, vendorId: true, jobId: true, priority: true }, take: 1, orderBy: { createdAt: "desc" } }
      }
    });

    if (!message) return reply.code(404).send({ message: "Message not found" });

    const previousCategory = message.mailboxCategory;
    const classification = message.classifications[0];

    await app.services.prisma.emailMessage.update({
      where: { id: message.id },
      data: {
        mailboxCategory: body.mailboxCategory,
        isSpam: false,
        isTrashed: false,
        previousCategory: previousCategory,
        ...(body.priority ? { priority: body.priority } : {})
      }
    });

    if (classification) {
      await app.services.prisma.classificationCorrection.create({
        data: {
          workspaceId: params.workspaceId,
          classificationId: classification.id,
          originalMailboxCategory: previousCategory,
          correctedMailboxCategory: body.mailboxCategory,
          originalBusinessType: classification.businessTypeKey ?? null,
          correctedBusinessType: body.businessType ?? null,
          originalCustomerId: classification.customerId ?? null,
          correctedCustomerId: body.customerId ?? null,
          originalVendorId: classification.vendorId ?? null,
          correctedVendorId: body.vendorId ?? null,
          originalJobId: classification.jobId ?? null,
          correctedJobId: body.jobId ?? null,
          originalPriority: classification.priority ?? null,
          correctedPriority: body.priority ?? null,
          reason: body.reason ?? null,
          reviewedByUserId: session.userId
        }
      });

      const classUpdate: Record<string, unknown> = {
        mailboxCategory: body.mailboxCategory,
        reviewStatus: "APPROVED",
        reviewedByUserId: session.userId,
        reviewedAt: new Date()
      };
      if (body.businessType !== undefined) classUpdate.businessTypeKey = body.businessType;
      if (body.customerId !== undefined) classUpdate.customerId = body.customerId;
      if (body.vendorId !== undefined) classUpdate.vendorId = body.vendorId;
      if (body.jobId !== undefined) classUpdate.jobId = body.jobId;
      if (body.priority) classUpdate.priority = body.priority;
      if (body.containsActionRequest !== undefined) classUpdate.containsActionRequest = body.containsActionRequest;
      if (body.mailboxCategory === "PERSONAL") {
        classUpdate.businessTypeKey = null;
        classUpdate.customerId = null;
        classUpdate.vendorId = null;
        classUpdate.jobId = null;
      }

      await app.services.prisma.classification.update({
        where: { id: classification.id },
        data: classUpdate as import("@prisma/client").Prisma.ClassificationUncheckedUpdateInput
      });
    }

    const { recordSenderEvidence } = await import("./sender-evidence.route.js");
    await recordSenderEvidence(
      app.services.prisma,
      params.workspaceId,
      message.senderEmail,
      message.senderName,
      body.mailboxCategory,
      true
    ).catch(() => {});

    if (previousCategory === "BUSINESS" && body.mailboxCategory === "PERSONAL") {
      await app.services.prisma.task.updateMany({
        where: { workspaceId: params.workspaceId, sourceMessageId: message.id, status: "OPEN" },
        data: { dismissedAt: new Date(), dismissedBy: session.userId, dismissalReason: `Reclassified to PERSONAL` }
      });
    }

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "EMAIL_MESSAGE",
      entityId: message.id,
      action: "email.reclassified",
      metadata: {
        from: previousCategory,
        to: body.mailboxCategory,
        businessType: body.businessType ?? null,
        customerId: body.customerId ?? null,
        vendorId: body.vendorId ?? null,
        jobId: body.jobId ?? null,
        reason: body.reason ?? null
      },
      request
    });

    return reply.send({
      status: "reclassified",
      from: previousCategory,
      to: body.mailboxCategory,
      correctionCreated: !!classification,
      senderEvidenceUpdated: true
    });
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

  // --- Correction history ---
  app.get("/api/v1/workspaces/:workspaceId/messages/:messageId/corrections", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), messageId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const message = await app.services.prisma.emailMessage.findFirst({
      where: { workspaceId: params.workspaceId, OR: [{ id: params.messageId }, { gmailMessageId: params.messageId }] },
      select: { id: true, classifications: { select: { id: true }, take: 10, orderBy: { createdAt: "desc" } } }
    });

    if (!message) return reply.code(404).send({ message: "Message not found" });

    const classificationIds = message.classifications.map(c => c.id);

    const corrections = await app.services.prisma.classificationCorrection.findMany({
      where: { workspaceId: params.workspaceId, classificationId: { in: classificationIds } },
      orderBy: { reviewedAt: "desc" },
      include: {
        reviewedByUser: { select: { email: true, name: true } }
      }
    });

    return reply.send({ corrections });
  });
};
