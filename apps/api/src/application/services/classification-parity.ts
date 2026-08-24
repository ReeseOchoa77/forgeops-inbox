import {
  createOpenAIClient,
  OpenAIBusinessSubtypeClassifier,
  OpenAIEntitySelector,
  OpenAISemanticSignalExtractor,
  OpenAITaskExtractor,
} from "@forgeops/ai";
import {
  buildParityDiagnostics,
  compareExact,
  compareNullableExact,
  compareNumeric,
  compareStringArrayExact,
  compareSummarySideBySide,
  compareTaskLists,
  extractHistoricalN8nFullResult,
  isExactMismatch,
  isNumericVariance,
  isUnavailable,
  type HistoricalN8nFullResult,
  type ParityDiagnosticStatus,
  type ParityFieldComparison,
  type NumericParityComparison,
  type UnavailableParityComparison,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";

import { ClassificationCandidatesService } from "./classification-candidates-service.js";
import {
  runNativeClassificationPipeline,
  type NativeClassificationPipelineResult,
} from "./native-classification-pipeline.js";

export type {
  NumericParityComparison,
  ParityFieldComparison,
  UnavailableParityComparison,
  ParityDiagnosticStatus,
};

export interface ClassificationParityDeps {
  prisma: PrismaClient;
  openaiApiKey?: string | undefined;
  openaiSemanticModel: string;
  openaiSubtypeModel?: string | undefined;
  openaiEntityModel?: string | undefined;
  openaiTaskModel?: string | undefined;
}

export interface ClassificationParityResult {
  messageId: string;
  workspaceId: string;
  mailboxEmail: string;
  readOnly: true;
  dbWrites: false;
  diagnostics: ParityDiagnosticStatus[];
  n8nHistorical: HistoricalN8nFullResult;
  native: NativeClassificationPipelineResult;
  candidateDiagnostics: {
    candidateLookupFailed: boolean;
    knownSender: boolean | null;
    senderEvidenceStatus: string | null;
    customerCandidateCount: number;
    vendorCandidateCount: number;
    jobCandidateCount: number;
    approvedJobAliasCount: number;
  };
  comparisons: {
    semantic: {
      contentBusinessProbability: NumericParityComparison | UnavailableParityComparison;
      subjectBusinessProbability: NumericParityComparison | UnavailableParityComparison;
      signatureCompanyMatchConfidence:
        | NumericParityComparison
        | UnavailableParityComparison;
      jobReferenceConfidence: NumericParityComparison | UnavailableParityComparison;
      containsActionRequest: ParityFieldComparison<boolean>;
      hasExplicitDeadline: ParityFieldComparison<boolean>;
      deadlineUrgency: ParityFieldComparison<string>;
    };
    routing: {
      mailboxCategory: ParityFieldComparison<string>;
      decisionRule: ParityFieldComparison<string>;
    };
    businessSubtype: {
      businessType: ParityFieldComparison<string | null>;
      businessTypeConfidence: NumericParityComparison | UnavailableParityComparison;
      skippedBecausePersonal: boolean;
    };
    entities: {
      selectedCustomerId: ParityFieldComparison<string | null>;
      selectedVendorId: ParityFieldComparison<string | null>;
      selectedJobId: ParityFieldComparison<string | null>;
      entityMatchConfidence: NumericParityComparison | UnavailableParityComparison;
      matchEvidence: ParityFieldComparison<string[]>;
      skippedBecausePersonal: boolean;
    };
    tasks: ReturnType<typeof compareTaskLists> & {
      skippedBecausePersonal: boolean;
    };
    priority: {
      priority: ParityFieldComparison<string>;
      rule: ParityFieldComparison<string | null>;
      jobRelated: ParityFieldComparison<boolean>;
      containsActionRequest: ParityFieldComparison<boolean>;
      hasExplicitDeadline: ParityFieldComparison<boolean>;
      deadlineUrgency: ParityFieldComparison<string>;
    };
    summary: ReturnType<typeof compareSummarySideBySide>;
  };
  overall: {
    categoryMatches: boolean;
    decisionRuleMatches: boolean | null;
    comparableFieldCount: number;
    unavailableHistoricalFields: string[];
    hasMeaningfulComparisonBasis: boolean;
  };
  openai: {
    semanticModel: string;
    subtypeModel: string;
    entityModel: string;
    taskModel: string;
    api: "responses.create";
    maxOutputTokens: number;
    temperature: null;
    tools: null;
    textFormat: "json_object";
    n8nModelNameStored: string | null;
    n8nModelVersionStored: string | null;
    note: string;
  };
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

function extractDomainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function countComparable(
  values: Array<
    | ParityFieldComparison<unknown>
    | NumericParityComparison
    | UnavailableParityComparison
  >
): number {
  return values.filter((v) => !isUnavailable(v)).length;
}

/**
 * Read-only complete-pipeline parity for one EmailMessage.
 * Zero EmailMessage / Classification / Task / Job writes.
 */
export async function runClassificationParityForMessage(
  messageId: string,
  deps: ClassificationParityDeps
): Promise<ClassificationParityResult> {
  const message = await deps.prisma.emailMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      workspaceId: true,
      subject: true,
      senderName: true,
      senderEmail: true,
      bodyText: true,
      mailboxCategory: true,
      attachmentMetadata: true,
      inboxConnection: {
        select: { email: true, ingestionSource: true },
      },
      normalizedEmail: {
        select: {
          normalizedSubject: true,
          cleanTextBody: true,
          senderDomain: true,
          subject: true,
        },
      },
      tasks: {
        orderBy: { createdAt: "asc" },
        take: 5,
        select: {
          title: true,
          description: true,
          summary: true,
          dueAt: true,
          assigneeGuess: true,
          confidence: true,
        },
      },
      classifications: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          mailboxCategory: true,
          summary: true,
          containsActionRequest: true,
          modelName: true,
          modelVersion: true,
          classificationEvidence: true,
          rawAiPayload: true,
          businessTypeKey: true,
          businessTypeConfidence: true,
          customerId: true,
          vendorId: true,
          jobId: true,
          entityMatchConfidence: true,
          matchEvidence: true,
          priority: true,
        },
      },
    },
  });

  if (!message) {
    throw new Error(`EmailMessage not found: ${messageId}`);
  }

  const classification = message.classifications[0] ?? null;
  const n8nHistorical = extractHistoricalN8nFullResult({
    classification,
    messageMailboxCategory: message.mailboxCategory,
    tasks: message.tasks,
  });

  if (!n8nHistorical.hasMeaningfulComparisonBasis) {
    throw new Error(
      `Message ${messageId} lacks enough persisted n8n classification evidence for a meaningful parity comparison ` +
        `(need mailboxCategory plus probability signals and/or decisionRule). ` +
        `Unavailable: ${n8nHistorical.unavailableFields.join(", ") || "(none listed)"}`
    );
  }

  const mailboxEmail = message.inboxConnection.email;
  const normalized = message.normalizedEmail;
  const normalizedSubject =
    normalized?.normalizedSubject?.trim() ||
    normalized?.subject?.trim() ||
    message.subject?.trim() ||
    "";
  const cleanBody = normalized?.cleanTextBody ?? message.bodyText ?? "";
  const senderDomain =
    normalized?.senderDomain?.trim() ||
    extractDomainFromEmail(message.senderEmail);

  const semanticModel = deps.openaiSemanticModel || "chat-latest";
  const subtypeModel = deps.openaiSubtypeModel || semanticModel;
  const entityModel = deps.openaiEntityModel || semanticModel;
  const taskModel = deps.openaiTaskModel || semanticModel;

  const openaiClient = createOpenAIClient({
    ...(deps.openaiApiKey ? { apiKey: deps.openaiApiKey } : {}),
  });

  const candidatesService = new ClassificationCandidatesService(deps.prisma);
  const native = await runNativeClassificationPipeline(
    {
      workspaceId: message.workspaceId,
      mailboxEmail,
      normalizedSubject,
      subject: message.subject,
      cleanBody,
      senderName: message.senderName,
      senderEmail: message.senderEmail,
      senderDomain,
      attachmentNames: attachmentNamesFromMetadata(message.attachmentMetadata),
    },
    {
      candidatesService,
      semanticSignalExtractor: new OpenAISemanticSignalExtractor(
        openaiClient,
        semanticModel
      ),
      businessSubtypeClassifier: new OpenAIBusinessSubtypeClassifier(
        openaiClient,
        subtypeModel
      ),
      entitySelector: new OpenAIEntitySelector(openaiClient, entityModel),
      taskExtractor: new OpenAITaskExtractor(openaiClient, taskModel),
    }
  );

  const isPersonal = native.mailboxDecision.mailboxCategory === "PERSONAL";
  const signals = native.semanticSignals;
  const decision = native.mailboxDecision;

  const semantic = {
    contentBusinessProbability: compareNumeric(
      n8nHistorical.contentBusinessProbability,
      signals.contentBusinessProbability
    ),
    subjectBusinessProbability: compareNumeric(
      n8nHistorical.subjectBusinessProbability,
      signals.subjectBusinessProbability
    ),
    signatureCompanyMatchConfidence: compareNumeric(
      n8nHistorical.signatureCompanyMatchConfidence,
      signals.signatureCompanyMatchConfidence
    ),
    jobReferenceConfidence: compareNumeric(
      n8nHistorical.jobReferenceConfidence,
      signals.jobReferenceConfidence
    ),
    containsActionRequest: compareExact(
      n8nHistorical.containsActionRequest,
      signals.containsActionRequest
    ),
    hasExplicitDeadline: compareExact(
      n8nHistorical.hasExplicitDeadline,
      signals.hasExplicitDeadline
    ),
    deadlineUrgency: compareExact(
      n8nHistorical.deadlineUrgency,
      signals.deadlineUrgency
    ),
  };

  const routing = {
    mailboxCategory: compareExact(
      n8nHistorical.mailboxCategory,
      decision.mailboxCategory
    ),
    decisionRule: compareExact(n8nHistorical.decisionRule, decision.decisionRule),
  };

  const histSources = n8nHistorical.fieldSources;
  const subtypeAvailable = histSources.businessType != null;
  const customerAvailable = histSources.selectedCustomerId != null;
  const vendorAvailable = histSources.selectedVendorId != null;
  const jobAvailable = histSources.selectedJobId != null;
  const evidenceAvailable = histSources.matchEvidence != null;

  const unavailableField = (
    nativeValue: unknown = null
  ): UnavailableParityComparison => ({
    n8n: null,
    native: nativeValue,
    matches: null,
    unavailable: true,
  });

  // PERSONAL skips business-only comparisons (subtype / entities / tasks).
  const businessSubtype = {
    businessType: isPersonal
      ? unavailableField(null)
      : compareNullableExact(
          n8nHistorical.businessType,
          native.businessSubtype?.businessType ?? null,
          subtypeAvailable
        ),
    businessTypeConfidence: isPersonal
      ? unavailableField(null)
      : compareNumeric(
          n8nHistorical.businessTypeConfidence,
          native.businessSubtype?.businessTypeConfidence ?? 0
        ),
    skippedBecausePersonal: isPersonal,
  };

  const entities = {
    selectedCustomerId: isPersonal
      ? unavailableField(null)
      : compareNullableExact(
          n8nHistorical.selectedCustomerId,
          native.entities?.selectedCustomerId ?? null,
          customerAvailable
        ),
    selectedVendorId: isPersonal
      ? unavailableField(null)
      : compareNullableExact(
          n8nHistorical.selectedVendorId,
          native.entities?.selectedVendorId ?? null,
          vendorAvailable
        ),
    selectedJobId: isPersonal
      ? unavailableField(null)
      : compareNullableExact(
          n8nHistorical.selectedJobId,
          native.entities?.selectedJobId ?? null,
          jobAvailable
        ),
    entityMatchConfidence: isPersonal
      ? unavailableField(null)
      : compareNumeric(
          n8nHistorical.entityMatchConfidence,
          native.entities?.entityMatchConfidence ?? 0
        ),
    matchEvidence: isPersonal
      ? unavailableField([])
      : compareStringArrayExact(
          n8nHistorical.matchEvidence,
          native.entities?.matchEvidence ?? [],
          evidenceAvailable
        ),
    skippedBecausePersonal: isPersonal,
  };

  const tasks = isPersonal
    ? {
        taskCount: unavailableField(native.tasks.length),
        rows: [],
        titleSetMatches: null as boolean | null,
        skippedBecausePersonal: true as const,
      }
    : {
        ...compareTaskLists(n8nHistorical.tasks, native.tasks),
        skippedBecausePersonal: false as const,
      };

  const pd = native.priorityDecision;
  const histPd = n8nHistorical.priorityDecision;
  const priority = {
    priority: compareExact(n8nHistorical.priority, pd.priority),
    rule: compareExact(histPd?.rule ?? null, pd.rule ?? null),
    jobRelated: compareExact(histPd?.jobRelated ?? null, pd.jobRelated === true),
    containsActionRequest: compareExact(
      histPd?.containsActionRequest ?? n8nHistorical.containsActionRequest,
      pd.containsActionRequest === true
    ),
    hasExplicitDeadline: compareExact(
      histPd?.hasExplicitDeadline ?? n8nHistorical.hasExplicitDeadline,
      pd.hasExplicitDeadline === true
    ),
    deadlineUrgency: compareExact(
      histPd?.deadlineUrgency ?? n8nHistorical.deadlineUrgency,
      String(pd.deadlineUrgency ?? "NONE")
    ),
  };

  const summary = compareSummarySideBySide(
    n8nHistorical.summary,
    signals.summary
  );

  const signalVariance =
    isNumericVariance(semantic.contentBusinessProbability) ||
    isNumericVariance(semantic.subjectBusinessProbability) ||
    isNumericVariance(semantic.signatureCompanyMatchConfidence) ||
    isNumericVariance(semantic.jobReferenceConfidence) ||
    isExactMismatch(semantic.containsActionRequest) ||
    isExactMismatch(semantic.hasExplicitDeadline) ||
    isExactMismatch(semantic.deadlineUrgency);

  const subtypeMismatch =
    !isPersonal &&
    !isUnavailable(businessSubtype.businessType) &&
    isExactMismatch(businessSubtype.businessType);

  const entityMismatch =
    !isPersonal &&
    (isExactMismatch(entities.selectedCustomerId as ParityFieldComparison<unknown>) ||
      isExactMismatch(entities.selectedVendorId as ParityFieldComparison<unknown>) ||
      isExactMismatch(entities.selectedJobId as ParityFieldComparison<unknown>));

  const taskMismatch =
    !isPersonal &&
    ((!isUnavailable(tasks.taskCount) && isExactMismatch(tasks.taskCount)) ||
      tasks.titleSetMatches === false);

  const priorityMismatch =
    (!isUnavailable(priority.priority) && isExactMismatch(priority.priority)) ||
    (!isUnavailable(priority.rule) && isExactMismatch(priority.rule));

  const categoryMatches = routing.mailboxCategory.matches === true;
  const decisionRuleMatches = isUnavailable(routing.decisionRule)
    ? null
    : routing.decisionRule.matches === true;

  const diagnostics = buildParityDiagnostics({
    hasMeaningfulComparisonBasis: n8nHistorical.hasMeaningfulComparisonBasis,
    mailboxCategoryMatches: isUnavailable(routing.mailboxCategory)
      ? null
      : routing.mailboxCategory.matches === true,
    decisionRuleMatches,
    signalVariance,
    subtypeMismatch,
    entityMismatch,
    taskMismatch,
    priorityMismatch,
  });

  const comparableFieldCount = countComparable([
    semantic.contentBusinessProbability,
    semantic.subjectBusinessProbability,
    semantic.signatureCompanyMatchConfidence,
    semantic.jobReferenceConfidence,
    semantic.containsActionRequest,
    semantic.hasExplicitDeadline,
    semantic.deadlineUrgency,
    routing.mailboxCategory,
    routing.decisionRule,
    businessSubtype.businessType,
    businessSubtype.businessTypeConfidence,
    entities.selectedCustomerId,
    entities.selectedVendorId,
    entities.selectedJobId,
    entities.entityMatchConfidence,
    priority.priority,
    priority.rule,
    tasks.taskCount,
  ]);

  // approvedJobAliasCount: re-query read-only (no writes)
  const approvedJobAliasCount = await candidatesService
    .listApprovedJobAliases(message.workspaceId)
    .then((rows) => rows.length)
    .catch(() => 0);

  return {
    messageId: message.id,
    workspaceId: message.workspaceId,
    mailboxEmail,
    readOnly: true,
    dbWrites: false,
    diagnostics,
    n8nHistorical,
    native,
    candidateDiagnostics: {
      candidateLookupFailed: native.candidateLookupFailed,
      knownSender: native.candidates?.knownSender ?? null,
      senderEvidenceStatus: native.candidates?.senderEvidence?.status ?? null,
      customerCandidateCount: native.candidates?.customerCandidates.length ?? 0,
      vendorCandidateCount: native.candidates?.vendorCandidates.length ?? 0,
      jobCandidateCount: native.candidates?.jobCandidates.length ?? 0,
      approvedJobAliasCount,
    },
    comparisons: {
      semantic,
      routing,
      businessSubtype,
      entities,
      tasks,
      priority,
      summary,
    },
    overall: {
      categoryMatches,
      decisionRuleMatches,
      comparableFieldCount,
      unavailableHistoricalFields: n8nHistorical.unavailableFields,
      hasMeaningfulComparisonBasis: n8nHistorical.hasMeaningfulComparisonBasis,
    },
    openai: {
      semanticModel,
      subtypeModel,
      entityModel,
      taskModel,
      api: "responses.create",
      maxOutputTokens: 1500,
      temperature: null,
      tools: null,
      textFormat: "json_object",
      n8nModelNameStored: classification?.modelName ?? null,
      n8nModelVersionStored: classification?.modelVersion ?? null,
      note:
        "Complete read-only pipeline parity. selectedJobId compared against rawAiPayload.selectedJobId only (Classification.jobId is JobMatcher). Priority MEDIUM↔NORMAL mapped for comparison.",
    },
  };
}
