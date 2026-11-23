/**
 * Pure comparison helpers for Job Intelligence Lab runs.
 * Does not invent accuracy scores — counts and diffs only.
 */

export type LabAssociationSnapshotEntry = {
  emailMessageId: string;
  jobId: string | null;
  source:
    | "HUMAN_AUTHORITATIVE"
    | "MATCHER_PREDICTION"
    | "PRODUCTION_ASSIGNMENT"
    | "UNASSIGNED";
  matcherDecision?: string | null;
  eligibilityTier?: string | null;
};

export type LabExtractedEventLite = {
  category: string;
  title: string;
  status: string;
  financialKind?: string | null;
  amount?: number | null;
  contentFingerprint: string;
  evidenceCount: number;
};

export type LabRunCompareInput = {
  runId: string;
  label: string;
  matcherModelId: string;
  intelligenceModelId: string;
  associationMode: string;
  associations: LabAssociationSnapshotEntry[];
  events: LabExtractedEventLite[];
  summaryTextBySection?: Record<string, string>;
  diagnostics?: Record<string, unknown> | null;
  usage?: { inputTokens?: number | null; outputTokens?: number | null } | null;
};

export type LabRunCompareResult = {
  runs: Array<{
    runId: string;
    label: string;
    matcherModelId: string;
    intelligenceModelId: string;
    associationMode: string;
    emailCount: number;
    assignedCount: number;
    eventCount: number;
    eventsByCategory: Record<string, number>;
    financialCount: number;
    scopeCount: number;
    scheduleCount: number;
    openIssueCount: number;
    usage: LabRunCompareInput["usage"];
  }>;
  associationDiffs: Array<{
    emailMessageId: string;
    assignments: Array<{ runId: string; jobId: string | null; source: string }>;
  }>;
  eventFingerprintsOnlyIn: Record<string, string[]>;
  sharedEventFingerprints: string[];
  notes: string[];
};

function countByCategory(events: LabExtractedEventLite[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    out[e.category] = (out[e.category] ?? 0) + 1;
  }
  return out;
}

export function compareJobIntelligenceLabRuns(
  runs: LabRunCompareInput[]
): LabRunCompareResult {
  if (runs.length < 2) {
    throw new Error("At least two lab runs are required for comparison");
  }

  const notes = [
    "Higher event counts are not automatically better.",
    "No accuracy score is computed without human-verified reference data.",
  ];

  const summarized = runs.map((r) => {
    const byCat = countByCategory(r.events);
    return {
      runId: r.runId,
      label: r.label,
      matcherModelId: r.matcherModelId,
      intelligenceModelId: r.intelligenceModelId,
      associationMode: r.associationMode,
      emailCount: r.associations.length,
      assignedCount: r.associations.filter((a) => a.jobId).length,
      eventCount: r.events.length,
      eventsByCategory: byCat,
      financialCount: byCat.FINANCIAL ?? 0,
      scopeCount: byCat.SCOPE ?? 0,
      scheduleCount: byCat.SCHEDULE ?? 0,
      openIssueCount: r.events.filter(
        (e) =>
          (e.category === "RFI_TECHNICAL" || e.category === "RISK_CHANGE") &&
          (e.status === "OPEN" || e.status === "REQUESTED" || e.status === "UNKNOWN")
      ).length,
      usage: r.usage ?? null,
    };
  });

  const emailIds = new Set<string>();
  for (const r of runs) {
    for (const a of r.associations) emailIds.add(a.emailMessageId);
  }

  const associationDiffs: LabRunCompareResult["associationDiffs"] = [];
  for (const emailMessageId of emailIds) {
    const assignments = runs.map((r) => {
      const hit = r.associations.find((a) => a.emailMessageId === emailMessageId);
      return {
        runId: r.runId,
        jobId: hit?.jobId ?? null,
        source: hit?.source ?? "UNASSIGNED",
      };
    });
    const jobIds = new Set(assignments.map((a) => a.jobId ?? ""));
    if (jobIds.size > 1) {
      associationDiffs.push({ emailMessageId, assignments });
    }
  }

  const fpSets = runs.map(
    (r) => new Set(r.events.map((e) => e.contentFingerprint))
  );
  const shared = [...fpSets[0]!].filter((fp) =>
    fpSets.every((s) => s.has(fp))
  );
  const eventFingerprintsOnlyIn: Record<string, string[]> = {};
  for (let i = 0; i < runs.length; i++) {
    const only = [...fpSets[i]!].filter(
      (fp) => !fpSets.every((s) => s.has(fp))
    );
    eventFingerprintsOnlyIn[runs[i]!.runId] = only;
  }

  return {
    runs: summarized,
    associationDiffs: associationDiffs.slice(0, 200),
    eventFingerprintsOnlyIn,
    sharedEventFingerprints: shared.slice(0, 500),
    notes,
  };
}
