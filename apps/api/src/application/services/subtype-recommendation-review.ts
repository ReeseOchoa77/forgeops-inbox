import type { Prisma, PrismaClient } from "@prisma/client";
import {
  BUSINESS_SUBTYPE_KEYS,
  BUSINESS_SUBTYPE_LABELS,
  collectKnownSubtypeKeys,
  computeTaxonomyEvalMetrics,
  effectiveRecommendation,
  isValidSystemKey,
  suggestSystemKeyFromName,
  type SubtypeDiscoveryRecommendation,
  type SubtypeRecommendationDecisionDto,
  type SubtypeRecommendationDecisionStatus,
  type SubtypeRecommendationEditPayload,
  type TaxonomyRevisionDto,
  type TaxonomyEvalEmailRow,
} from "@forgeops/shared";
import type { AuditEventLogger } from "./audit-event-logger.js";

export class SubtypeRecommendationReviewError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "INVALID"
    | "DUPLICATE"
    | "FORBIDDEN_PARENT"
    | "ALREADY_DECIDED"
    | "NOT_APPROVED"
    | "NOT_ROLLABLE"
    | "CONFIRM_REQUIRED";

  constructor(code: SubtypeRecommendationReviewError["code"], message: string) {
    super(message);
    this.name = "SubtypeRecommendationReviewError";
    this.code = code;
  }
}

function asRecs(raw: unknown): SubtypeDiscoveryRecommendation[] {
  return Array.isArray(raw) ? (raw as SubtypeDiscoveryRecommendation[]) : [];
}

async function loadRecommendation(
  prisma: PrismaClient,
  workspaceId: string,
  discoveryRunId: string,
  recommendationId: string
): Promise<{
  runId: string;
  recommendation: SubtypeDiscoveryRecommendation;
}> {
  const run = await prisma.subtypeDiscoveryRun.findFirst({
    where: { id: discoveryRunId, workspaceId, status: "COMPLETED" },
    select: { id: true, recommendations: true },
  });
  if (!run) {
    throw new SubtypeRecommendationReviewError(
      "NOT_FOUND",
      "Completed discovery run not found"
    );
  }
  const rec = asRecs(run.recommendations).find((r) => r.id === recommendationId);
  if (!rec) {
    throw new SubtypeRecommendationReviewError(
      "NOT_FOUND",
      "Recommendation not found on this run"
    );
  }
  return { runId: run.id, recommendation: rec };
}

export async function listRecommendationDecisions(input: {
  prisma: PrismaClient;
  workspaceId: string;
  discoveryRunId: string;
}): Promise<SubtypeRecommendationDecisionDto[]> {
  const rows = await input.prisma.subtypeRecommendationDecision.findMany({
    where: {
      workspaceId: input.workspaceId,
      discoveryRunId: input.discoveryRunId,
    },
  });
  return rows.map(mapDecision);
}

export async function upsertRecommendationDecision(input: {
  prisma: PrismaClient;
  workspaceId: string;
  discoveryRunId: string;
  recommendationId: string;
  status: Exclude<SubtypeRecommendationDecisionStatus, "APPROVED">;
  editedPayload?: SubtypeRecommendationEditPayload | null;
  mergeTargetKey?: string | null;
  notes?: string | null;
  userId: string;
}): Promise<SubtypeRecommendationDecisionDto> {
  await loadRecommendation(
    input.prisma,
    input.workspaceId,
    input.discoveryRunId,
    input.recommendationId
  );

  if (input.status === "MERGED") {
    if (!input.mergeTargetKey) {
      throw new SubtypeRecommendationReviewError(
        "INVALID",
        "mergeTargetKey is required for MERGED"
      );
    }
    const known = await loadKnownKeys(input.prisma, input.workspaceId);
    if (!known.has(input.mergeTargetKey)) {
      throw new SubtypeRecommendationReviewError(
        "INVALID",
        `Unknown merge target subtype: ${input.mergeTargetKey}`
      );
    }
  }

  if (input.editedPayload) {
    validateEditPayload(input.editedPayload);
  }

  const existing = await input.prisma.subtypeRecommendationDecision.findUnique({
    where: {
      discoveryRunId_recommendationId: {
        discoveryRunId: input.discoveryRunId,
        recommendationId: input.recommendationId,
      },
    },
  });
  if (existing?.status === "APPROVED" && existing.taxonomyRevisionId) {
    throw new SubtypeRecommendationReviewError(
      "ALREADY_DECIDED",
      "Recommendation already approved and applied. Use rollback on the taxonomy revision instead."
    );
  }

  const data = {
    workspaceId: input.workspaceId,
    discoveryRunId: input.discoveryRunId,
    recommendationId: input.recommendationId,
    status: input.status,
    editedPayload: (input.editedPayload ??
      null) as unknown as Prisma.InputJsonValue,
    mergeTargetKey: input.mergeTargetKey ?? null,
    notes: input.notes ?? null,
    decidedByUserId: input.userId,
    decidedAt: new Date(),
    taxonomyRevisionId: null,
  };

  const row = existing
    ? await input.prisma.subtypeRecommendationDecision.update({
        where: { id: existing.id },
        data,
      })
    : await input.prisma.subtypeRecommendationDecision.create({ data });

  return mapDecision(row);
}

