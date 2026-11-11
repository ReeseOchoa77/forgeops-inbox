/**
 * Deterministic Job Matcher evaluation diagnostics.
 * Derived ONLY from matcher execution traces + ground-truth comparison.
 * Never feeds ground truth into the matcher.
 */

import type { HistoricalEvalOutcome, HistoricalEvalResolvingMarker } from "./job-match-historical-eval.js";

export type EvalDiagRowInput = {
  emailMessageId: string;
  subject: string | null;
  direction: string | null;
  trueJobId: string;
  trueJobName: string;
  trueJobNumber: string | null;
  jobAssignmentSource: string | null;
  predictedJobId: string | null;
  predictedJobName: string | null;
  predictedJobNumber: string | null;
  decision: string;
  outcome: string;
  resolvingMarker: string | null;
  evidence: Array<{ type: string; value: string }>;
  markerTrace: Array<{
    marker: string;
    status: string;
    candidateJobIds: string[];
    candidateJobNames: string[];
  }>;
};

/** Exclusive failure category for WRONG unique MATCH decisions. */
export type EvalFailureCategory =
  | "PROJECT_IDENTITY"
  | "CONTACT"
  | "THREAD"
  | "MULTI_MARKER_INTERACTION"
  | "OTHER_DETERMINISTIC";

/**
 * Canonical Marker 1 evidence family (from live NAME marker types only).
 * SUBJECT_* / CONTENT_* collapse into one family for diagnostics.
 */
export type ProjectIdentityEvidenceFamily =
  | "JOB_NAME"
  | "ENTITY_ALIAS"
  | "SITE_NAME"
  | "EXTERNAL_REF"
  | "OTHER_IDENTITY";

export type EvalMarkerId = "NAME" | "CONTACT" | "THREAD";

export type EvalRowDiagnostics = {
  failureCategory: EvalFailureCategory | null;
  failureSubcategory: ProjectIdentityEvidenceFamily | null;
  resolvingMarker: HistoricalEvalResolvingMarker | null;
  contributingMarkers: EvalMarkerId[];
  resolvingEvidenceType: string | null;
  resolvingEvidenceFamily: ProjectIdentityEvidenceFamily | null;
  candidateCountBeforeResolving: number | null;
  candidateCountAfterResolving: number | null;
  groundTruthSurvivedMarker1: boolean | null;
  groundTruthSurvivedMarker2: boolean | null;
  groundTruthSurvivedMarker3: boolean | null;
  firstGroundTruthLossStage: EvalMarkerId | "NEVER_PRESENT" | "NEVER_LOST" | null;
  marker1CandidateCount: number | null;
  marker2CandidateCount: number | null;
  marker3CandidateCount: number | null;
};

export type EvalCountPct = { count: number; pct: number };

export type JobMatcherEvalDiagnostics = {
  definitions: {
    failureCategory:
      "Exclusive among WRONG unique MATCH rows. MULTI_MARKER_INTERACTION when >1 marker contributed before resolution; else resolving marker family.";
    resolvingMarker: "First marker with status=MATCH on the execution trace (NAME→CONTACT→THREAD).";
    contributingMarkers: "Markers that ran with MATCH status or that narrowed the candidate set.";
    groundTruthSurvival: "trueJobId ∈ after-stage candidateJobIds for that marker (evaluation overlay only).";
    markerPrecision: "Correct / (Correct + Wrong) among unique MATCH rows resolved by that marker.";
    candidateCountAfterResolving: "Length of markerTrace entry for the resolving marker (after-stage set).";
  };
  wrongMatchCount: number;
  wrongByFailureCategory: Array<{
    category: EvalFailureCategory;
    count: number;
    pct: number;
  }>;
  wrongByResolvingMarker: Array<{
    marker: HistoricalEvalResolvingMarker | "NONE";
    count: number;
    pct: number;
  }>;
  wrongProjectIdentityByEvidence: Array<{
    family: ProjectIdentityEvidenceFamily;
    count: number;
    pct: number;
  }>;
  /** Evidence value occurrences among PROJECT_IDENTITY wrong matches (not exclusive). */
  evidenceCollisions: Array<{ value: string; evidenceType: string; count: number }>;
  markerPerformance: Array<{
    marker: EvalMarkerId;
    resolved: number;
    correct: number;
    wrong: number;
    precision: number | null;
  }>;
  groundTruthSurvival: {
    afterMarker1: EvalCountPct & { applicable: number };
    afterMarker2: EvalCountPct & { applicable: number };
    afterMarker3: EvalCountPct & { applicable: number };
  };
  firstGroundTruthLoss: Array<{
    stage: EvalMarkerId | "NEVER_PRESENT" | "NEVER_LOST";
    count: number;
  }>;
  candidateBucketsAfterResolving: Array<{
    bucket: "1" | "2-3" | "4-5" | "6-10" | "10+";
    count: number;
  }>;
  commonConfusions: Array<{
    actualJobId: string;
    actualJobName: string;
    actualJobNumber: string | null;
    predictedJobId: string;
    predictedJobName: string;
    predictedJobNumber: string | null;
    count: number;
  }>;
  jobDiagnostics: Array<{
    jobId: string;
    jobNumber: string | null;
    jobName: string;
    evaluated: number;
    correct: number;
    wrong: number;
    ambiguous: number;
    conflict: number;
    noMatch: number;
    precision: number | null;
    primaryFailureCategory: EvalFailureCategory | null;
  }>;
};

