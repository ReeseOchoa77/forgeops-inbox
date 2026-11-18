export type JobIntelligenceSummarySection = {
  text: string;
  evidenceEventIds: string[];
};

export type JobIntelligenceSummarySections = {
  overview: JobIntelligenceSummarySection;
  currentStatus: JobIntelligenceSummarySection;
  scope: JobIntelligenceSummarySection;
  financial: JobIntelligenceSummarySection;
  schedule: JobIntelligenceSummarySection;
  recentDevelopments: JobIntelligenceSummarySection;
  openIssues: JobIntelligenceSummarySection;
  risks: JobIntelligenceSummarySection;
  keyDecisions: JobIntelligenceSummarySection;
  nextActions: JobIntelligenceSummarySection;
};

const SECTION_KEYS = [
  "overview",
  "currentStatus",
  "scope",
  "financial",
  "schedule",
  "recentDevelopments",
  "openIssues",
  "risks",
  "keyDecisions",
  "nextActions",
] as const;

function emptySection(fallback: string): JobIntelligenceSummarySection {
  return { text: fallback, evidenceEventIds: [] };
}

export function emptySummarySections(): JobIntelligenceSummarySections {
  const unavailable = "Information unavailable from extracted correspondence.";
  return {
    overview: emptySection(unavailable),
    currentStatus: emptySection(unavailable),
    scope: emptySection(unavailable),
    financial: emptySection(unavailable),
    schedule: emptySection(unavailable),
    recentDevelopments: emptySection(unavailable),
    openIssues: emptySection(unavailable),
    risks: emptySection(unavailable),
    keyDecisions: emptySection(unavailable),
    nextActions: emptySection(unavailable),
  };
}

function parseSection(
  value: unknown,
  allowedEventIds: Set<string> | null
): JobIntelligenceSummarySection {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return emptySection("Information unavailable from extracted correspondence.");
  }
  const v = value as Record<string, unknown>;
  const text =
    typeof v.text === "string" && v.text.trim()
      ? v.text.trim().slice(0, 4000)
      : "Information unavailable from extracted correspondence.";
  const ids: string[] = [];
  if (Array.isArray(v.evidenceEventIds)) {
    for (const id of v.evidenceEventIds) {
      if (typeof id !== "string" || !id.trim()) continue;
      if (allowedEventIds && !allowedEventIds.has(id)) continue;
      ids.push(id.trim());
      if (ids.length >= 20) break;
    }
  }
  return { text, evidenceEventIds: ids };
}

export function parseSummarySections(
  raw: unknown,
  allowedEventIds: Set<string> | null = null
): JobIntelligenceSummarySections {
  const base = emptySummarySections();
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    return base;
  }
  const obj = raw as Record<string, unknown>;
  const out = { ...base };
  for (const key of SECTION_KEYS) {
    out[key] = parseSection(obj[key], allowedEventIds);
  }
  return out;
}