export async function previewApprovalChange(input: {
  prisma: PrismaClient;
  workspaceId: string;
  discoveryRunId: string;
  recommendationId: string;
  editedPayload?: SubtypeRecommendationEditPayload | null;
}): Promise<{
  changeType: "ADD_SUBTYPE";
  parentType: "BUSINESS";
  systemKey: string;
  displayLabel: string;
  definition: string;
  inclusionCriteria: string;
  exclusionCriteria: string;
  duplicateOf: string | null;
  willCreateWorkspaceBusinessType: true;
  willReclassifyHistoricalEmails: false;
}> {
  const { recommendation } = await loadRecommendation(
    input.prisma,
    input.workspaceId,
    input.discoveryRunId,
    input.recommendationId
  );
  const effective = effectiveRecommendation(
    recommendation,
    input.editedPayload
  );
  const systemKey =
    input.editedPayload?.systemKey ??
    suggestSystemKeyFromName(effective.suggestedSubtypeName ?? "CUSTOM_SUBTYPE");
  if (!isValidSystemKey(systemKey)) {
    throw new SubtypeRecommendationReviewError(
      "INVALID",
      "systemKey must be UPPER_SNAKE starting with a letter (2–48 chars)"
    );
  }
  if (effective.recommendedParentType === "PERSONAL") {
    throw new SubtypeRecommendationReviewError(
      "FORBIDDEN_PARENT",
      "Subtypes are BUSINESS-parented; PERSONAL parent is not allowed"
    );
  }
  const known = await loadKnownKeys(input.prisma, input.workspaceId);
  const duplicateOf = known.has(systemKey) ? systemKey : null;
  return {
    changeType: "ADD_SUBTYPE",
    parentType: "BUSINESS",
    systemKey,
    displayLabel:
      input.editedPayload?.suggestedSubtypeName ??
      effective.suggestedSubtypeName ??
      systemKey,
    definition: input.editedPayload?.definition ?? effective.definition ?? "",
    inclusionCriteria:
      input.editedPayload?.inclusionCriteria ??
      effective.inclusionCriteria ??
      "",
    exclusionCriteria:
      input.editedPayload?.exclusionCriteria ??
      effective.exclusionCriteria ??
      "",
    duplicateOf,
    willCreateWorkspaceBusinessType: true,
    willReclassifyHistoricalEmails: false,
  };
}

/**
 * Apply approved NEW_SUBTYPE: create workspace BusinessType + TaxonomyRevision.
 * Requires confirmApply === true. Never reclassifies emails.
 */
