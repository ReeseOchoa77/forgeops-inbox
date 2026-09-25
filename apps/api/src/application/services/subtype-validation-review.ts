import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildBusinessSubtypeUserPrompt,
  businessSubtypeSystemPrompt,
  BUSINESS_SUBTYPE_KEYS,
  buildSubtypeEvidencePacket,
  SUBTYPE_CLASSIFIER_VERSION,
  type BusinessSubtypeEmailInput,
  type BusinessSubtypeResult,
} from "@forgeops/ai";
import {
  blindExpectedSubtype,
  encodeSubtypeVerifyReason,
  extractDomain,
  isSubtypeAmbiguityReason,
  parseSubtypeVerifyReason,
  readSubtypeDecision,
  resolveConfirmedWorkspaceJob,
  selectSubtypeValidationSample,
  SUBTYPE_ERROR_CATEGORIES,
  SUBTYPE_VALIDATION_TARGET_MAX,
  SUBTYPE_VERIFY_PREFIX,
  validationProgress,
  type SubtypeAmbiguityReason,
  type SubtypeErrorCategory,
  type SubtypeSampleCandidate,
  type SubtypeSampleSelection,
  type SubtypeVerifyAction,
} from "@forgeops/shared";

const SAMPLE_PER_BAND = 12;

export function isBusinessSubtypeKey(value: string): boolean {
  return (BUSINESS_SUBTYPE_KEYS as readonly string[]).includes(value);
}

export function isSubtypeErrorCategory(value: string): value is SubtypeErrorCategory {
  return (SUBTYPE_ERROR_CATEGORIES as readonly string[]).includes(value);
}

function attachmentNamesFromMetadata(metadata: unknown): string[] {
  if (!Array.isArray(metadata)) return [];
  const names: string[] = [];
  for (const item of metadata) {
    if (!item || typeof item !== "object") continue;
    const name =
      (item as { name?: unknown; filename?: unknown }).name ??
      (item as { filename?: unknown }).filename;
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }
  return names;
}

export interface SubtypeVerificationResult {
  correctionId: string;
  action: SubtypeVerifyAction;
  humanLabel: string | null;
  ambiguous: boolean;
  ambiguityReason: SubtypeAmbiguityReason | null;
  productionSubtype: string | null;
  matchesProduction: boolean | null;
  confidence: number | null;
  competingType: string | null;
  evidence: string[];
  classifierVersion: string | null;
}

