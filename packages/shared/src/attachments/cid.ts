/**
 * Helpers for deciding whether to inspect Outlook attachments and for
 * reconciling HTML cid: references with Graph contentId values.
 */

/** True when provider flag or HTML CID references suggest attachments may exist. */
export function shouldInspectAttachments(input: {
  hasAttachments: boolean;
  bodyHtml: string | null | undefined;
}): boolean {
  if (input.hasAttachments) return true;
  const html = input.bodyHtml ?? "";
  return /(?:src\s*=\s*(?:3D)?(["']?)cid:|url\(\s*(['"]?)cid:)/i.test(html);
}

/** Normalize a Content-ID / cid: reference for matching (case-insensitive). */
export function normalizeContentId(value: string | null | undefined): string {
  return value
    ?.replace(/^cid:/i, "")
    .replace(/^<|>$/g, "")
    .trim()
    .toLowerCase() ?? "";
}

/** Match keys: full normalized CID + Outlook local-part before @. */
export function contentIdMatchKeys(value: string | null | undefined): string[] {
  const primary = normalizeContentId(value);
  if (!primary) return [];
  const keys = [primary];
  const at = primary.indexOf("@");
  if (at > 0) keys.push(primary.slice(0, at));
  return keys;
}

/**
 * Extract cid: references from HTML (img src and CSS url()).
 * Returns unique normalized values (original casing is not preserved here —
 * store Graph contentId on the attachment row separately).
 */
export function extractHtmlCids(bodyHtml: string | null | undefined): string[] {
  if (!bodyHtml) return [];
  const found = new Set<string>();

  const srcRe = /\bsrc\s*=\s*(?:3D)?(["']?)cid:([^"'>\s]+)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = srcRe.exec(bodyHtml)) !== null) {
    const normalized = normalizeContentId(match[2]);
    if (normalized) found.add(normalized);
  }

  const urlRe = /url\(\s*(['"]?)cid:([^)'"\s]+)\1\s*\)/gi;
  while ((match = urlRe.exec(bodyHtml)) !== null) {
    const normalized = normalizeContentId(match[2]);
    if (normalized) found.add(normalized);
  }

  return [...found];
}

/** HTML CIDs that do not match any retrieved attachment contentId. */
export function findMissingContentIds(
  htmlCids: string[],
  attachmentContentIds: Array<string | null | undefined>
): string[] {
  const available = new Set<string>();
  for (const cid of attachmentContentIds) {
    for (const key of contentIdMatchKeys(cid)) {
      available.add(key);
    }
  }

  const missing: string[] = [];
  for (const htmlCid of htmlCids) {
    const keys = contentIdMatchKeys(htmlCid);
    const resolved = keys.some((k) => available.has(k));
    if (!resolved) missing.push(htmlCid);
  }
  return missing;
}
