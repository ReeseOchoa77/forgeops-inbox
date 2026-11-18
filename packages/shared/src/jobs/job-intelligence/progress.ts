export type JobIntelligenceRunProgress = {
  eligibleTotal: number;
  processed: number;
  skipped: number;
  failed: number;
  reviewOnly: number;
  eventsExtracted: number;
  lastEmailId: string | null;
  errors: Array<{ emailMessageId?: string; message: string }>;
};

export function emptyJobIntelligenceProgress(): JobIntelligenceRunProgress {
  return {
    eligibleTotal: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
    reviewOnly: 0,
    eventsExtracted: 0,
    lastEmailId: null,
    errors: [],
  };
}

export function parseJobIntelligenceProgress(
  value: unknown
): JobIntelligenceRunProgress {
  const base = emptyJobIntelligenceProgress();
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return base;
  }
  const v = value as Record<string, unknown>;
  const num = (k: keyof JobIntelligenceRunProgress) =>
    typeof v[k] === "number" && Number.isFinite(v[k] as number)
      ? (v[k] as number)
      : base[k];
  return {
    eligibleTotal: num("eligibleTotal") as number,
    processed: num("processed") as number,
    skipped: num("skipped") as number,
    failed: num("failed") as number,
    reviewOnly: num("reviewOnly") as number,
    eventsExtracted: num("eventsExtracted") as number,
    lastEmailId:
      typeof v.lastEmailId === "string" ? v.lastEmailId : null,
    errors: Array.isArray(v.errors)
      ? (v.errors as JobIntelligenceRunProgress["errors"]).slice(0, 50)
      : [],
  };
}