export async function recordSubtypeVerification(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    classificationId: string;
    userId: string;
    action: SubtypeVerifyAction;
    businessType?: string | undefined;
    ambiguityReason?: SubtypeAmbiguityReason | undefined;
  }
): Promise<SubtypeVerificationResult> {
  const classification = await prisma.classification.findFirst({
    where: { workspaceId: input.workspaceId, id: input.classificationId },
    select: {
      id: true,
      mailboxCategory: true,
      businessTypeKey: true,
      businessTypeConfidence: true,
      classificationEvidence: true,
      customerId: true,
      vendorId: true,
      jobId: true,
      priority: true,
    },
  });
  if (!classification) {
    throw Object.assign(new Error("Classification not found"), { statusCode: 404 });
  }
  if (classification.mailboxCategory !== "BUSINESS") {
    throw Object.assign(new Error("Subtype verification is only for BUSINESS email"), {
      statusCode: 400,
    });
  }

  let correctedBusinessType: string | null = null;
  let reason = encodeSubtypeVerifyReason(input.action);
  let ambiguityReason: SubtypeAmbiguityReason | null = null;

  if (input.action === "confirm") {
    if (!classification.businessTypeKey) {
      throw Object.assign(new Error("This classification has no subtype to confirm"), {
        statusCode: 400,
      });
    }
    correctedBusinessType = classification.businessTypeKey;
  } else if (input.action === "change") {
    const next = input.businessType?.trim() ?? "";
    if (!isBusinessSubtypeKey(next)) {
      throw Object.assign(new Error("Choose one of the existing subtypes"), { statusCode: 400 });
    }
    if (next === classification.businessTypeKey) {
      throw Object.assign(new Error("That subtype is already stored. Use Confirm."), {
        statusCode: 400,
      });
    }
    correctedBusinessType = next;
  } else if (input.action === "blind") {
    const next = input.businessType?.trim() ?? "";
    if (!isBusinessSubtypeKey(next)) {
      throw Object.assign(new Error("Choose one of the existing subtypes"), { statusCode: 400 });
    }
    correctedBusinessType = next;
    reason = encodeSubtypeVerifyReason("blind");
  } else {
    const marker = input.ambiguityReason;
    if (!marker || !isSubtypeAmbiguityReason(marker)) {
      throw Object.assign(new Error("Choose why this email is ambiguous"), { statusCode: 400 });
    }
    ambiguityReason = marker;
    correctedBusinessType = null;
    reason = encodeSubtypeVerifyReason("ambiguous", marker);
  }

  const correction = await prisma.classificationCorrection.create({
    data: {
      workspaceId: input.workspaceId,
      classificationId: classification.id,
      originalMailboxCategory: classification.mailboxCategory,
      correctedMailboxCategory: classification.mailboxCategory,
      originalBusinessType: classification.businessTypeKey,
      correctedBusinessType,
      originalCustomerId: classification.customerId,
      correctedCustomerId: classification.customerId,
      originalVendorId: classification.vendorId,
      correctedVendorId: classification.vendorId,
      originalJobId: classification.jobId,
      correctedJobId: classification.jobId,
      originalPriority: classification.priority,
      correctedPriority: classification.priority,
      reason,
      reviewedByUserId: input.userId,
    },
    select: { id: true },
  });

  const decision = readSubtypeDecision(classification.classificationEvidence);
  const confidence = classification.businessTypeConfidence
    ? Number(classification.businessTypeConfidence.toString())
    : decision?.confidence ?? null;

  return {
    correctionId: correction.id,
    action: input.action,
    humanLabel: correctedBusinessType,
    ambiguous: input.action === "ambiguous",
    ambiguityReason,
    productionSubtype: classification.businessTypeKey,
    matchesProduction:
      input.action === "ambiguous" || correctedBusinessType == null
        ? null
        : correctedBusinessType === classification.businessTypeKey,
    confidence,
    competingType: decision?.competingType ?? null,
    evidence: decision?.evidence ?? [],
    classifierVersion: decision?.classifierVersion ?? null,
  };
}

export async function setSubtypeErrorCategory(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    classificationId: string;
    category: SubtypeErrorCategory;
  }
): Promise<{ correctionId: string; category: SubtypeErrorCategory }> {
  const correction = await prisma.classificationCorrection.findFirst({
    where: {
      workspaceId: input.workspaceId,
      classificationId: input.classificationId,
      reason: { startsWith: SUBTYPE_VERIFY_PREFIX },
    },
    orderBy: { reviewedAt: "desc" },
    select: { id: true, reason: true },
  });
  if (!correction) {
    throw Object.assign(new Error("No subtype verification exists for this classification"), {
      statusCode: 404,
    });
  }
  const parsed = parseSubtypeVerifyReason(correction.reason);
  if (!parsed) {
    throw Object.assign(new Error("Subtype verification reason is unreadable"), { statusCode: 400 });
  }
  if (parsed.action === "ambiguous") {
    throw Object.assign(new Error("Ambiguous labels keep their ambiguity reason"), { statusCode: 400 });
  }
  await prisma.classificationCorrection.update({
    where: { id: correction.id },
    data: { reason: encodeSubtypeVerifyReason(parsed.action, input.category) },
  });
  return { correctionId: correction.id, category: input.category };
}

type SampleRow = {
  classification_id: string;
  message_id: string;
  inbox_connection_id: string;
  subtype: string;
  confidence: number | null;
  competing_type: string | null;
  body_chars: number;
  has_attachments: boolean;
  has_thread_context: boolean;
  already_verified: boolean;
  subject: string | null;
  sender_email: string;
  sender_name: string | null;
  received_at: Date | null;
};

export async function loadSubtypeValidationSample(
  prisma: PrismaClient,
  input: { workspaceId: string; inboxConnectionId: string | null; target: number }
): Promise<
  SubtypeSampleSelection & {
    items: Array<{
      classificationId: string;
      messageId: string;
      inboxConnectionId: string;
      subject: string | null;
      senderEmail: string;
      senderName: string | null;
      date: string | null;
    }>;
    progress: { reviewed: number; labeled: number; ambiguous: number; target: number; remaining: number };
  }
