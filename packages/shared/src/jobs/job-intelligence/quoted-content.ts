/**
 * Separate current message content from quoted reply history for extraction.
 * Prefer separately ingested EmailMessage rows over interpreting quoted chains.
 */

const QUOTE_HEADER =
  /^(on\s.+wrote:|from:\s|sent:\s|date:\s|subject:\s|-----original message-----|_{5,}|-{5,}\s*forwarded)/i;

/**
 * Strip common quoted reply / forward blocks from plain text.
 * Returns current-body text suitable for LLM extraction input.
 */
export function stripQuotedEmailContent(bodyText: string | null | undefined): {
  currentText: string;
  hadQuotedContent: boolean;
} {
  if (!bodyText) return { currentText: "", hadQuotedContent: false };

  const lines = bodyText.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  let hadQuotedContent = false;
  let inQuoteBlock = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (/^>/.test(trimmed)) {
      hadQuotedContent = true;
      inQuoteBlock = true;
      continue;
    }
    if (QUOTE_HEADER.test(trimmed.trim())) {
      hadQuotedContent = true;
      inQuoteBlock = true;
      continue;
    }
    if (inQuoteBlock) {
      // End quote block on a blank line followed by non-header content is ambiguous;
      // once a quote header is seen, drop the remainder (typical reply layout).
      continue;
    }
    kept.push(line);
  }

  const currentText = kept.join("\n").trim();
  return { currentText, hadQuotedContent };
}

/** Light signature trim — last block of short lines after a long blank gap. */
export function stripTrailingSignature(text: string): string {
  const parts = text.split(/\n{2,}/);
  if (parts.length < 2) return text;
  const last = parts[parts.length - 1] ?? "";
  const lastLines = last.split("\n").filter((l) => l.trim().length > 0);
  if (
    lastLines.length > 0 &&
    lastLines.length <= 6 &&
    lastLines.every((l) => l.length < 80) &&
    /^(thanks|thank you|regards|best|sent from|get outlook)/i.test(
      lastLines[0]!.trim()
    )
  ) {
    return parts.slice(0, -1).join("\n\n").trim();
  }
  return text;
}

export function prepareEmailBodyForExtraction(
  bodyText: string | null | undefined
): { currentText: string; hadQuotedContent: boolean } {
  const stripped = stripQuotedEmailContent(bodyText);
  return {
    currentText: stripTrailingSignature(stripped.currentText),
    hadQuotedContent: stripped.hadQuotedContent,
  };
}
