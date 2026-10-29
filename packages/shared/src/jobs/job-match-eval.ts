import type { JobAliasForMatch, JobMatchResult, JobRecordForMatch } from "./job-matcher.js";
import type { JobContactHit } from "./job-contact-marker.js";
import type { JobThreadHit } from "./job-thread-marker.js";
import { runJobMatchPipeline } from "./job-match-pipeline.js";

export type JobMatchEvalCase = {
  id: string;
  subject: string;
  cleanBody?: string;
  jobs: JobRecordForMatch[];
  aliases?: JobAliasForMatch[];
  senderEmail?: string | null;
  inboxConnectionId?: string | null;
  providerThreadId?: string | null;
  expectedDecision: "MATCH" | "AMBIGUOUS" | "NO_MATCH" | "CONFLICT";
  expectedJobId?: string | null;
  expectedCandidateJobIds?: string[];
  contactJobIds?: string[];
  contactHits?: JobContactHit[];
  threadJobIds?: string[];
  threadHits?: JobThreadHit[];
};

export type JobMatchEvalFailure = {
  id: string;
  expectedDecision: string;
  actualDecision: string;
  expectedJobId: string | null;
  actualJobId: string | null;
  marker1Candidates: string[];
  afterMarker2: string[];
  afterMarker3: string[];
  finalDecision: string;
};

export type JobMatchEvalReport = {
  total: number;
  correct: number;
  accuracy: number;
  correctMatch: number;
  incorrectMatch: number;
  ambiguous: number;
  conflict: number;
  noMatch: number;
  precision: number;
  decisionCoverage: number;
  correctCoverage: number;
  falseMatchRate: number;
  ambiguityRate: number;
  conflictRate: number;
  noMatchRate: number;
  marker1UniqueStrongMatches: number;
  marker1AmbiguousSets: number;
  marker1NoMatch: number;
  avgMarker1CandidateCount: number;
  avgAfterMarker2: number | null;
  avgAfterMarker3: number | null;
  marker2UniqueResolutions: number;
  marker3UniqueResolutions: number;
  narrowedByMarker2: number;
  narrowedByMarker3: number;
  signalConflicts: number;
  incorrectNarrowing: number;
  failures: JobMatchEvalFailure[];
};

function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

function sameIdSet(a: string[] | undefined, b: string[]): boolean {
  if (!a) return true;
  return sorted(a).join(",") === sorted(b).join(",");
}

function traceIds(
  result: JobMatchResult,
  marker: "NAME" | "CONTACT" | "THREAD"
): string[] | null {
  const row = result.markerTrace?.find((t) => t.marker === marker);
  return row ? row.candidateJobIds : null;
}

function hitsFromIds(
  ids: string[] | undefined,
  kind: "contact" | "thread"
): JobContactHit[] | JobThreadHit[] | undefined {
  if (!ids) return undefined;
  if (kind === "contact") {
    return ids.map((jobId) => ({
      jobId,
      basis: "CURRENT_AUTHORITATIVE_EMAIL" as const,
    }));
  }
  return ids.map((jobId) => ({ jobId, supportingEmailIds: [] }));
}

/**
 * Score deterministic Job-match cases. Does not call a model.
 */