export async function approveAndApplyRecommendation(input: {
  prisma: PrismaClient;
  audit: AuditEventLogger;
  workspaceId: string;
  discoveryRunId: string;
  recommendationId: string;
  userId: string;
  editedPayload?: SubtypeRecommendationEditPayload | null;
  notes?: string | null;
  confirmApply: boolean;
}): Promise<{
  decision: SubtypeRecommendationDecisionDto;
  revision: TaxonomyRevisionDto;
  businessTypeId: string;
}> {
  if (!input.confirmApply) {
    throw new SubtypeRecommendationReviewError(
      "CONFIRM_REQUIRED",
      "Set confirmApply=true after reviewing the exact proposed change"
    );
  }

  const preview = await previewApprovalChange({
    prisma: input.prisma,
    workspaceId: input.workspaceId,
    discoveryRunId: input.discoveryRunId,
    recommendationId: input.recommendationId,
    ...(input.editedPayload !== undefined
      ? { editedPayload: input.editedPayload }
      : {}),
  });
  if (preview.duplicateOf) {
    throw new SubtypeRecommendationReviewError(
      "DUPLICATE",
      `Subtype key ${preview.systemKey} already exists. Edit the key or merge instead.`
    );
  }

  const existing = await input.prisma.subtypeRecommendationDecision.findUnique({
    where: {
      discoveryRunId_recommendationId: {
        discoveryRunId: input.discoveryRunId,
        recommendationId: input.recommendationId,
      },
    },
  });
  if (existing?.status === "APPROVED" && existing.taxonomyRevisionId) {
    throw new SubtypeRecommendationReviewError(
      "ALREADY_DECIDED",
      "Already approved"
    );
  }

  const lastVersion = await input.prisma.taxonomyRevision.findFirst({
    where: { workspaceId: input.workspaceId },
    orderBy: { version: "desc" },
    select: { version: true, id: true },
  });
  const nextVersion = (lastVersion?.version ?? 0) + 1;

  const result = await input.prisma.$transaction(async (tx) => {
    const bt = await tx.businessType.create({
      data: {
        workspaceId: input.workspaceId,
        systemKey: preview.systemKey,
        displayLabel: preview.displayLabel,
        description: [
          preview.definition,
          preview.inclusionCriteria
            ? `Inclusion: ${preview.inclusionCriteria}`
            : null,
          preview.exclusionCriteria
            ? `Exclusion: ${preview.exclusionCriteria}`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        displayGroup: "CUSTOM",
        displayOrder: 100 + nextVersion,
        active: true,
      },
    });

    const revision = await tx.taxonomyRevision.create({
      data: {
        workspaceId: input.workspaceId,
        version: nextVersion,
        status: "ACTIVE",
        changeType: "ADD_SUBTYPE",
        payload: {
          before: null,
          after: {
            systemKey: preview.systemKey,
            displayLabel: preview.displayLabel,
            definition: preview.definition,
            inclusionCriteria: preview.inclusionCriteria,
            exclusionCriteria: preview.exclusionCriteria,
            parentType: "BUSINESS",
            businessTypeId: bt.id,
          },
          willReclassifyHistoricalEmails: false,
        } as unknown as Prisma.InputJsonValue,
        businessTypeId: bt.id,
        systemKey: preview.systemKey,
        discoveryRunId: input.discoveryRunId,
        recommendationId: input.recommendationId,
        previousRevisionId: lastVersion?.id ?? null,
        approvedByUserId: input.userId,
      },
    });

    const decision = existing
      ? await tx.subtypeRecommendationDecision.update({
          where: { id: existing.id },
          data: {
            status: "APPROVED",
            editedPayload: (input.editedPayload ??
              null) as unknown as Prisma.InputJsonValue,
            notes: input.notes ?? null,
            decidedByUserId: input.userId,
            decidedAt: new Date(),
            taxonomyRevisionId: revision.id,
            mergeTargetKey: null,
          },
        })
      : await tx.subtypeRecommendationDecision.create({
          data: {
            workspaceId: input.workspaceId,
            discoveryRunId: input.discoveryRunId,
            recommendationId: input.recommendationId,
            status: "APPROVED",
            editedPayload: (input.editedPayload ??
              null) as unknown as Prisma.InputJsonValue,
            notes: input.notes ?? null,
            decidedByUserId: input.userId,
            decidedAt: new Date(),
            taxonomyRevisionId: revision.id,
          },
        });

    return { bt, revision, decision };
  });

  await input.audit.log({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    entityType: "TAXONOMY_REVISION",
    entityId: result.revision.id,
    action: "taxonomy.subtype_added",
    metadata: {
      version: result.revision.version,
      systemKey: preview.systemKey,
      discoveryRunId: input.discoveryRunId,
      recommendationId: input.recommendationId,
      businessTypeId: result.bt.id,
      reclassifiedEmails: false,
    },
  });

  return {
    decision: mapDecision(result.decision),
    revision: mapRevision(result.revision),
    businessTypeId: result.bt.id,
  };
}

export async function listTaxonomyRevisions(input: {
  prisma: PrismaClient;
  workspaceId: string;
  limit?: number;
}): Promise<TaxonomyRevisionDto[]> {
  const rows = await input.prisma.taxonomyRevision.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: { version: "desc" },
    take: Math.min(input.limit ?? 50, 100),
  });
  return rows.map(mapRevision);
}

/**
 * Rollback an ADD_SUBTYPE revision: deactivate workspace BusinessType.
 * Does not rewrite Classification.businessTypeKey on historical emails.
 */
