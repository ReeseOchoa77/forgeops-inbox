const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipientEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function parseRecipientList(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map(normalizeRecipientEmail)
    .filter(Boolean);
}
