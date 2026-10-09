import { outlookGraphUrl } from "@forgeops/shared";
import type {
  ProviderMessageDeleteInput,
  ProviderMessageDeleteResult,
} from "@forgeops/shared";

/**
 * Delete (move to Deleted Items) an Outlook message via Microsoft Graph.
 * Uses /users/{mailbox} when graphMailboxEmail is set (delegated access).
 * 404 is treated as already_deleted for idempotent retries.
 */
export async function deleteOutlookProviderMessage(
  input: ProviderMessageDeleteInput,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderMessageDeleteResult> {
  const providerMessageId = input.providerMessageId?.trim();
  if (!providerMessageId) {
    return {
      outcome: "failed",
      status: 400,
      message: "Provider message id is required for mailbox deletion",
    };
  }

  const url = outlookGraphUrl(
    input.graphMailboxEmail,
    `messages/${encodeURIComponent(providerMessageId)}`
  );

  const response = await fetchImpl(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
    },
  });

  if (response.ok || response.status === 204) {
    return { outcome: "deleted", status: response.status };
  }

  if (response.status === 404) {
    return {
      outcome: "already_deleted",
      status: 404,
      message: "Provider message was already deleted or not found",
    };
  }

  const body = (await response.text().catch(() => "")).slice(0, 240);
  if (response.status === 401 || response.status === 403) {
    return {
      outcome: "failed",
      status: response.status,
      message:
        "Microsoft did not allow deleting this message. Re-authorize the mailbox " +
        "with Mail.ReadWrite permission, and ensure this connection can access the target mailbox.",
    };
  }

  return {
    outcome: "failed",
    status: response.status,
    message: `Provider delete failed (${response.status})${body ? `: ${body}` : ""}`,
  };
}

export async function refreshOutlookAccessToken(input: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; accessToken: string; refreshedRefreshToken: string | null }
  | { ok: false; message: string }
> {
  const fetchFn = input.fetchImpl ?? fetch;
  const tokenUrl = `https://login.microsoftonline.com/${input.tenantId}/oauth2/v2.0/token`;
  const tokenBody = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token",
    scope:
      "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Read " +
      "https://graph.microsoft.com/Mail.Send offline_access",
  });

  const tokenRes = await fetchFn(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const err = (await tokenRes.text().catch(() => "")).slice(0, 200);
    return {
      ok: false,
      message: `Outlook token refresh failed (${tokenRes.status})${err ? `: ${err}` : ""}`,
    };
  }

  const tokens = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.access_token) {
    return { ok: false, message: "Outlook token refresh returned no access_token" };
  }

  return {
    ok: true,
    accessToken: tokens.access_token,
    refreshedRefreshToken: tokens.refresh_token ?? null,
  };
}
