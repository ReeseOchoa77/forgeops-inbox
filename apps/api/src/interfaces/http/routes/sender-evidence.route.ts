import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { normalizeEmail, extractDomain } from "@forgeops/shared";

import { getSessionFromRequest } from "../authentication.js";
import { requireWorkspaceMembership } from "../../../application/services/workspace-access.js";

const PUBLIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "yahoo.co.uk", "aol.com", "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "zoho.com", "yandex.com", "mail.com",
  "gmx.com", "gmx.net", "msn.com", "comcast.net", "att.net", "sbcglobal.net",
  "verizon.net", "cox.net", "charter.net", "earthlink.net"
]);

const LIKELY_BUSINESS_THRESHOLD = 5;

function computeConfidence(biz: number, personal: number, manualBiz: number, manualPersonal: number): number {
  if (manualBiz > 0 && manualPersonal === 0) return 1.0;
  if (manualPersonal > 0 && manualBiz === 0) return 1.0;
  const total = biz + personal;
  if (total === 0) return 0;
  return Math.max(biz, personal) / total;
}

function deriveStatus(
  biz: number, personal: number, manualBiz: number, manualPersonal: number, currentStatus: string
): string {
  if (currentStatus === "BLOCKED") return "BLOCKED";
  if (manualPersonal > 0) return "CONFIRMED_PERSONAL";
  if (manualBiz > 0) return "CONFIRMED_BUSINESS";
  if (biz >= LIKELY_BUSINESS_THRESHOLD && personal === 0) return "LIKELY_BUSINESS";
  if (biz >= LIKELY_BUSINESS_THRESHOLD && biz > personal * 3) return "LIKELY_BUSINESS";
  return "OBSERVED";
}

export async function recordSenderEvidence(
  prisma: import("@prisma/client").PrismaClient,
  workspaceId: string,
  senderEmail: string,
  displayName: string | null,
  classification: "BUSINESS" | "PERSONAL",
  isManual: boolean
): Promise<void> {
  const normalized = normalizeEmail(senderEmail);
  const domain = extractDomain(senderEmail) ?? "";
  const isPublic = PUBLIC_DOMAINS.has(domain);

  const existing = await prisma.senderEvidence.findFirst({
    where: { workspaceId, normalizedEmail: normalized }
  });

  const bizInc = classification === "BUSINESS" ? 1 : 0;
  const persInc = classification === "PERSONAL" ? 1 : 0;
  const manBizInc = isManual && classification === "BUSINESS" ? 1 : 0;
  const manPersInc = isManual && classification === "PERSONAL" ? 1 : 0;

  if (existing) {
    const newBiz = existing.businessEvidenceCount + bizInc;
    const newPers = existing.personalEvidenceCount + persInc;
    const newManBiz = existing.manualBusinessConfirmations + manBizInc;
    const newManPers = existing.manualPersonalConfirmations + manPersInc;
    const status = deriveStatus(newBiz, newPers, newManBiz, newManPers, existing.status);
    const confidence = computeConfidence(newBiz, newPers, newManBiz, newManPers);

    await prisma.senderEvidence.update({
      where: { id: existing.id },
      data: {
        businessEvidenceCount: newBiz,
        personalEvidenceCount: newPers,
        manualBusinessConfirmations: newManBiz,
        manualPersonalConfirmations: newManPers,
        ...(classification === "BUSINESS" ? { lastBusinessAt: new Date() } : { lastPersonalAt: new Date() }),
        displayName: displayName ?? existing.displayName,
        status: status as "OBSERVED" | "LIKELY_BUSINESS" | "CONFIRMED_BUSINESS" | "CONFIRMED_PERSONAL" | "BLOCKED",
        confidence: new Prisma.Decimal(confidence.toFixed(4))
      }
    });
  } else {
    const status = deriveStatus(bizInc, persInc, manBizInc, manPersInc, "OBSERVED");
    await prisma.senderEvidence.create({
      data: {
        workspaceId,
        senderEmail,
        normalizedEmail: normalized,
        senderDomain: domain,
        displayName,
        businessEvidenceCount: bizInc,
        personalEvidenceCount: persInc,
        manualBusinessConfirmations: manBizInc,
        manualPersonalConfirmations: manPersInc,
        ...(classification === "BUSINESS" ? { lastBusinessAt: new Date() } : { lastPersonalAt: new Date() }),
        status: status as "OBSERVED" | "LIKELY_BUSINESS" | "CONFIRMED_BUSINESS" | "CONFIRMED_PERSONAL" | "BLOCKED",
        confidence: new Prisma.Decimal(computeConfidence(bizInc, persInc, manBizInc, manPersInc).toFixed(4))
      }
    });
  }

  if (!isPublic) {
    const domainExisting = await prisma.domainEvidence.findFirst({
      where: { workspaceId, domain }
    });

    if (domainExisting) {
      const newBiz = domainExisting.businessEvidenceCount + bizInc;
      const newPers = domainExisting.personalEvidenceCount + persInc;
      const newManBiz = domainExisting.manualBusinessConfirmations + manBizInc;
      const newManPers = domainExisting.manualPersonalConfirmations + manPersInc;
      const status = deriveStatus(newBiz, newPers, newManBiz, newManPers, domainExisting.status);

      await prisma.domainEvidence.update({
        where: { id: domainExisting.id },
        data: {
          businessEvidenceCount: newBiz,
          personalEvidenceCount: newPers,
          manualBusinessConfirmations: newManBiz,
          manualPersonalConfirmations: newManPers,
          status: status as "OBSERVED" | "LIKELY_BUSINESS" | "CONFIRMED_BUSINESS" | "CONFIRMED_PERSONAL" | "BLOCKED",
          confidence: new Prisma.Decimal(computeConfidence(newBiz, newPers, newManBiz, newManPers).toFixed(4))
        }
      });
    } else {
      await prisma.domainEvidence.create({
        data: {
          workspaceId,
          domain,
          isPublicDomain: false,
          businessEvidenceCount: bizInc,
          personalEvidenceCount: persInc,
          manualBusinessConfirmations: manBizInc,
          manualPersonalConfirmations: manPersInc,
          status: "OBSERVED",
          confidence: new Prisma.Decimal(computeConfidence(bizInc, persInc, manBizInc, manPersInc).toFixed(4))
        }
      });
    }
  }
}

