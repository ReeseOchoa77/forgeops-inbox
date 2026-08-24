import type {
  OpenAISemanticSignalExtractor,
  SemanticSignals,
} from "@forgeops/ai";
import {
  decideMailboxCategoryFlagsCumulative,
  type FlagsCumulativeClassifierResult,
} from "@forgeops/shared";

import {
  ClassificationCandidatesService,
  type ClassificationCandidatesResult,
} from "./classification-candidates-service.js";

export interface NativeClassificationFoundationInput {
  workspaceId: string;
  mailboxEmail: string;
  /** Prefer normalized subject when available (n8n uses normalizedSubject || subject). */
  normalizedSubject?: string | null | undefined;
  subject?: string | null | undefined;
  cleanBody?: string | null | undefined;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  attachmentNames?: string[] | null | undefined;
  /**
   * When true, mirrors n8n candidateLookupFailed (candidates unavailable).
   * Defaults to false after a successful candidates load.
   */
  candidateLookupFailed?: boolean | undefined;
}

export interface NativeClassificationFoundationResult {
  candidates: ClassificationCandidatesResult | null;
  semanticSignals: SemanticSignals;
  decision: FlagsCumulativeClassifierResult;
}

/**
 * Read-only native classification foundation:
 * candidates → AI semantic signals → deterministic BUSINESS/PERSONAL.
 *
 * Does NOT write EmailMessage, Classification, tasks, jobs, or any production data.
 */
export async function runNativeClassificationFoundation(
  input: NativeClassificationFoundationInput,
  deps: {
    candidatesService: ClassificationCandidatesService;
    semanticSignalExtractor: OpenAISemanticSignalExtractor;
  }
): Promise<NativeClassificationFoundationResult> {
  const normalizedSubject =
    (input.normalizedSubject && input.normalizedSubject.trim()) ||
    (input.subject ?? "");

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
        cleanBody: input.cleanBody,
        attachmentNames: input.attachmentNames,
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
    cleanBody: input.cleanBody ?? "",
    attachmentNames: input.attachmentNames ?? [],
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

  const decision = decideMailboxCategoryFlagsCumulative({
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

  return { candidates, semanticSignals, decision };
}