const NAME_EVIDENCE_TYPES = new Set([
  "SUBJECT_JOB_NAME",
  "CONTENT_JOB_NAME",
  "SUBJECT_JOB_ALIAS",
  "CONTENT_JOB_ALIAS",
  "SUBJECT_JOB_SITE",
  "CONTENT_JOB_SITE",
  "SUBJECT_JOB_EXTERNAL_REF",
  "CONTENT_JOB_EXTERNAL_REF",
]);

export function projectIdentityFamilyForEvidenceType(
  type: string
): ProjectIdentityEvidenceFamily | null {
  if (type === "SUBJECT_JOB_NAME" || type === "CONTENT_JOB_NAME") return "JOB_NAME";
  if (type === "SUBJECT_JOB_ALIAS" || type === "CONTENT_JOB_ALIAS") return "ENTITY_ALIAS";
  if (type === "SUBJECT_JOB_SITE" || type === "CONTENT_JOB_SITE") return "SITE_NAME";
  if (type === "SUBJECT_JOB_EXTERNAL_REF" || type === "CONTENT_JOB_EXTERNAL_REF") {
    return "EXTERNAL_REF";
  }
  if (NAME_EVIDENCE_TYPES.has(type)) return "OTHER_IDENTITY";
  return null;
}

function asMarker(m: string): EvalMarkerId | null {
  if (m === "NAME" || m === "CONTACT" || m === "THREAD") return m;
  return null;
}

function traceFor(row: EvalDiagRowInput, marker: EvalMarkerId) {
  return row.markerTrace.find((t) => t.marker === marker) ?? null;
}

function survived(row: EvalDiagRowInput, marker: EvalMarkerId): boolean | null {
  const t = traceFor(row, marker);
  if (!t) return null;
  if (t.status === "MATCH") {
    // After unique MATCH, candidate set is the selected job (or empty).
    if (t.candidateJobIds.length === 1) return t.candidateJobIds[0] === row.trueJobId;
    if (row.resolvingMarker === marker && row.predictedJobId) {
      return row.predictedJobId === row.trueJobId;
    }
  }
  return t.candidateJobIds.includes(row.trueJobId);
}

export function contributingMarkersForRow(row: EvalDiagRowInput): EvalMarkerId[] {
  const out: EvalMarkerId[] = [];
  let prevCount: number | null = null;
  for (const marker of ["NAME", "CONTACT", "THREAD"] as const) {
    const t = traceFor(row, marker);
    if (!t) continue;
    const count = t.candidateJobIds.length;
    const narrowed =
      prevCount != null && count > 0 && count < prevCount && t.status !== "MATCH";
    if (t.status === "MATCH" || narrowed || (marker === "NAME" && count > 0)) {
      out.push(marker);
    }
    if (count > 0 || t.status === "MATCH") prevCount = count;
    else if (t.status !== "NO_MATCH") prevCount = count;
  }
  // Always include resolving marker if present.
  const resolving = asMarker(row.resolvingMarker ?? "");
  if (resolving && !out.includes(resolving)) out.push(resolving);
  return out;
}