export function evaluateJobMatchCases(
  cases: JobMatchEvalCase[]
): JobMatchEvalReport {
  let correct = 0;
  let uniqueStrong = 0;
  let marker1Ambiguous = 0;
  let marker1NoMatch = 0;
  let marker1CandidateSum = 0;
  let after2Sum = 0;
  let after2Count = 0;
  let after3Sum = 0;
  let after3Count = 0;
  let narrowed2 = 0;
  let narrowed3 = 0;
  let unique2 = 0;
  let unique3 = 0;
  let conflicts = 0;
  let incorrectNarrowing = 0;
  let correctMatch = 0;
  let incorrectMatch = 0;
  let ambiguous = 0;
  let conflict = 0;
  let noMatch = 0;
  const failures: JobMatchEvalFailure[] = [];

  for (const row of cases) {
    const contactHits =
      row.contactHits ??
      (hitsFromIds(row.contactJobIds, "contact") as JobContactHit[] | undefined);
    const threadHits =
      row.threadHits ??
      (hitsFromIds(row.threadJobIds, "thread") as JobThreadHit[] | undefined);

    const result = runJobMatchPipeline({
      subject: row.subject,
      cleanBody: row.cleanBody ?? "",
      jobs: row.jobs,
      aliases: row.aliases ?? [],
      senderEmail: row.senderEmail ?? "eval@example.com",
      inboxConnectionId: row.inboxConnectionId ?? "conn-eval",
      providerThreadId: row.providerThreadId ?? "thread-eval",
      contactHits,
      threadHits,
    });

    const nameIds = traceIds(result, "NAME") ?? [];
    const after2 = traceIds(result, "CONTACT") ?? nameIds;
    const after3 = traceIds(result, "THREAD") ?? after2;
    marker1CandidateSum += nameIds.length;

    const nameStatus = result.markerTrace?.find((t) => t.marker === "NAME")?.status;
    if (nameStatus === "MATCH") uniqueStrong += 1;
    else if (nameStatus === "AMBIGUOUS") marker1Ambiguous += 1;
    else marker1NoMatch += 1;

    if (result.markerTrace?.some((t) => t.marker === "CONTACT")) {
      after2Sum += after2.length;
      after2Count += 1;
      if (nameIds.length > after2.length) narrowed2 += 1;
      const contactStatus = result.markerTrace.find((t) => t.marker === "CONTACT")?.status;
      if (nameStatus !== "MATCH" && contactStatus === "MATCH") unique2 += 1;
    }
    if (result.markerTrace?.some((t) => t.marker === "THREAD")) {
      after3Sum += after3.length;
      after3Count += 1;
      if (after2.length > after3.length) narrowed3 += 1;
      const threadStatus = result.markerTrace.find((t) => t.marker === "THREAD")?.status;
      const contactStatus = result.markerTrace.find((t) => t.marker === "CONTACT")?.status;
      if (contactStatus !== "MATCH" && threadStatus === "MATCH") unique3 += 1;
      if (threadStatus === "CONFLICT") conflicts += 1;
    }

    const actualDecision = result.decision ?? "NO_MATCH";
    const actualJobId = result.selectedJobId;
    if (actualDecision === "MATCH") {
      if (row.expectedJobId && actualJobId === row.expectedJobId) correctMatch += 1;
      else if (row.expectedDecision === "MATCH" && row.expectedJobId === undefined) {
        correctMatch += 1;
      } else if (row.expectedDecision === "MATCH" && actualJobId === (row.expectedJobId ?? null)) {
        correctMatch += 1;
      } else incorrectMatch += 1;
    } else if (actualDecision === "AMBIGUOUS") ambiguous += 1;
    else if (actualDecision === "CONFLICT") conflict += 1;
    else noMatch += 1;

    const okDecision = actualDecision === row.expectedDecision;
    const okJob =
      row.expectedJobId === undefined ||
      (row.expectedJobId ?? null) === (actualJobId ?? null);
    const finalIds = result.candidateJobIds ?? result.ambiguousCandidateIds;
    const okSet = sameIdSet(row.expectedCandidateJobIds, finalIds);
    const ok = okDecision && okJob && okSet;
    if (ok) correct += 1;
    else {
      if (
        row.expectedCandidateJobIds &&
        !sameIdSet(row.expectedCandidateJobIds, finalIds)
      ) {
        incorrectNarrowing += 1;
      }
      failures.push({
        id: row.id,
        expectedDecision: row.expectedDecision,
        actualDecision,
        expectedJobId: row.expectedJobId ?? null,
        actualJobId: actualJobId ?? null,
        marker1Candidates: nameIds,
        afterMarker2: after2,
        afterMarker3: after3,
        finalDecision: actualDecision,
      });
    }
  }

  const total = cases.length;
  const matchDecisions = correctMatch + incorrectMatch;
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    correctMatch,
    incorrectMatch,
    ambiguous,
    conflict,
    noMatch,
    precision: matchDecisions === 0 ? 0 : correctMatch / matchDecisions,
    decisionCoverage: total === 0 ? 0 : matchDecisions / total,
    correctCoverage: total === 0 ? 0 : correctMatch / total,
    falseMatchRate: total === 0 ? 0 : incorrectMatch / total,
    ambiguityRate: total === 0 ? 0 : ambiguous / total,
    conflictRate: total === 0 ? 0 : conflict / total,
    noMatchRate: total === 0 ? 0 : noMatch / total,
    marker1UniqueStrongMatches: uniqueStrong,
    marker1AmbiguousSets: marker1Ambiguous,
    marker1NoMatch,
    avgMarker1CandidateCount: total === 0 ? 0 : marker1CandidateSum / total,
    avgAfterMarker2: after2Count === 0 ? null : after2Sum / after2Count,
    avgAfterMarker3: after3Count === 0 ? null : after3Sum / after3Count,
    marker2UniqueResolutions: unique2,
    marker3UniqueResolutions: unique3,
    narrowedByMarker2: narrowed2,
    narrowedByMarker3: narrowed3,
    signalConflicts: conflicts,
    incorrectNarrowing,
    failures,
  };
}

export type JobMatchGroundTruthRow = {
  id: string;
  subject: string | null;
  senderEmail: string | null;
  trueJobId: string;
  result: JobMatchResult;
};

export type JobMatchGroundTruthFailure = {
  emailMessageId: string;
  subject: string | null;
  sender: string | null;
  trueJobId: string;
  marker1Candidates: string[];
  marker2Candidates: string[];
  marker3Candidates: string[];
  finalDecision: string;
  selectedJobId: string | null;
  evidenceSummary: string[];
};