export async function rollbackTaxonomyRevision(input: {
  prisma: PrismaClient;
  audit: AuditEventLogger;
  workspaceId: string;
  revisionId: string;
  userId: string;
  confirmRollback: boolean;
}): Promise<{ revision: TaxonomyRevisionDto; rollbackRevision: TaxonomyRevisionDto }> {
  if (!input.confirmRollback) {
    throw new SubtypeRecommendationReviewError(
      "CONFIRM_REQUIRED",
      "Set confirmRollback=true to reverse this taxonomy change"
    );
  }

  const rev = await input.prisma.taxonomyRevision.findFirst({
    where: { id: input.revisionId, workspaceId: input.workspaceId },
  });
  if (!rev) {
    throw new SubtypeRecommendationReviewError("NOT_FOUND", "Revision not found");
  }
  if (rev.status !== "ACTIVE" || rev.changeType !== "ADD_SUBTYPE") {
    throw new SubtypeRecommendationReviewError(
      "NOT_ROLLABLE",
      "Only ACTIVE ADD_SUBTYPE revisions can be rolled back in MVP"
    );
  }
  if (!rev.businessTypeId) {
    throw new SubtypeRecommendationReviewError(
      "NOT_ROLLABLE",
      "Revision has no businessTypeId"
    );
  }

  const lastVersion = await input.prisma.taxonomyRevision.findFirst({
    where: { workspaceId: input.workspaceId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (lastVersion?.version ?? 0) + 1;

  const result = await input.prisma.$transaction(async (tx) => {
    await tx.businessType.updateMany({
      where: {
        id: rev.businessTypeId!,
        workspaceId: input.workspaceId,
      },
      data: { active: false },
    });

    await tx.taxonomyRevision.update({
      where: { id: rev.id },
      data: {
        status: "ROLLED_BACK",
        rolledBackAt: new Date(),
        rolledBackByUserId: input.userId,
      },
    });

    const rollback = await tx.taxonomyRevision.create({
      data: {
        workspaceId: input.workspaceId,
        version: nextVersion,
        status: "ACTIVE",
        changeType: "ROLLBACK",
        payload: {
          rolledBackRevisionId: rev.id,
          rolledBackVersion: rev.version,
          deactivatedBusinessTypeId: rev.businessTypeId,
          systemKey: rev.systemKey,
          willReclassifyHistoricalEmails: false,
          note: "Historical Classification.businessTypeKey values are preserved",
        } as unknown as Prisma.InputJsonValue,
        businessTypeId: rev.businessTypeId,
        systemKey: rev.systemKey,
        discoveryRunId: rev.discoveryRunId,
        recommendationId: rev.recommendationId,
        previousRevisionId: rev.id,
        approvedByUserId: input.userId,
        rollbackOfRevisionId: rev.id,
      },
    });

    return { rev, rollback };
  });

  await input.audit.log({
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    entityType: "TAXONOMY_REVISION",
    entityId: result.rollback.id,
    action: "taxonomy.subtype_rolled_back",
    metadata: {
      rolledBackRevisionId: rev.id,
      systemKey: rev.systemKey,
      reclassifiedEmails: false,
    },
  });

  const fresh = await input.prisma.taxonomyRevision.findUniqueOrThrow({
    where: { id: rev.id },
  });
  return {
    revision: mapRevision(fresh),
    rollbackRevision: mapRevision(result.rollback),
  };
}

/**
 * Before/after evaluation on discovery dataset.
 * Proposed side simulates assigning supporting emails of selected recommendations
 * to their proposed keys. Does not run the live classifier.
 */
export async function runSubtypeTaxonomyEval(input: {
  prisma: PrismaClient;
  workspaceId: string;
  discoveryRunId: string;
  /** Recommendation ids whose supporting emails map to proposed keys. */
  proposedRecommendationIds: string[];
  userId?: string;
}): Promise<{
  evalRunId: string;
  metrics: ReturnType<typeof computeTaxonomyEvalMetrics>["metrics"];
  emailChangeCount: number;
}> {
  const run = await input.prisma.subtypeDiscoveryRun.findFirst({
    where: {
      id: input.discoveryRunId,
      workspaceId: input.workspaceId,
      status: "COMPLETED",
    },
  });
  if (!run) {
    throw new SubtypeRecommendationReviewError(
      "NOT_FOUND",
      "Completed discovery run not found"
    );
  }

  const sampled = Array.isArray(run.sampledEmailIds)
    ? (run.sampledEmailIds as string[])
    : [];
  const recs = asRecs(run.recommendations);
  const decisions = await input.prisma.subtypeRecommendationDecision.findMany({
    where: {
      workspaceId: input.workspaceId,
      discoveryRunId: input.discoveryRunId,
    },
  });
  const decisionByRec = new Map(decisions.map((d) => [d.recommendationId, d]));

  const proposedMap = new Map<string, string>();
  for (const recId of input.proposedRecommendationIds) {
    const rec = recs.find((r) => r.id === recId);
    if (!rec) continue;
    const decision = decisionByRec.get(recId);
    const edit = (decision?.editedPayload ??
      null) as SubtypeRecommendationEditPayload | null;
    const effective = effectiveRecommendation(rec, edit);
    const key =
      edit?.systemKey ??
      suggestSystemKeyFromName(effective.suggestedSubtypeName ?? "CUSTOM");
    const ids =
      rec.supportingEmailIds?.length
        ? rec.supportingEmailIds
        : rec.examples.map((e) => e.emailMessageId);
    for (const id of ids) {
      proposedMap.set(id, key);
    }
  }

  const datasetIds = sampled.length > 0 ? sampled.slice(0, 5000) : [...proposedMap.keys()];

  const messages = await input.prisma.emailMessage.findMany({
    where: { workspaceId: input.workspaceId, id: { in: datasetIds } },
    select: {
      id: true,
      classifications: {
        select: {
          id: true,
          businessTypeKey: true,
        },
        take: 1,
      },
    },
  });

  const classificationIds = messages
    .map((m) => m.classifications[0]?.id)
    .filter((id): id is string => !!id);

  const corrections = classificationIds.length
    ? await input.prisma.classificationCorrection.findMany({
        where: {
          workspaceId: input.workspaceId,
          classificationId: { in: classificationIds },
          correctedBusinessType: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: {
          classificationId: true,
          correctedBusinessType: true,
        },
      })
    : [];
  const correctionByClass = new Map<string, string>();
  for (const c of corrections) {
    if (!correctionByClass.has(c.classificationId) && c.correctedBusinessType) {
      correctionByClass.set(c.classificationId, c.correctedBusinessType);
    }
  }

  const rows: TaxonomyEvalEmailRow[] = messages.map((m) => {
    const c = m.classifications[0];
    const currentKey = c?.businessTypeKey ?? null;
    const groundTruthKey =
      c?.id && correctionByClass.has(c.id)
        ? (correctionByClass.get(c.id) ?? null)
        : null;
    return {
      emailMessageId: m.id,
      currentKey,
      groundTruthKey,
      proposedKey: proposedMap.get(m.id) ?? null,
    };
  });

  const { metrics, emailChanges } = computeTaxonomyEvalMetrics(rows);

  const knownKeys = await loadKnownKeys(input.prisma, input.workspaceId);
  const evalRun = await input.prisma.subtypeTaxonomyEvalRun.create({
    data: {
      workspaceId: input.workspaceId,
      discoveryRunId: input.discoveryRunId,
      label: "experimental",
      datasetEmailIds: datasetIds as unknown as Prisma.InputJsonValue,
      taxonomySnapshot: {
        currentKeys: [...knownKeys].sort(),
        proposedRecommendationIds: input.proposedRecommendationIds,
        proposedAssignments: Object.fromEntries(proposedMap),
      } as unknown as Prisma.InputJsonValue,
      metrics: metrics as unknown as Prisma.InputJsonValue,
      emailChanges: emailChanges.slice(0, 500) as unknown as Prisma.InputJsonValue,
      groundTruthQuality: metrics.groundTruthQuality,
      methodologyNotes: metrics.methodologyNotes,
      createdByUserId: input.userId ?? null,
    },
  });

  return {
    evalRunId: evalRun.id,
    metrics,
    emailChangeCount: emailChanges.length,
  };
}

export async function listSubtypeTaxonomyEvals(input: {
  prisma: PrismaClient;
  workspaceId: string;
  discoveryRunId?: string;
}): Promise<
  Array<{
    id: string;
    label: string;
    discoveryRunId: string | null;
    groundTruthQuality: string;
    metrics: unknown;
    createdAt: string;
  }>
> {
  const rows = await input.prisma.subtypeTaxonomyEvalRun.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.discoveryRunId
        ? { discoveryRunId: input.discoveryRunId }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    discoveryRunId: r.discoveryRunId,
    groundTruthQuality: r.groundTruthQuality,
    metrics: r.metrics,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getSubtypeTaxonomyEval(input: {
  prisma: PrismaClient;
  workspaceId: string;
  evalRunId: string;
}): Promise<{
  id: string;
  label: string;
  discoveryRunId: string | null;
  taxonomySnapshot: unknown;
  metrics: unknown;
  emailChanges: unknown;
  groundTruthQuality: string;
  methodologyNotes: string;
  createdAt: string;
} | null> {
  const row = await input.prisma.subtypeTaxonomyEvalRun.findFirst({
    where: { id: input.evalRunId, workspaceId: input.workspaceId },
  });
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    discoveryRunId: row.discoveryRunId,
    taxonomySnapshot: row.taxonomySnapshot,
    metrics: row.metrics,
    emailChanges: row.emailChanges,
    groundTruthQuality: row.groundTruthQuality,
    methodologyNotes: row.methodologyNotes,
    createdAt: row.createdAt.toISOString(),
  };
}

export function defaultEditFromRecommendation(
  rec: SubtypeDiscoveryRecommendation
): SubtypeRecommendationEditPayload {
  const name = rec.suggestedSubtypeName?.trim() || "Custom Subtype";
  return {
    suggestedSubtypeName: name,
    systemKey: suggestSystemKeyFromName(name),
    recommendedParentType: "BUSINESS",
    definition: rec.definition ?? "",
    inclusionCriteria: rec.inclusionCriteria ?? "",
    exclusionCriteria: rec.exclusionCriteria ?? "",
  };
}

async function loadKnownKeys(
  prisma: PrismaClient,
  workspaceId: string
): Promise<Set<string>> {
  const workspaceTypes = await prisma.businessType.findMany({
    where: {
      OR: [{ workspaceId: null }, { workspaceId }],
      active: true,
    },
    select: { systemKey: true },
  });
  return collectKnownSubtypeKeys(workspaceTypes.map((t) => t.systemKey));
}

function validateEditPayload(edit: SubtypeRecommendationEditPayload): void {
  if (!edit.suggestedSubtypeName.trim()) {
    throw new SubtypeRecommendationReviewError(
      "INVALID",
      "suggestedSubtypeName is required"
    );
  }
  if (!isValidSystemKey(edit.systemKey)) {
    throw new SubtypeRecommendationReviewError(
      "INVALID",
      "Invalid systemKey"
    );
  }
  if (edit.recommendedParentType !== "BUSINESS") {
    throw new SubtypeRecommendationReviewError(
      "FORBIDDEN_PARENT",
      "Parent Type must be BUSINESS"
    );
  }
}

function mapDecision(row: {
  id: string;
  discoveryRunId: string;
  recommendationId: string;
  status: string;
  editedPayload: unknown;
  mergeTargetKey: string | null;
  notes: string | null;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  taxonomyRevisionId: string | null;
}): SubtypeRecommendationDecisionDto {
  return {
    id: row.id,
    discoveryRunId: row.discoveryRunId,
    recommendationId: row.recommendationId,
    status: row.status as SubtypeRecommendationDecisionStatus,
    editedPayload: (row.editedPayload as SubtypeRecommendationEditPayload | null) ?? null,
    mergeTargetKey: row.mergeTargetKey,
    notes: row.notes,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    taxonomyRevisionId: row.taxonomyRevisionId,
  };
}

function mapRevision(row: {
  id: string;
  version: number;
  status: string;
  changeType: string;
  payload: unknown;
  businessTypeId: string | null;
  systemKey: string | null;
  discoveryRunId: string | null;
  recommendationId: string | null;
  approvedByUserId: string;
  createdAt: Date;
  rolledBackAt: Date | null;
  rolledBackByUserId: string | null;
  rollbackOfRevisionId: string | null;
}): TaxonomyRevisionDto {
  return {
    id: row.id,
    version: row.version,
    status: row.status as TaxonomyRevisionDto["status"],
    changeType: row.changeType as TaxonomyRevisionDto["changeType"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    businessTypeId: row.businessTypeId,
    systemKey: row.systemKey,
    discoveryRunId: row.discoveryRunId,
    recommendationId: row.recommendationId,
    approvedByUserId: row.approvedByUserId,
    createdAt: row.createdAt.toISOString(),
    rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
    rolledBackByUserId: row.rolledBackByUserId,
    rollbackOfRevisionId: row.rollbackOfRevisionId,
  };
}

/** Exported for tests — system label list. */
export function systemSubtypeLabels(): Record<string, string> {
  return { ...BUSINESS_SUBTYPE_LABELS };
}

export function systemSubtypeKeys(): readonly string[] {
  return BUSINESS_SUBTYPE_KEYS;
}
