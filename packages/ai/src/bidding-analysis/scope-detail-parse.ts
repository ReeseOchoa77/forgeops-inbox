/**
 * Shared parse helpers for AI structured scopeDetail payloads.
 */

export type AiScopeNameRow = {
  name: string | null;
  details: string | null;
};

export type AiScopeDetailPayload = {
  tradeCategory: string | null;
  items: AiScopeNameRow[];
  work: AiScopeNameRow[];
  exclusions: AiScopeNameRow[];
  qualifications: AiScopeNameRow[];
};

function asNullString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function parseRows(v: unknown): AiScopeNameRow[] {
  if (!Array.isArray(v)) return [];
  const out: AiScopeNameRow[] = [];
  for (const row of v.slice(0, 40)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = asNullString(r.name);
    if (!name) continue;
    out.push({
      name,
      details: asNullString(r.details),
    });
  }
  return out;
}

export function parseAiScopeDetail(raw: unknown): AiScopeDetailPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return {
    tradeCategory: asNullString(o.tradeCategory),
    items: parseRows(o.items),
    work: parseRows(o.work),
    exclusions: parseRows(o.exclusions),
    qualifications: parseRows(o.qualifications),
  };
}

export const SCOPE_DETAIL_JSON_SCHEMA_FRAGMENT = `"scopeDetail": {
    "tradeCategory": string | null,
    "items": [{ "name": string, "details": string | null }],
    "work": [{ "name": string, "details": string | null }],
    "exclusions": [{ "name": string, "details": string | null }],
    "qualifications": [{ "name": string, "details": string | null }]
  }`;

export const SCOPE_DETAIL_PROMPT_RULES = `scopeDetail rules (CRITICAL — no hallucination):
- Extract CONCRETE items/assemblies/work supported by evidence (beams, columns, stairs, handrails, ladders, bollards, embeds, fabrication, installation, etc.).
- Do NOT answer with only a trade label like "Structural steel" or "Miscellaneous metals" as if that were detailed scope.
- If evidence only says "Structural Steel" with no components/work: set tradeCategory to that label, leave items/work empty.
- NEVER invent typical steel packages (beams/columns/stairs/rails/joists/deck) from general knowledge.
- exclusions / qualifications ONLY when evidence explicitly states them (e.g. "painting by others", "excludes erection").
- Prefer empty arrays over guessing.`;
