import type {
  BusinessSubtypeResult,
  EntitySelectionResult,
  OpenAIBusinessSubtypeClassifier,
  OpenAIEntitySelector,
  OpenAISemanticSignalExtractor,
  OpenAITaskExtractor,
  SemanticSignals,
  TaskExtractionResult,
} from "@forgeops/ai";
import {
  applyConfirmedJobAssociationOverride,
  decideMailboxCategoryFlagsCumulative,
  decideMailboxPriority,
  type ConfirmedWorkspaceJob,
  type FlagsCumulativeClassifierResult,
  type PriorityDecisionPayload,
  type N8nPriority,
} from "@forgeops/shared";

import {
  ClassificationCandidatesService,
  type ClassificationCandidatesResult,
} from "./classification-candidates-service.js";

/** Complete native classification pipeline (read-only until a persistence layer writes). */
export interface NativeClassificationPipelineInput {
  workspaceId: string;
  mailboxEmail: string;
  normalizedSubject?: string | null | undefined;
  subject?: string | null | undefined;
  cleanBody?: string | null | undefined;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  attachmentNames?: string[] | null | undefined;
  candidateLookupFailed?: boolean | undefined;
  /**
   * Pre-existing EmailMessage.jobId resolved to a valid same-workspace Job.
   * Applied after flags B/P so PERSONAL cannot skip job stages when a real job is attached.
   */
  confirmedJobAssociation?: ConfirmedWorkspaceJob | null | undefined;
}

export type NativePriorityDecision = PriorityDecisionPayload & {
  priority: N8nPriority;
};

export interface NativeClassificationPipelineResult {
  candidates: ClassificationCandidatesResult | null;
  candidateLookupFailed: boolean;
  semanticSignals: SemanticSignals;
  mailboxDecision: FlagsCumulativeClassifierResult;
  businessSubtype: BusinessSubtypeResult | null;
  entities: EntitySelectionResult | null;
  tasks: TaskExtractionResult["tasks"];
  priorityDecision: NativePriorityDecision;
  /** Stages intentionally skipped for PERSONAL (or other gates). */
  skippedStages: string[];
  /** True when an existing confirmed job forced PERSONAL → BUSINESS. */
  confirmedJobForcedBusiness: boolean;
}

export interface NativeClassificationPipelineDeps {
  candidatesService: ClassificationCandidatesService;
  semanticSignalExtractor: OpenAISemanticSignalExtractor;
  businessSubtypeClassifier: OpenAIBusinessSubtypeClassifier;
  entitySelector: OpenAIEntitySelector;
  taskExtractor: OpenAITaskExtractor;
}

/**
 * Complete read-only native classification pipeline.
 * Does NOT write EmailMessage, Classification, tasks, jobs, or any production data.
 */
