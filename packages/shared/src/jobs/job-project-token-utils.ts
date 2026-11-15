/**
 * Shared project-token helpers (inflection / hay lookup).
 * Kept separate to avoid circular imports between identity-policy and index.
 */

/** Scope/inflection pairs used for experimental coverage recovery. */
export const PROJECT_SCOPE_INFLECTIONS: Readonly<Record<string, string>> = {
  stair: "stairs",
  stairs: "stairs",
  rail: "rails",
  rails: "rails",
  beam: "beams",
  beams: "beams",
  column: "columns",
  columns: "columns",
  panel: "panels",
  panels: "panels",
  door: "doors",
  doors: "doors",
  gate: "gates",
  gates: "gates",
  ladder: "ladders",
  ladders: "ladders",
  platform: "platforms",
  platforms: "platforms",
  frame: "frames",
  frames: "frames",
  plate: "plates",
  plates: "plates",
  truss: "trusses",
  trusses: "trusses",
  joist: "joists",
  joists: "joists",
  building: "building",
  buildings: "building",
  drawing: "drawings",
  drawings: "drawings",
  submittal: "submittals",
  submittals: "submittals",
  mezzanine: "mezzanine",
  mezzanines: "mezzanine",
};

/** Max intervening tokens between ordered project/scope terms in one span. */
export const GAP_TOLERANT_MAX_INTERVENING_TOKENS = 12;

export function normalizeProjectScopeToken(token: string): string {
  return PROJECT_SCOPE_INFLECTIONS[token] ?? token;
}

export function projectTokensEquivalent(a: string, b: string): boolean {
  return a === b || normalizeProjectScopeToken(a) === normalizeProjectScopeToken(b);
}

export function hayHasProjectToken(
  subjectTokens: readonly string[],
  bodyTokens: readonly string[],
  token: string
): boolean {
  for (const t of subjectTokens) {
    if (projectTokensEquivalent(t, token)) return true;
  }
  for (const t of bodyTokens) {
    if (projectTokensEquivalent(t, token)) return true;
  }
  return false;
}

/** Collect Job tokens that appear in the email under scope inflection. */
export function matchedJobTokensInHay(
  jobTokens: readonly string[],
  subjectTokens: readonly string[],
  bodyTokens: readonly string[]
): string[] {
  const out: string[] = [];
  for (const jt of jobTokens) {
    if (hayHasProjectToken(subjectTokens, bodyTokens, jt)) {
      out.push(jt);
    }
  }
  return out;
}

export type OrderedTokenSpan = {
  start: number;
  end: number;
  /** Intervening hay tokens between first and last matched needle. */
  intervening: number;
  indices: number[];
};

/**
 * Find `needles` in order within `hay` (inflection-aware).
 * Returns null if any needle is missing or order cannot be satisfied.
 */
export function findOrderedTokenSpan(
  hay: readonly string[],
  needles: readonly string[]
): OrderedTokenSpan | null {
  if (needles.length === 0) return null;
  const indices: number[] = [];
  let pos = 0;
  for (const needle of needles) {
    let found = -1;
    for (let i = pos; i < hay.length; i += 1) {
      if (projectTokensEquivalent(hay[i]!, needle)) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    indices.push(found);
    pos = found + 1;
  }
  const start = indices[0]!;
  const end = indices[indices.length - 1]!;
  const intervening = end - start - (needles.length - 1);
  return { start, end, intervening, indices };
}

export type GapTolerantHayMatch = {
  field: "subject" | "body";
  run: string[];
  intervening: number;
  contiguous: boolean;
};

/**
 * Locate an ordered project/scope run in subject (preferred) or body within
 * a controlled intervening-token budget. Contiguous runs (intervening=0) are
 * strongest; wider gaps remain usable when within the budget.
 */
export function findGapTolerantHayMatch(input: {
  needles: readonly string[];
  subjectTokens: readonly string[];
  bodyTokens: readonly string[];
  maxIntervening?: number;
}): GapTolerantHayMatch | null {
  if (input.needles.length < 2) return null;
  const max = input.maxIntervening ?? GAP_TOLERANT_MAX_INTERVENING_TOKENS;
  const subjectSpan = findOrderedTokenSpan(input.subjectTokens, input.needles);
  if (subjectSpan && subjectSpan.intervening <= max) {
    return {
      field: "subject",
      run: [...input.needles],
      intervening: subjectSpan.intervening,
      contiguous: subjectSpan.intervening === 0,
    };
  }
  const bodySpan = findOrderedTokenSpan(input.bodyTokens, input.needles);
  if (bodySpan && bodySpan.intervening <= max) {
    return {
      field: "body",
      run: [...input.needles],
      intervening: bodySpan.intervening,
      contiguous: bodySpan.intervening === 0,
    };
  }
  return null;
}