function primaryNameEvidence(row: EvalDiagRowInput): {
  type: string | null;
  family: ProjectIdentityEvidenceFamily | null;
} {
  const nameEv = row.evidence.filter((e) => projectIdentityFamilyForEvidenceType(e.type));
  if (nameEv.length === 0) return { type: null, family: null };
  // Prefer subject over content; prefer NAME > ALIAS > SITE > EXTERNAL_REF order.
  const rank = (t: string) => {
    const f = projectIdentityFamilyForEvidenceType(t);
    const fam =
      f === "JOB_NAME" ? 0 : f === "ENTITY_ALIAS" ? 1 : f === "SITE_NAME" ? 2 : f === "EXTERNAL_REF" ? 3 : 4;
    const subj = t.startsWith("SUBJECT_") ? 0 : 1;
    return fam * 10 + subj;
  };
  const best = [...nameEv].sort((a, b) => rank(a.type) - rank(b.type))[0]!;
  return { type: best.type, family: projectIdentityFamilyForEvidenceType(best.type) };
}

export function failureCategoryForWrongRow(
  row: EvalDiagRowInput,
  contributing: EvalMarkerId[]
): EvalFailureCategory {
  if (row.outcome !== "WRONG_MATCH") return "OTHER_DETERMINISTIC";
  if (contributing.length > 1) return "MULTI_MARKER_INTERACTION";
  const r = row.resolvingMarker;
  if (r === "NAME") return "PROJECT_IDENTITY";
  if (r === "CONTACT") return "CONTACT";
  if (r === "THREAD") return "THREAD";
  return "OTHER_DETERMINISTIC";
}

function firstLossStage(
  row: EvalDiagRowInput
): EvalRowDiagnostics["firstGroundTruthLossStage"] {
  const s1 = survived(row, "NAME");
  const s2 = survived(row, "CONTACT");
  const s3 = survived(row, "THREAD");
  // Never present at first executed stage
  if (s1 === false) return "NAME";
  if (s1 === null && s2 === false) return "CONTACT";
  if (s1 === null && s2 === null && s3 === false) return "THREAD";
  if (s2 === false) return "CONTACT";
  if (s3 === false) return "THREAD";
  if (s1 === null && s2 === null && s3 === null) {
    // No marker left candidates containing GT — treat as never present if wrong/no match
    if (row.outcome === "CORRECT_MATCH") return "NEVER_LOST";
    return "NEVER_PRESENT";
  }
  if (row.outcome === "CORRECT_MATCH") return "NEVER_LOST";
  if (s1 === true && (s2 === true || s2 === null) && (s3 === true || s3 === null)) {
    // Survived all executed stages but still wrong (shouldn't happen for MATCH) or ambiguous
    return row.outcome === "WRONG_MATCH" ? "NEVER_LOST" : "NEVER_LOST";
  }
  return "NEVER_LOST";
}

export function buildEvalRowDiagnostics(row: EvalDiagRowInput): EvalRowDiagnostics {
  const contributing = contributingMarkersForRow(row);
  const resolving = asMarker(row.resolvingMarker ?? "");
  const nameEv = primaryNameEvidence(row);
  const resolvingTrace = resolving ? traceFor(row, resolving) : null;

  let candidateCountBefore: number | null = null;
  if (resolving === "CONTACT") {
    candidateCountBefore = traceFor(row, "NAME")?.candidateJobIds.length ?? null;
  } else if (resolving === "THREAD") {
    candidateCountBefore =
      traceFor(row, "CONTACT")?.candidateJobIds.length ??
      traceFor(row, "NAME")?.candidateJobIds.length ??
      null;
  } else if (resolving === "NAME") {
    candidateCountBefore = null; // no prior stage in trace
  }

  const failureCategory =
    row.outcome === "WRONG_MATCH" ? failureCategoryForWrongRow(row, contributing) : null;
  const failureSubcategory =
    failureCategory === "PROJECT_IDENTITY" ||
    (failureCategory === "MULTI_MARKER_INTERACTION" && resolving === "NAME")
      ? nameEv.family
      : null;

  return {
    failureCategory,
    failureSubcategory,
    resolvingMarker: resolving,
    contributingMarkers: contributing,
    resolvingEvidenceType:
      resolving === "NAME"
        ? nameEv.type
        : resolving === "CONTACT"
          ? row.evidence.find((e) => e.type === "SENDER_JOB_CONTACT")?.type ?? "SENDER_JOB_CONTACT"
          : resolving === "THREAD"
            ? row.evidence.find((e) => e.type === "THREAD_JOB_AUTHORITATIVE")?.type ??
              "THREAD_JOB_AUTHORITATIVE"
            : null,
    resolvingEvidenceFamily: resolving === "NAME" ? nameEv.family : null,
    candidateCountBeforeResolving: candidateCountBefore,
    candidateCountAfterResolving: resolvingTrace?.candidateJobIds.length ?? null,
    groundTruthSurvivedMarker1: survived(row, "NAME"),
    groundTruthSurvivedMarker2: survived(row, "CONTACT"),
    groundTruthSurvivedMarker3: survived(row, "THREAD"),
    firstGroundTruthLossStage: firstLossStage(row),
    marker1CandidateCount: traceFor(row, "NAME")?.candidateJobIds.length ?? null,
    marker2CandidateCount: traceFor(row, "CONTACT")?.candidateJobIds.length ?? null,
    marker3CandidateCount: traceFor(row, "THREAD")?.candidateJobIds.length ?? null,
  };
}