export async function runNativeClassificationPipeline(
  input: NativeClassificationPipelineInput,
  deps: NativeClassificationPipelineDeps
): Promise<NativeClassificationPipelineResult> {
  const normalizedSubject =
    (input.normalizedSubject && input.normalizedSubject.trim()) ||
    (input.subject ?? "");
  const cleanBody = input.cleanBody ?? "";
  const attachmentNames = input.attachmentNames ?? [];
  const skippedStages: string[] = [];

  let candidates: ClassificationCandidatesResult | null = null;
  let candidateLookupFailed = input.candidateLookupFailed === true;
  let approvedJobAliases: Array<{
    jobId: string;
    alias: string;
    normalizedAlias: string;
  }> = [];

  if (!candidateLookupFailed) {
    try {
      candidates = await deps.candidatesService.getCandidates({
        workspaceId: input.workspaceId,
        mailboxEmail: input.mailboxEmail,
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        senderDomain: input.senderDomain ?? undefined,
        subject: input.subject ?? normalizedSubject,
        cleanBody,
        attachmentNames,
      });
      approvedJobAliases =
        await deps.candidatesService.listApprovedJobAliases(input.workspaceId);
    } catch {
      candidateLookupFailed = true;
      candidates = null;
      approvedJobAliases = [];
    }
  }

  const semanticSignals = await deps.semanticSignalExtractor.extract({
    normalizedSubject,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    senderDomain: input.senderDomain,
    cleanBody,
    attachmentNames,
    senderEvidence: candidates?.senderEvidence ?? null,
    domainEvidence: candidates?.domainEvidence ?? null,
    knownSender: candidates?.knownSender ?? false,
    customerCandidates: candidates?.customerCandidates ?? [],
    vendorCandidates: candidates?.vendorCandidates ?? [],
    jobCandidates: candidates?.jobCandidates ?? [],
    approvedJobAliases,
    classificationInstructions: candidates?.classificationInstructions ?? [],
    candidateLookupFailed,
  });

  let mailboxDecision = decideMailboxCategoryFlagsCumulative({
    contentBusinessProbability: semanticSignals.contentBusinessProbability,
    subjectBusinessProbability: semanticSignals.subjectBusinessProbability,
    jobReferenceConfidence: semanticSignals.jobReferenceConfidence,
    signatureCompanyMatchConfidence:
      semanticSignals.signatureCompanyMatchConfidence,
    senderStatus: candidates?.senderEvidence?.status ?? "UNKNOWN",
    senderConfidence: candidates?.senderEvidence?.confidence ?? null,
    contentExplanation: semanticSignals.signalExplanations.content,
    subjectExplanation: semanticSignals.signalExplanations.subject,
    jobExplanation: semanticSignals.signalExplanations.job,
    signatureExplanation: semanticSignals.signalExplanations.signature,
  });

  let confirmedJobForcedBusiness = false;
  if (input.confirmedJobAssociation) {
    const overridden = applyConfirmedJobAssociationOverride(
      mailboxDecision,
      input.confirmedJobAssociation,
      "existing_message_job"
    );
    confirmedJobForcedBusiness = overridden.overridden;
    mailboxDecision = overridden;
  }

  let businessSubtype: BusinessSubtypeResult | null = null;
  let entities: EntitySelectionResult | null = null;
  let tasks: TaskExtractionResult["tasks"] = [];

  if (mailboxDecision.mailboxCategory === "PERSONAL") {
    skippedStages.push(
      "businessSubtype",
      "entitySelection",
      "taskExtraction"
    );
  } else {
    businessSubtype = await deps.businessSubtypeClassifier.classify({
      normalizedSubject,
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      senderDomain: input.senderDomain,
      cleanBody,
      attachmentNames,
      activeBusinessTypes: candidates?.activeBusinessTypes ?? [],
      summary: semanticSignals.summary,
    });

    entities = await deps.entitySelector.select({
      normalizedSubject,
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      senderDomain: input.senderDomain,
      cleanBody,
      attachmentNames,
      summary: semanticSignals.summary,
      customerCandidates: candidates?.customerCandidates ?? [],
      vendorCandidates: candidates?.vendorCandidates ?? [],
      jobCandidates: candidates?.jobCandidates ?? [],
      candidateLookupFailed,
    });

    if (!semanticSignals.containsActionRequest) {
      skippedStages.push("taskExtractionModelCall");
      tasks = [];
    } else {
      const taskResult = await deps.taskExtractor.extract({
        normalizedSubject,
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        senderDomain: input.senderDomain,
        cleanBody,
        attachmentNames,
        summary: semanticSignals.summary,
        containsActionRequest: semanticSignals.containsActionRequest,
      });
      tasks = taskResult.tasks;
    }
  }

  // Deterministic priority — never overwritten by subtype/entity/task models.
  const priorityDecision = decideMailboxPriority({
    jobReferenceConfidence: semanticSignals.jobReferenceConfidence,
    containsActionRequest: semanticSignals.containsActionRequest,
    hasExplicitDeadline: semanticSignals.hasExplicitDeadline,
    deadlineUrgency: semanticSignals.deadlineUrgency,
  });

  return {
    candidates,
    candidateLookupFailed,
    semanticSignals,
    mailboxDecision,
    businessSubtype,
    entities,
    tasks,
    priorityDecision,
    skippedStages,
    confirmedJobForcedBusiness,
  };
}
