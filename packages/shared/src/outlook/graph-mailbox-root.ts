/**
 * Microsoft Graph resource root for mail I/O.
 * - Own mailbox (default): `/me`
 * - Delegated / shared target: `/users/{upn}` when the OAuth identity differs
 *   from the mailbox being ingested.
 */
export function outlookGraphMailboxRoot(
  mailboxEmail: string | null | undefined
): string {
  const email = mailboxEmail?.trim();
  if (!email) return "me";
  return `users/${encodeURIComponent(email)}`;
}

export function outlookGraphUrl(
  mailboxEmail: string | null | undefined,
  pathAfterRoot: string
): string {
  const root = outlookGraphMailboxRoot(mailboxEmail);
  const suffix = pathAfterRoot.replace(/^\//, "");
  return `https://graph.microsoft.com/v1.0/${root}/${suffix}`;
}
