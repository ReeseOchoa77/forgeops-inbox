import { normalizeEmail, outlookGraphUrl } from "@forgeops/shared";

/**
 * Prove the delegated access token can open the target mailbox via Graph.
 * Uses /users/{upn}/mailboxSettings — fails closed on 401/403/404.
 */
export async function verifyOutlookMailboxAccess(input: {
  accessToken: string;
  targetMailboxEmail: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; verifiedEmail: string }
  | { ok: false; status: number; message: string }
> {
  const target = normalizeEmail(input.targetMailboxEmail);
  if (!target) {
    return { ok: false, status: 400, message: "Target mailbox email is required" };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  const url = outlookGraphUrl(target, "mailboxSettings");
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
  });

  if (response.ok) {
    return { ok: true, verifiedEmail: target };
  }

  const body = (await response.text()).slice(0, 240);
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      status: response.status,
      message:
        `Microsoft did not grant access to mailbox ${target}. ` +
        `Sign in with an account that has Full Access / shared mailbox rights, ` +
        `or authorize as that mailbox directly.`,
    };
  }
  if (response.status === 404) {
    return {
      ok: false,
      status: 404,
      message: `Mailbox ${target} was not found in Microsoft Graph for this account.`,
    };
  }
  return {
    ok: false,
    status: response.status,
    message: `Failed to verify mailbox access (${response.status}): ${body}`,
  };
}