export function scoreJobMatchGroundTruth(
  rows: JobMatchGroundTruthRow[]
): JobMatchEvalReport & { representativeFailures: JobMatchGroundTruthFailure[] } {
  let correctMatch = 0;
  let incorrectMatch = 0;
  let ambiguous = 0;
  let conflict = 0;
  let noMatch = 0;
  let uniqueStrong = 0;
  let marker1Ambiguous = 0;
  let marker1NoMatch = 0;
  let marker1CandidateSum = 0;
  let after2Sum = 0;
  let after2Count = 0;
  let after3Sum = 0;
  let after3Count = 0;
  let narrowed2 = 0;
  let narrowed3 = 0;
  let unique2 = 0;
  let unique3 = 0;
  let conflicts = 0;
  const representativeFailures: JobMatchGroundTruthFailure[] = [];

  for (const row of rows) {
    const result = row.result;
    const nameIds = traceIds(result, "NAME") ?? [];
    const after2 = traceIds(result, "CONTACT") ?? nameIds;
    const after3 = traceIds(result, "THREAD") ?? after2;
    marker1CandidateSum += nameIds.length;
    const nameStatus = result.markerTrace?.find((t) => t.marker === "NAME")?.status;
    if (nameStatus === "MATCH") uniqueStrong += 1;
    else if (nameStatus === "AMBIGUOUS") marker1Ambiguous += 1;
    else marker1NoMatch += 1;

    if (result.markerTrace?.some((t) => t.marker === "CONTACT")) {
      after2Sum += after2.length;
      after2Count += 1;
      if (nameIds.length > after2.length) narrowed2 += 1;
      const contactStatus = result.markerTrace.find((t) => t.marker === "CONTACT")?.status;
      if (nameStatus !== "MATCH" && contactStatus === "MATCH") unique2 += 1;
    }
    if (result.markerTrace?.some((t) => t.marker === "THREAD")) {
      after3Sum += after3.length;
      after3Count += 1;
      if (after2.length > after3.length) narrowed3 += 1;
      const threadStatus = result.markerTrace.find((t) => t.marker === "THREAD")?.status;
      const contactStatus = result.markerTrace.find((t) => t.marker === "CONTACT")?.status;
      if (contactStatus !== "MATCH" && threadStatus === "MATCH") unique3 += 1;
      if (threadStatus === "CONFLICT") conflicts += 1;
    }

    const decision = result.decision ?? "NO_MATCH";
    if (decision === "MATCH" && result.selectedJobId === row.trueJobId) {
      correctMatch += 1;
    } else if (decision === "MATCH") {
      incorrectMatch += 1;
    } else if (decision === "AMBIGUOUS") ambiguous += 1;
    else if (decision === "CONFLICT") conflict += 1;
    else noMatch += 1;

    const isFailure =
      decision !== "MATCH" || result.selectedJobId !== row.trueJobId;
    if (isFailure && representativeFailures.length < 15) {
      representativeFailures.push({
        emailMessageId: row.id,
        subject: row.subject,
        sender: row.senderEmail,
        trueJobId: row.trueJobId,
        marker1Candidates: nameIds,
        marker2Candidates: after2,
        marker3Candidates: after3,
        finalDecision: decision,
        selectedJobId: result.selectedJobId,
        evidenceSummary: result.evidence.map((e) => `${e.type}:${e.value}`).slice(0, 8),
      });
    }
  }

  const total = rows.length;
  const matchDecisions = correctMatch + incorrectMatch;
  const correct = correctMatch;
  return {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    correctMatch,
    incorrectMatch,
    ambiguous,
    conflict,
    noMatch,
    precision: matchDecisions === 0 ? 0 : correctMatch / matchDecisions,
    decisionCoverage: total === 0 ? 0 : matchDecisions / total,
    correctCoverage: total === 0 ? 0 : correctMatch / total,
    falseMatchRate: total === 0 ? 0 : incorrectMatch / total,
    ambiguityRate: total === 0 ? 0 : ambiguous / total,
    conflictRate: total === 0 ? 0 : conflict / total,
    noMatchRate: total === 0 ? 0 : noMatch / total,
    marker1UniqueStrongMatches: uniqueStrong,
    marker1AmbiguousSets: marker1Ambiguous,
    marker1NoMatch,
    avgMarker1CandidateCount: total === 0 ? 0 : marker1CandidateSum / total,
    avgAfterMarker2: after2Count === 0 ? null : after2Sum / after2Count,
    avgAfterMarker3: after3Count === 0 ? null : after3Sum / after3Count,
    marker2UniqueResolutions: unique2,
    marker3UniqueResolutions: unique3,
    narrowedByMarker2: narrowed2,
    narrowedByMarker3: narrowed3,
    signalConflicts: conflicts,
    incorrectNarrowing: 0,
    failures: [],
    representativeFailures,
  };
}
