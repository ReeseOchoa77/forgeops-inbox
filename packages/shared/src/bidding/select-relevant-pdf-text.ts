/**
 * Bound PDF/email attachment text for Bidding Analysis AI prompts.
 * Prefer sections near quote/bid signal words; never send unbounded PDFs.
 */

const SIGNAL_RE =
  /\b(total|price|quote|proposal|scope|structural\s+steel|misc(?:ellaneous)?\.?\s+metals?|project|job\s*#?|revision|addendum|bid\s+due|amount|sum|fabricat)/i;

const DEFAULT_MAX_CHARS = 12_000;
const WINDOW_CHARS = 900;

/**
 * Select a bounded slice of PDF text biased toward quote/bid signals.
 * Falls back to head+tail if no signals match.
 */
export function selectRelevantPdfText(
  text: string | null | undefined,
  maxChars: number = DEFAULT_MAX_CHARS
): string {
  const raw = (text ?? "").replace(/\0/g, "").trim();
  if (!raw) return "";
  if (raw.length <= maxChars) return raw;

  const lower = raw.toLowerCase();
  const hits: number[] = [];
  const probe = SIGNAL_RE;
  let m: RegExpExecArray | null;
  const global = new RegExp(probe.source, "gi");
  while ((m = global.exec(lower)) !== null && hits.length < 40) {
    hits.push(m.index);
  }

  if (hits.length === 0) {
    const head = Math.floor(maxChars * 0.7);
    const tail = maxChars - head - 20;
    return `${raw.slice(0, head)}\n…\n${raw.slice(-Math.max(0, tail))}`;
  }

  const chunks: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const idx of hits) {
    if (used >= maxChars) break;
    const start = Math.max(0, idx - Math.floor(WINDOW_CHARS / 3));
    const end = Math.min(raw.length, start + WINDOW_CHARS);
    const key = `${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const slice = raw.slice(start, end);
    chunks.push(slice);
    used += slice.length + 8;
  }

  let out = chunks.join("\n---\n");
  if (out.length > maxChars) out = out.slice(0, maxChars);
  return out;
}

/** True when extracted PDF text is too short / empty to be useful (scanned). */
export function isPdfTextUsable(
  text: string | null | undefined,
  minChars = 40
): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length >= minChars;
}