> {
  const connectionFilter = input.inboxConnectionId
    ? Prisma.sql`AND m."inboxConnectionId" = ${input.inboxConnectionId}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<SampleRow[]>(Prisma.sql`
    WITH base AS (
      SELECT
        c.id AS classification_id,
        c."messageId" AS message_id,
        m."inboxConnectionId" AS inbox_connection_id,
        c."businessTypeKey" AS subtype,
        c."businessTypeConfidence"::float8 AS confidence,
        c."classificationEvidence"->'subtypeDecision'->>'competingType' AS competing_type,
        COALESCE(length(n."cleanTextBody"), length(m."bodyText"), 0)::int AS body_chars,
        m."hasAttachments" AS has_attachments,
        EXISTS (
          SELECT 1 FROM "EmailMessage" other
          WHERE other."workspaceId" = m."workspaceId"
            AND other."threadId" = m."threadId"
            AND other.id <> m.id
        ) AS has_thread_context,
        EXISTS (
          SELECT 1 FROM "ClassificationCorrection" k
          WHERE k."classificationId" = c.id
            AND k.reason LIKE 'subtype-verify:%'
        ) AS already_verified,
        m.subject AS subject,
        m."senderEmail" AS sender_email,
        m."senderName" AS sender_name,
        m."receivedAt" AS received_at,
        CASE
          WHEN c."businessTypeConfidence" IS NULL THEN 'UNKNOWN'
          WHEN c."businessTypeConfidence" >= 0.8 THEN 'HIGH'
          WHEN c."businessTypeConfidence" >= 0.5 THEN 'MEDIUM'
          ELSE 'LOW'
        END AS band
      FROM "Classification" c
      JOIN "EmailMessage" m
        ON m.id = c."messageId" AND m."workspaceId" = c."workspaceId"
      LEFT JOIN "NormalizedEmail" n
        ON n."messageId" = m.id AND n."workspaceId" = m."workspaceId"
      WHERE c."workspaceId" = ${input.workspaceId}
        AND c."mailboxCategory" = 'BUSINESS'
        AND c."businessTypeKey" IS NOT NULL
        AND c."messageId" IS NOT NULL
        ${connectionFilter}
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY subtype, band ORDER BY random()) AS rn
      FROM base
    )
    SELECT
      classification_id, message_id, inbox_connection_id, subtype, confidence,
      competing_type, body_chars, has_attachments, has_thread_context, already_verified,
      subject, sender_email, sender_name, received_at
    FROM ranked
    WHERE rn <= ${SAMPLE_PER_BAND}
  `);

  const candidates: SubtypeSampleCandidate[] = rows.map((row) => ({
    classificationId: row.classification_id,
    subtype: row.subtype,
    confidence: row.confidence,
    competingType: row.competing_type,
    bodyChars: row.body_chars,
    hasAttachments: row.has_attachments,
    hasThreadContext: row.has_thread_context,
    alreadyVerified: row.already_verified,
  }));
  const selection = selectSubtypeValidationSample(candidates, { target: input.target });
  const byId = new Map(rows.map((row) => [row.classification_id, row]));
  const items = selection.classificationIds.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [{
      classificationId: row.classification_id,
      messageId: row.message_id,
      inboxConnectionId: row.inbox_connection_id,
      subject: row.subject,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      date: row.received_at ? new Date(row.received_at).toISOString() : null,
    }];
  });
  const progressRows = await prisma.$queryRaw<Array<{ labeled: number; ambiguous: number }>>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE reason LIKE 'subtype-verify:blind%')::int AS labeled,
      COUNT(*) FILTER (WHERE reason LIKE 'subtype-verify:ambiguous%')::int AS ambiguous
    FROM (
      SELECT DISTINCT ON ("classificationId") reason
      FROM "ClassificationCorrection"
      WHERE "workspaceId" = ${input.workspaceId}
        AND reason LIKE 'subtype-verify:%'
      ORDER BY "classificationId", "reviewedAt" DESC
    ) latest
  `);
  const progress = validationProgress({
    labeled: progressRows[0]?.labeled ?? 0,
    ambiguous: progressRows[0]?.ambiguous ?? 0,
    target: selection.target,
    remaining: items.length,
  });
  return { ...selection, items, progress };
}