export const registerSenderEvidenceRoutes = async (app: FastifyInstance): Promise<void> => {

  app.get("/api/v1/workspaces/:workspaceId/sender-evidence", async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, workspaceId);
    if (!membership) return reply.code(403).send({ message: "Workspace access denied" });

    const query = z.object({ status: z.enum(["OBSERVED", "LIKELY_BUSINESS", "CONFIRMED_BUSINESS", "CONFIRMED_PERSONAL", "BLOCKED"]).optional() }).parse(request.query);

    const [senders, domains] = await Promise.all([
      app.services.prisma.senderEvidence.findMany({
        where: { workspaceId, ...(query.status ? { status: query.status } : {}) },
        orderBy: { updatedAt: "desc" },
        take: 200
      }),
      app.services.prisma.domainEvidence.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" },
        take: 100
      })
    ]);

    return reply.send({ senders, domains });
  });

  app.patch("/api/v1/workspaces/:workspaceId/sender-evidence/:evidenceId/confirm", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), evidenceId: z.string().min(1) }).parse(request.params);
    const body = z.object({ classification: z.enum(["BUSINESS", "PERSONAL"]) }).parse(request.body);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership || membership.workspaceRole === "VIEWER") return reply.code(403).send({ message: "Edit permission required" });

    const evidence = await app.services.prisma.senderEvidence.findFirst({
      where: { id: params.evidenceId, workspaceId: params.workspaceId }
    });
    if (!evidence) return reply.code(404).send({ message: "Sender evidence not found" });

    await recordSenderEvidence(app.services.prisma, params.workspaceId, evidence.senderEmail, evidence.displayName, body.classification, true);

    await app.services.auditEventLogger.log({
      workspaceId: params.workspaceId,
      actorUserId: session.userId,
      entityType: "SENDER_EVIDENCE",
      entityId: params.evidenceId,
      action: `sender.manually_confirmed_${body.classification.toLowerCase()}`,
      metadata: { email: evidence.senderEmail },
      request
    });

    return reply.send({ status: "confirmed", classification: body.classification });
  });

  app.patch("/api/v1/workspaces/:workspaceId/sender-evidence/:evidenceId/reset", async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1), evidenceId: z.string().min(1) }).parse(request.params);
    const session = await getSessionFromRequest(request);
    if (!session) return reply.code(401).send({ message: "Authentication required" });
    const membership = await requireWorkspaceMembership(app.services.prisma, session.userId, params.workspaceId);
    if (!membership || membership.workspaceRole === "VIEWER") return reply.code(403).send({ message: "Edit permission required" });

    await app.services.prisma.senderEvidence.update({
      where: { id: params.evidenceId },
      data: {
        businessEvidenceCount: 0,
        personalEvidenceCount: 0,
        manualBusinessConfirmations: 0,
        manualPersonalConfirmations: 0,
        status: "OBSERVED",
        confidence: new Prisma.Decimal("0")
      }
    });

    return reply.send({ status: "reset" });
  });
};