function pct(count: number, denom: number): number {
  return denom === 0 ? 0 : count / denom;
}

function bucketCount(n: number): "1" | "2-3" | "4-5" | "6-10" | "10+" {
  if (n <= 1) return "1";
  if (n <= 3) return "2-3";
  if (n <= 5) return "4-5";
  if (n <= 10) return "6-10";
  return "10+";
}

export function buildJobMatcherEvalDiagnostics(
  rows: EvalDiagRowInput[]
): {
  diagnostics: JobMatcherEvalDiagnostics;
  rowDiagnostics: Record<string, EvalRowDiagnostics>;
} {
  const rowDiagnostics: Record<string, EvalRowDiagnostics> = {};
  const enriched = rows.map((row) => {
    const d = buildEvalRowDiagnostics(row);
    rowDiagnostics[row.emailMessageId] = d;
    return { row, d };
  });

  const wrong = enriched.filter((e) => e.row.outcome === "WRONG_MATCH");
  const wrongMatchCount = wrong.length;

  const catOrder: EvalFailureCategory[] = [
    "PROJECT_IDENTITY",
    "CONTACT",
    "THREAD",
    "MULTI_MARKER_INTERACTION",
    "OTHER_DETERMINISTIC",
  ];
  const catCounts = new Map<EvalFailureCategory, number>();
  for (const c of catOrder) catCounts.set(c, 0);
  for (const { d } of wrong) {
    const c = d.failureCategory ?? "OTHER_DETERMINISTIC";
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const wrongByFailureCategory = catOrder.map((category) => ({
    category,
    count: catCounts.get(category) ?? 0,
    pct: pct(catCounts.get(category) ?? 0, wrongMatchCount),
  }));

  const markerKeys: Array<HistoricalEvalResolvingMarker | "NONE"> = [
    "NAME",
    "CONTACT",
    "THREAD",
    "NONE",
  ];
  const markerWrong = new Map<string, number>();
  for (const k of markerKeys) markerWrong.set(k, 0);
  for (const { d } of wrong) {
    const k = d.resolvingMarker ?? "NONE";
    markerWrong.set(k, (markerWrong.get(k) ?? 0) + 1);
  }
  const wrongByResolvingMarker = markerKeys.map((marker) => ({
    marker,
    count: markerWrong.get(marker) ?? 0,
    pct: pct(markerWrong.get(marker) ?? 0, wrongMatchCount),
  }));

  const piWrong = wrong.filter((e) => e.d.failureCategory === "PROJECT_IDENTITY");
  const famOrder: ProjectIdentityEvidenceFamily[] = [
    "JOB_NAME",
    "ENTITY_ALIAS",
    "SITE_NAME",
    "EXTERNAL_REF",
    "OTHER_IDENTITY",
  ];
  const famCounts = new Map<ProjectIdentityEvidenceFamily, number>();
  for (const f of famOrder) famCounts.set(f, 0);
  for (const { d } of piWrong) {
    const f = d.failureSubcategory ?? "OTHER_IDENTITY";
    famCounts.set(f, (famCounts.get(f) ?? 0) + 1);
  }
  const wrongProjectIdentityByEvidence = famOrder.map((family) => ({
    family,
    count: famCounts.get(family) ?? 0,
    pct: pct(famCounts.get(family) ?? 0, piWrong.length),
  }));

  const collisionMap = new Map<string, { value: string; evidenceType: string; count: number }>();
  for (const { row, d } of piWrong) {
    for (const e of row.evidence) {
      const fam = projectIdentityFamilyForEvidenceType(e.type);
      if (!fam) continue;
      const key = `${e.type}\0${e.value.toLowerCase()}`;
      const prev = collisionMap.get(key);
      if (prev) prev.count += 1;
      else collisionMap.set(key, { value: e.value, evidenceType: e.type, count: 1 });
    }
    void d;
  }
  const evidenceCollisions = [...collisionMap.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 40);

  const markers: EvalMarkerId[] = ["NAME", "CONTACT", "THREAD"];
  const markerPerformance = markers.map((marker) => {
    let correct = 0;
    let wrongN = 0;
    for (const { row, d } of enriched) {
      if (d.resolvingMarker !== marker) continue;
      if (row.outcome === "CORRECT_MATCH") correct += 1;
      else if (row.outcome === "WRONG_MATCH") wrongN += 1;
    }
    const resolved = correct + wrongN;
    return {
      marker,
      resolved,
      correct,
      wrong: wrongN,
      precision: resolved === 0 ? null : correct / resolved,
    };
  });

  const survivalStage = (marker: EvalMarkerId) => {
    let applicable = 0;
    let survivedN = 0;
    for (const { d } of enriched) {
      const v =
        marker === "NAME"
          ? d.groundTruthSurvivedMarker1
          : marker === "CONTACT"
            ? d.groundTruthSurvivedMarker2
            : d.groundTruthSurvivedMarker3;
      if (v == null) continue;
      applicable += 1;
      if (v) survivedN += 1;
    }
    return { count: survivedN, applicable, pct: pct(survivedN, applicable) };
  };

  const lossStages: Array<EvalMarkerId | "NEVER_PRESENT" | "NEVER_LOST"> = [
    "NAME",
    "CONTACT",
    "THREAD",
    "NEVER_PRESENT",
    "NEVER_LOST",
  ];
  const lossCounts = new Map<string, number>();
  for (const s of lossStages) lossCounts.set(s, 0);
  for (const { d } of enriched) {
    const s = d.firstGroundTruthLossStage ?? "NEVER_LOST";
    lossCounts.set(s, (lossCounts.get(s) ?? 0) + 1);
  }
  const firstGroundTruthLoss = lossStages.map((stage) => ({
    stage,
    count: lossCounts.get(stage) ?? 0,
  }));

  const bucketOrder: Array<"1" | "2-3" | "4-5" | "6-10" | "10+"> = [
    "1",
    "2-3",
    "4-5",
    "6-10",
    "10+",
  ];
  const buckets = new Map<string, number>();
  for (const b of bucketOrder) buckets.set(b, 0);
  for (const { d } of wrong) {
    const n = d.candidateCountAfterResolving;
    if (n == null) continue;
    const b = bucketCount(n);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  const candidateBucketsAfterResolving = bucketOrder.map((bucket) => ({
    bucket,
    count: buckets.get(bucket) ?? 0,
  }));

  const confusionMap = new Map<
    string,
    {
      actualJobId: string;
      actualJobName: string;
      actualJobNumber: string | null;
      predictedJobId: string;
      predictedJobName: string;
      predictedJobNumber: string | null;
      count: number;
    }
  >();
  for (const { row } of wrong) {
    if (!row.predictedJobId) continue;
    const key = `${row.trueJobId}\0${row.predictedJobId}`;
    const prev = confusionMap.get(key);
    if (prev) prev.count += 1;
    else {
      confusionMap.set(key, {
        actualJobId: row.trueJobId,
        actualJobName: row.trueJobName,
        actualJobNumber: row.trueJobNumber,
        predictedJobId: row.predictedJobId,
        predictedJobName: row.predictedJobName ?? "(unknown)",
        predictedJobNumber: row.predictedJobNumber,
        count: 1,
      });
    }
  }
  const commonConfusions = [...confusionMap.values()]
    .sort((a, b) => b.count - a.count || a.actualJobName.localeCompare(b.actualJobName))
    .slice(0, 25);

  const jobMap = new Map<
    string,
    {
      jobId: string;
      jobNumber: string | null;
      jobName: string;
      evaluated: number;
      correct: number;
      wrong: number;
      ambiguous: number;
      conflict: number;
      noMatch: number;
      failCats: Map<EvalFailureCategory, number>;
    }
  >();
  for (const { row, d } of enriched) {
    let j = jobMap.get(row.trueJobId);
    if (!j) {
      j = {
        jobId: row.trueJobId,
        jobNumber: row.trueJobNumber,
        jobName: row.trueJobName,
        evaluated: 0,
        correct: 0,
        wrong: 0,
        ambiguous: 0,
        conflict: 0,
        noMatch: 0,
        failCats: new Map(),
      };
      jobMap.set(row.trueJobId, j);
    }
    j.evaluated += 1;
    const o = row.outcome as HistoricalEvalOutcome;
    if (o === "CORRECT_MATCH") j.correct += 1;
    else if (o === "WRONG_MATCH") {
      j.wrong += 1;
      const c = d.failureCategory ?? "OTHER_DETERMINISTIC";
      j.failCats.set(c, (j.failCats.get(c) ?? 0) + 1);
    } else if (o === "AMBIGUOUS") j.ambiguous += 1;
    else if (o === "CONFLICT") j.conflict += 1;
    else j.noMatch += 1;
  }
  const jobDiagnostics = [...jobMap.values()]
    .map((j) => {
      const decided = j.correct + j.wrong;
      let primaryFailureCategory: EvalFailureCategory | null = null;
      let best = 0;
      for (const [c, n] of j.failCats) {
        if (n > best) {
          best = n;
          primaryFailureCategory = c;
        }
      }
      return {
        jobId: j.jobId,
        jobNumber: j.jobNumber,
        jobName: j.jobName,
        evaluated: j.evaluated,
        correct: j.correct,
        wrong: j.wrong,
        ambiguous: j.ambiguous,
        conflict: j.conflict,
        noMatch: j.noMatch,
        precision: decided === 0 ? null : j.correct / decided,
        primaryFailureCategory: j.wrong > 0 ? primaryFailureCategory : null,
      };
    })
    .sort((a, b) => b.wrong - a.wrong || b.evaluated - a.evaluated);

  const diagnostics: JobMatcherEvalDiagnostics = {
    definitions: {
      failureCategory:
        "Exclusive among WRONG unique MATCH rows. MULTI_MARKER_INTERACTION when >1 marker contributed before resolution; else resolving marker family.",
      resolvingMarker:
        "First marker with status=MATCH on the execution trace (NAME→CONTACT→THREAD).",
      contributingMarkers:
        "Markers that ran with MATCH status or that narrowed the candidate set.",
      groundTruthSurvival:
        "trueJobId ∈ after-stage candidateJobIds for that marker (evaluation overlay only).",
      markerPrecision:
        "Correct / (Correct + Wrong) among unique MATCH rows resolved by that marker.",
      candidateCountAfterResolving:
        "Length of markerTrace entry for the resolving marker (after-stage set).",
    },
    wrongMatchCount,
    wrongByFailureCategory,
    wrongByResolvingMarker,
    wrongProjectIdentityByEvidence,
    evidenceCollisions,
    markerPerformance,
    groundTruthSurvival: {
      afterMarker1: survivalStage("NAME"),
      afterMarker2: survivalStage("CONTACT"),
      afterMarker3: survivalStage("THREAD"),
    },
    firstGroundTruthLoss,
    candidateBucketsAfterResolving,
    commonConfusions,
    jobDiagnostics,
  };

  return { diagnostics, rowDiagnostics };
}

/** CSV cell escape */
export function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildJobMatcherEvalDetailedCsv(
  rows: EvalDiagRowInput[],
  rowDiagnostics: Record<string, EvalRowDiagnostics>
): string {
  const headers = [
    "email_message_id",
    "direction",
    "subject",
    "ground_truth_job_id",
    "ground_truth_job_number",
    "ground_truth_job_name",
    "ground_truth_assignment_source",
    "predicted_job_id",
    "predicted_job_number",
    "predicted_job_name",
    "decision",
    "outcome",
    "failure_category",
    "failure_subcategory",
    "resolving_marker",
    "contributing_markers",
    "resolving_evidence_type",
    "candidate_count_before_resolving_marker",
    "candidate_count_after_resolving_marker",
    "ground_truth_survived_marker_1",
    "ground_truth_survived_marker_2",
    "ground_truth_survived_marker_3",
    "first_ground_truth_loss_stage",
    "marker_1_evidence_summary",
    "marker_2_evidence_summary",
    "marker_3_evidence_summary",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const d = rowDiagnostics[row.emailMessageId] ?? buildEvalRowDiagnostics(row);
    const evSummary = (prefix: string) =>
      row.evidence
        .filter((e) => e.type.includes(prefix) || (prefix === "NAME" && projectIdentityFamilyForEvidenceType(e.type)))
        .map((e) => `${e.type}:${e.value}`)
        .join("; ")
        .slice(0, 500);
    const nameSummary = row.evidence
      .filter((e) => projectIdentityFamilyForEvidenceType(e.type))
      .map((e) => `${e.type}:${e.value}`)
      .join("; ")
      .slice(0, 500);
    const contactSummary = row.evidence
      .filter((e) => e.type === "SENDER_JOB_CONTACT")
      .map((e) => `${e.type}:${e.value}`)
      .join("; ")
      .slice(0, 500);
    const threadSummary = row.evidence
      .filter((e) => e.type.startsWith("THREAD_"))
      .map((e) => `${e.type}:${e.value}`)
      .join("; ")
      .slice(0, 500);
    void evSummary;
    lines.push(
      [
        row.emailMessageId,
        row.direction,
        row.subject,
        row.trueJobId,
        row.trueJobNumber,
        row.trueJobName,
        row.jobAssignmentSource,
        row.predictedJobId,
        row.predictedJobNumber,
        row.predictedJobName,
        row.decision,
        row.outcome,
        d.failureCategory,
        d.failureSubcategory,
        d.resolvingMarker,
        d.contributingMarkers.join("|"),
        d.resolvingEvidenceType,
        d.candidateCountBeforeResolving,
        d.candidateCountAfterResolving,
        d.groundTruthSurvivedMarker1,
        d.groundTruthSurvivedMarker2,
        d.groundTruthSurvivedMarker3,
        d.firstGroundTruthLossStage,
        nameSummary,
        contactSummary,
        threadSummary,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function buildJobMatcherEvalSummaryCsv(
  diagnostics: JobMatcherEvalDiagnostics,
  headline: {
    evaluated: number;
    correct: number;
    wrong: number;
    ambiguous: number;
    conflict: number;
    noMatch: number;
    precision: number | null;
    coverage: number;
    wrongRate: number;
    ambiguityRate: number;
    conflictRate: number;
    noMatchRate: number;
    summaryLabel: string;
    actualEvaluated: number;
  }
): string {
  const lines = ["section,metric,category,value"];
  const push = (section: string, metric: string, category: string, value: string | number) => {
    lines.push([section, metric, category, value].map(csvEscape).join(","));
  };
  push("headline", "summary_label", "", headline.summaryLabel);
  push("headline", "evaluated", "", headline.evaluated);
  push("headline", "correct", "", headline.correct);
  push("headline", "wrong", "", headline.wrong);
  push("headline", "ambiguous", "", headline.ambiguous);
  push("headline", "conflict", "", headline.conflict);
  push("headline", "no_match", "", headline.noMatch);
  push("headline", "precision", "", headline.precision ?? "");
  push("headline", "coverage", "", headline.coverage);
  push("headline", "wrong_rate", "", headline.wrongRate);
  push("headline", "ambiguity_rate", "", headline.ambiguityRate);
  push("headline", "conflict_rate", "", headline.conflictRate);
  push("headline", "no_match_rate", "", headline.noMatchRate);
  for (const row of diagnostics.wrongByFailureCategory) {
    push("wrong_by_failure_category", row.category, "count", row.count);
    push("wrong_by_failure_category", row.category, "pct", row.pct);
  }
  for (const row of diagnostics.markerPerformance) {
    push("marker_performance", row.marker, "resolved", row.resolved);
    push("marker_performance", row.marker, "correct", row.correct);
    push("marker_performance", row.marker, "wrong", row.wrong);
    push("marker_performance", row.marker, "precision", row.precision ?? "");
  }
  push(
    "gt_survival",
    "after_marker_1",
    "pct",
    diagnostics.groundTruthSurvival.afterMarker1.pct
  );
  push(
    "gt_survival",
    "after_marker_2",
    "pct",
    diagnostics.groundTruthSurvival.afterMarker2.pct
  );
  push(
    "gt_survival",
    "after_marker_3",
    "pct",
    diagnostics.groundTruthSurvival.afterMarker3.pct
  );
  for (const row of diagnostics.firstGroundTruthLoss) {
    push("first_gt_loss", row.stage, "count", row.count);
  }
  for (const row of diagnostics.commonConfusions) {
    push(
      "common_confusions",
      `${row.actualJobName}→${row.predictedJobName}`,
      "count",
      row.count
    );
  }
  return lines.join("\n");
}