export interface SubtypeValidationCounts {
  subtypeChanges: Array<{ original: string | null; corrected: string | null; count: number }>;
  sameSubtypeCorrections: number;
  reviewStatus: Array<{ reviewStatus: string; count: number }>;
  productionSubtypes: Array<{ subtype: string; count: number }>;
  verifications: Array<{
    action: SubtypeVerifyAction;
    category: string | null;
    expected: string | null;
    count: number;
    source: "BLIND_VALIDATION" | "ANCHORED_VALIDATION";
  }>;
}

export async function loadSubtypeValidationCounts(
  prisma: PrismaClient,
  workspaceId: string
): Promise<SubtypeValidationCounts> {
  const [changes, sameRows, reviewRows, productionRows, verifyRows] = await Promise.all([
    prisma.$queryRaw<Array<{ original: string | null; corrected: string | null; n: number }>>(Prisma.sql`
      SELECT "originalBusinessType" AS original,
             "correctedBusinessType" AS corrected,
             COUNT(*)::int AS n
      FROM "ClassificationCorrection"
      WHERE "workspaceId" = ${workspaceId}
        AND "correctedBusinessType" IS NOT NULL
        AND "originalBusinessType" IS DISTINCT FROM "correctedBusinessType"
        AND COALESCE(reason, '') NOT LIKE 'subtype-verify:%'
      GROUP BY 1, 2
      ORDER BY n DESC
    `),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM "ClassificationCorrection"
      WHERE "workspaceId" = ${workspaceId}
        AND "originalBusinessType" IS NOT NULL
        AND "originalBusinessType" = "correctedBusinessType"
        AND COALESCE(reason, '') NOT LIKE 'subtype-verify:%'
    `),
    prisma.$queryRaw<Array<{ review_status: string; n: number }>>(Prisma.sql`
      SELECT "reviewStatus"::text AS review_status, COUNT(*)::int AS n
      FROM "Classification"
      WHERE "workspaceId" = ${workspaceId}
      GROUP BY 1
    `),
    prisma.$queryRaw<Array<{ subtype: string; n: number }>>(Prisma.sql`
      SELECT "businessTypeKey" AS subtype, COUNT(*)::int AS n
      FROM "Classification"
      WHERE "workspaceId" = ${workspaceId}
        AND "mailboxCategory" = 'BUSINESS'
        AND "businessTypeKey" IS NOT NULL
      GROUP BY 1
      ORDER BY n DESC
    `),
    prisma.$queryRaw<Array<{ reason: string; expected: string | null; n: number }>>(Prisma.sql`
      SELECT reason, "correctedBusinessType" AS expected, COUNT(*)::int AS n
      FROM "ClassificationCorrection"
      WHERE "workspaceId" = ${workspaceId}
        AND reason LIKE 'subtype-verify:%'
      GROUP BY 1, 2
    `),
  ]);

  return {
    subtypeChanges: changes.map((row) => ({
      original: row.original,
      corrected: row.corrected,
      count: row.n,
    })),
    sameSubtypeCorrections: sameRows[0]?.n ?? 0,
    reviewStatus: reviewRows.map((row) => ({ reviewStatus: row.review_status, count: row.n })),
    productionSubtypes: productionRows.map((row) => ({ subtype: row.subtype, count: row.n })),
    verifications: verifyRows.flatMap((row) => {
      const parsed = parseSubtypeVerifyReason(row.reason);
      if (!parsed) return [];
      return [{
        action: parsed.action,
        category: parsed.category,
        expected: row.expected,
        count: row.n,
        source: parsed.source,
      }];
    }),
  };
}

export async function loadVerifiedSubtypeLabels(
  prisma: PrismaClient,
  workspaceId: string
): Promise<Array<{ classificationId: string; expected: string; action: "blind" }>> {
  const rows = await prisma.$queryRaw<Array<{ classification_id: string; expected: string | null; reason: string }>>(Prisma.sql`
    SELECT DISTINCT ON (k."classificationId")
      k."classificationId" AS classification_id,
      k."correctedBusinessType" AS expected,
      k.reason AS reason
    FROM "ClassificationCorrection" k
    WHERE k."workspaceId" = ${workspaceId}
      AND k.reason LIKE 'subtype-verify:%'
    ORDER BY k."classificationId", k."reviewedAt" DESC
    LIMIT ${SUBTYPE_VALIDATION_TARGET_MAX}
  `);
  return rows.flatMap((row) => {
    const expected = blindExpectedSubtype(row.reason, row.expected);
    if (!expected) return [];
    return [{ classificationId: row.classification_id, expected, action: "blind" as const }];
  });
}

export async function loadBlindSubtypePacket(
  prisma: PrismaClient,
  input: { workspaceId: string; classificationId: string }
): Promise<{
  classificationId: string;
  subject: string;
  currentMessage: string;
  thread: Array<{ senderEmail: string; subject: string; snippet: string }>;
  attachmentNames: string[];
  sender: { name: string; email: string; domain: string };
  job: { name: string; jobNumber: string } | null;
}> {
  const classification = await prisma.classification.findFirst({
    where: { workspaceId: input.workspaceId, id: input.classificationId },
    select: {
      id: true,
      message: {
        select: {
          id: true,
          threadId: true,
          subject: true,
          senderName: true,
          senderEmail: true,
          bodyText: true,
          attachmentMetadata: true,
          job: { select: { id: true, workspaceId: true, jobNumber: true, name: true } },
          normalizedEmail: {
            select: { normalizedSubject: true, cleanTextBody: true, senderDomain: true, subject: true },
          },
        },
      },
    },
  });
  const message = classification?.message;
  if (!classification || !message) {
    throw Object.assign(new Error("Classification not found"), { statusCode: 404 });
  }
  const prior = message.threadId
    ? await prisma.emailMessage.findMany({
        where: {
          workspaceId: input.workspaceId,
          threadId: message.threadId,
          id: { not: message.id },
        },
        orderBy: { receivedAt: "desc" },
        take: 3,
        select: { senderEmail: true, subject: true, snippet: true },
      })
    : [];
  const confirmed = resolveConfirmedWorkspaceJob({
    workspaceId: input.workspaceId,
    job: message.job,
  });
  const packet = buildSubtypeEvidencePacket({
    subject:
      message.normalizedEmail?.normalizedSubject?.trim() ||
      message.normalizedEmail?.subject?.trim() ||
      message.subject?.trim() ||
      "",
    cleanBody: message.normalizedEmail?.cleanTextBody ?? message.bodyText ?? "",
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    senderDomain: message.normalizedEmail?.senderDomain?.trim() || extractDomain(message.senderEmail) || "",
    attachmentNames: attachmentNamesFromMetadata(message.attachmentMetadata),
    threadSnippets: prior,
    job: confirmed ? { name: confirmed.name, jobNumber: confirmed.jobNumber } : null,
    summary: "",
  });
  return {
    classificationId: classification.id,
    subject: packet.subject,
    currentMessage: packet.currentMessage,
    thread: packet.thread,
    attachmentNames: packet.attachments,
    sender: packet.sender,
    job: packet.job,
  };
}

export interface SubtypeShadowCase {
  classificationId: string;
  expected: string;
  predicted: string;
  confidence: number;
  competingType: string | null;
  evidence: string[];
  classifierVersion: string;
  inputChars: number;
  subject: string;
  currentExcerpt: string;
  threadExcerpts: string[];
  attachmentNames: string[];
}

export async function runSubtypeShadowBatch(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    classificationIds: string[];
    classify: (email: BusinessSubtypeEmailInput) => Promise<BusinessSubtypeResult>;
  }
): Promise<{ cases: SubtypeShadowCase[]; skipped: Array<{ classificationId: string; reason: string }>; elapsedMs: number }> {
  const started = Date.now();
  const activeBusinessTypes = await prisma.businessType.findMany({
    where: { active: true, OR: [{ workspaceId: null }, { workspaceId: input.workspaceId }] },
    select: { systemKey: true, displayLabel: true, displayGroup: true, displayOrder: true },
    take: 40,
  });
  const cases: SubtypeShadowCase[] = [];
  const skipped: Array<{ classificationId: string; reason: string }> = [];

  for (const classificationId of input.classificationIds) {
    const correction = await prisma.classificationCorrection.findFirst({
      where: {
        workspaceId: input.workspaceId,
        classificationId,
        reason: { startsWith: SUBTYPE_VERIFY_PREFIX },
      },
      orderBy: { reviewedAt: "desc" },
      select: { correctedBusinessType: true, reason: true },
    });
    const expected = blindExpectedSubtype(correction?.reason, correction?.correctedBusinessType);
    if (!expected) {
      const parsed = parseSubtypeVerifyReason(correction?.reason);
      skipped.push({
        classificationId,
        reason: parsed?.action === "ambiguous"
          ? "Human label is ambiguous and is excluded from accuracy"
          : "No independent blind subtype label for this classification",
      });
      continue;
    }

    const classification = await prisma.classification.findFirst({
      where: { workspaceId: input.workspaceId, id: classificationId },
      select: {
        summary: true,
        message: {
          select: {
            id: true,
            threadId: true,
            subject: true,
            senderName: true,
            senderEmail: true,
            bodyText: true,
            attachmentMetadata: true,
            jobId: true,
            job: { select: { id: true, workspaceId: true, jobNumber: true, name: true } },
            normalizedEmail: {
              select: { normalizedSubject: true, cleanTextBody: true, senderDomain: true, subject: true },
            },
          },
        },
      },
    });
    const message = classification?.message;
    if (!message) {
      skipped.push({ classificationId, reason: "Message not found" });
      continue;
    }

    const prior = message.threadId
      ? await prisma.emailMessage.findMany({
          where: {
            workspaceId: input.workspaceId,
            threadId: message.threadId,
            id: { not: message.id },
          },
          orderBy: { receivedAt: "desc" },
          take: 3,
          select: { senderEmail: true, subject: true, snippet: true },
        })
      : [];

    const confirmed = resolveConfirmedWorkspaceJob({
      workspaceId: input.workspaceId,
      job: message.job,
    });
    const email: BusinessSubtypeEmailInput = {
      normalizedSubject:
        message.normalizedEmail?.normalizedSubject?.trim() ||
        message.normalizedEmail?.subject?.trim() ||
        message.subject?.trim() ||
        "",
      senderName: message.senderName,
      senderEmail: message.senderEmail,
      senderDomain:
        message.normalizedEmail?.senderDomain?.trim() ||
        extractDomain(message.senderEmail) ||
        "",
      cleanBody: message.normalizedEmail?.cleanTextBody ?? message.bodyText ?? "",
      attachmentNames: attachmentNamesFromMetadata(message.attachmentMetadata),
      activeBusinessTypes: activeBusinessTypes.map((type) => ({
        key: type.systemKey,
        label: type.displayLabel,
        group: type.displayGroup,
        order: type.displayOrder,
      })),
      summary: classification?.summary ?? "",
      threadSnippets: prior,
      job: confirmed ? { name: confirmed.name, jobNumber: confirmed.jobNumber } : null,
    };
    const packet = buildSubtypeEvidencePacket({
      subject: email.normalizedSubject,
      cleanBody: email.cleanBody,
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      senderDomain: email.senderDomain,
      attachmentNames: email.attachmentNames,
      threadSnippets: email.threadSnippets,
      job: email.job,
      summary: email.summary,
    });
    const inputChars =
      businessSubtypeSystemPrompt.length + buildBusinessSubtypeUserPrompt(email).length;
    const predicted = await input.classify(email);
    cases.push({
      classificationId,
      expected,
      predicted: predicted.businessType,
      confidence: predicted.businessTypeConfidence,
      competingType: predicted.competingType,
      evidence: predicted.evidence,
      classifierVersion: predicted.classifierVersion || SUBTYPE_CLASSIFIER_VERSION,
      inputChars,
      subject: packet.subject,
      currentExcerpt: packet.currentMessage.slice(0, 400),
      threadExcerpts: packet.thread.map(
        (row) => `${row.senderEmail} | ${row.subject} | ${row.snippet}`.slice(0, 500)
      ),
      attachmentNames: packet.attachments,
    });
  }

  return { cases, skipped, elapsedMs: Date.now() - started };
}
