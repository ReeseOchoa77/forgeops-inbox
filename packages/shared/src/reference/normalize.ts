const COMPANY_SUFFIXES = [
  "inc", "incorporated", "llc", "l.l.c", "ltd", "limited", "co", "company",
  "corp", "corporation", "group", "grp", "enterprises", "ent",
  "services", "svc", "svcs", "solutions", "associates", "assoc",
  "partners", "intl", "international", "industries", "ind",
  "construction", "const",
  "mechanical", "mech", "electrical", "elec", "plumbing", "plbg",
  "contracting", "contractors", "supply",
  "holdings", "mgmt", "management", "engineering", "eng",
  "dba", "d/b/a", "aka", "a/k/a"
];

const SUFFIX_PATTERN = new RegExp(
  `\\b(${COMPANY_SUFFIXES.join("|")})\\.?\\s*$`,
  "i"
);

export function normalizeName(name: string): string {
  let n = name.toLowerCase().trim();
  n = n.replace(/[''`]/g, "");
  n = n.replace(/[.,;:!?()[\]{}]/g, " ");
  n = n.replace(/[-–—]/g, " ");
  n = n.replace(/&/g, "and");
  n = n.replace(/\s+/g, " ");
  n = n.trim();

  let prev = "";
  while (prev !== n) {
    prev = n;
    n = n.replace(SUFFIX_PATTERN, "").trim();
  }

  return n;
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase().trim();
}

export function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0;

  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  return (2 * intersection) / (tokensA.size + tokensB.size);
}

export interface DuplicateCandidate {
  existingId: string;
  existingName: string;
  existingNormalized: string;
  score: number;
  matchType: "exact" | "normalized" | "fuzzy";
}

export function findDuplicates(
  normalizedInput: string,
  displayInput: string,
  existingEntries: Array<{ id: string; name: string; normalizedName: string }>
): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (const entry of existingEntries) {
    if (entry.normalizedName === normalizedInput) {
      candidates.push({
        existingId: entry.id,
        existingName: entry.name,
        existingNormalized: entry.normalizedName,
        score: 1.0,
        matchType: "exact"
      });
      continue;
    }

    const inputTokens = normalizedInput.replace(/\s+/g, "");
    const entryTokens = entry.normalizedName.replace(/\s+/g, "");
    if (inputTokens === entryTokens) {
      candidates.push({
        existingId: entry.id,
        existingName: entry.name,
        existingNormalized: entry.normalizedName,
        score: 0.95,
        matchType: "normalized"
      });
      continue;
    }

    const sim = computeSimilarity(normalizedInput, entry.normalizedName);
    if (sim >= 0.6) {
      candidates.push({
        existingId: entry.id,
        existingName: entry.name,
        existingNormalized: entry.normalizedName,
        score: sim,
        matchType: "fuzzy"
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}
