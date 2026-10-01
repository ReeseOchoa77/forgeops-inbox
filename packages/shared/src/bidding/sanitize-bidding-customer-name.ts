import { normalizeName } from "../reference/normalize.js";

/** Third-party bid platforms — never Customers. */
const BIDDING_PLATFORM_NAMES =
  /^(?:building\s*connected|buildingconnected|procore|plan\s*hub|planhub|construct\s*connect|constructconnect|autodesk|dodge\s*data|isqft|bid\s*clerk|bidclerk)$/i;

const COMPANY_HINT =
  /\b(?:construction|contracting|contractors?|builders?|companies|company|group|development|steel|engineering|architects?|inc\.?|llc|corp\.?|co\.?|ltd\.?|cm|gc)\b/i;

/**
 * Reject ordinary person names (First Last) with no organization signal.
 * Conservative: prefer null over creating a person as Customer.
 */
export function looksLikePersonName(name: string): boolean {
  const t = name.trim();
  if (!t) return false;
  if (COMPANY_HINT.test(t)) return false;
  if (/\d/.test(t)) return false;
  // 2–3 Capitalized tokens, no & / punctuation typical of firms
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(t)) return true;
  if (/^[A-Z][a-z]+\s+[A-Z]\.\s*[A-Z][a-z]+$/.test(t)) return true;
  return false;
}

export function isBiddingPlatformCompanyName(name: string): boolean {
  return BIDDING_PLATFORM_NAMES.test(name.trim());
}

/**
 * Sanitize AI/deterministic customer company candidate before resolution.
 * Returns null when the name is project-like, person-like, platform, or empty.
 */
export function sanitizeBiddingCustomerCompanyName(input: {
  companyName: string | null | undefined;
  projectName?: string | null | undefined;
}): string | null {
  const raw = input.companyName?.trim() ?? "";
  if (!raw) return null;
  if (raw.length > 200) return null;
  if (isBiddingPlatformCompanyName(raw)) return null;
  if (looksLikePersonName(raw)) return null;

  const project = input.projectName?.trim() ?? "";
  if (project) {
    const nCompany = normalizeName(raw);
    const nProject = normalizeName(project);
    if (nCompany && nProject && nCompany === nProject) return null;
    // Near-identical project title used as company
    if (
      nCompany &&
      nProject &&
      (nProject.includes(nCompany) || nCompany.includes(nProject)) &&
      Math.min(nCompany.length, nProject.length) >= 12
    ) {
      // Allow short company names contained in longer projects (e.g. "Mortenson"
      // vs "Mortenson Campus Expansion") — only reject when nearly equal length.
      const ratio =
        Math.min(nCompany.length, nProject.length) /
        Math.max(nCompany.length, nProject.length);
      if (ratio >= 0.85) return null;
    }
  }

  return raw.slice(0, 200);
}
