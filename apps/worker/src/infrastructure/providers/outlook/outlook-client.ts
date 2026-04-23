import { z } from "zod";

const MICROSOFT_AUTH_BASE_URL = "https://login.microsoftonline.com";
const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const MAX_MESSAGES_PER_SYNC = 100;
const MAX_STORED_BODY_TEXT_LENGTH = 20_000;
const MAX_THROTTLE_RETRIES = 3;
const DEFAULT_THROTTLE_WAIT_MS = 5_000;

const graphEmailAddressSchema = z.object({
  emailAddress: z.object({
    name: z.string().nullable().optional(),
    address: z.string().min(1)
  })
});

const graphAttachmentSchema = z.object({
  id: z.string().min(1).optional(),
  contentId: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  size: z.number().nullable().optional(),
  isInline: z.boolean().optional()
});

const graphMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1).nullable().optional(),
  subject: z.string().nullable().optional(),
  bodyPreview: z.string().nullable().optional(),
  body: z
    .object({
      contentType: z.string().optional(),
      content: z.string().optional()
    })
    .nullable()
    .optional(),
  from: graphEmailAddressSchema.nullable().optional(),
  toRecipients: z.array(graphEmailAddressSchema).optional(),
  ccRecipients: z.array(graphEmailAddressSchema).optional(),
  bccRecipients: z.array(graphEmailAddressSchema).optional(),
  replyTo: z.array(graphEmailAddressSchema).optional(),
  sentDateTime: z.string().nullable().optional(),
  receivedDateTime: z.string().nullable().optional(),
  isRead: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  categories: z.array(z.string()).optional(),
  parentFolderId: z.string().nullable().optional(),
  importance: z.enum(["low", "normal", "high"]).optional()
});

const graphMessagesResponseSchema = z.object({
  value: z.array(graphMessageSchema),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional()
});

const graphAttachmentsResponseSchema = z.object({
  value: z.array(graphAttachmentSchema)
});

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional()
});

type GraphMessage = z.infer<typeof graphMessageSchema>;

export interface OutlookClientConfig {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
}

export interface OutlookAddress {
  name: string | null;
  email: string;
  raw: string;
}

export interface OutlookAttachmentMetadata {
  attachmentId: string | null;
  contentId: string | null;
  filename: string | null;
  inline: boolean;
  mimeType: string | null;
  size: number | null;
}

export interface OutlookMessageSnapshot {
  outlookMessageId: string;
  conversationId: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  toAddresses: OutlookAddress[];
  ccAddresses: OutlookAddress[];
  bccAddresses: OutlookAddress[];
  replyToAddresses: OutlookAddress[];
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  hasAttachments: boolean;
  attachmentMetadata: OutlookAttachmentMetadata[];
  folderLabels: string[];
  sentAt: Date;
  receivedAt: Date | null;
  isRead: boolean;
  importance: string | null;
}

export interface OutlookConversationSnapshot {
  conversationId: string;
  subject: string | null;
  normalizedSubject: string | null;
  snippet: string | null;
  participants: OutlookAddress[];
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  messageCount: number;
  unreadCount: number;
  messages: OutlookMessageSnapshot[];
}

export interface OutlookMailboxSyncSnapshot {
  conversations: OutlookConversationSnapshot[];
  newestDeltaLink: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshedRefreshToken: string | null;
}

export interface OutlookMailboxSyncInput {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  syncCursor?: string | null;
  maxMessages?: number;
}

const mapGraphAddress = (
  recipient: z.infer<typeof graphEmailAddressSchema>
): OutlookAddress => {
  const email = recipient.emailAddress.address.toLowerCase();
  const name = recipient.emailAddress.name?.trim() || null;
  return {
    name,
    email,
    raw: name ? `${name} <${email}>` : email
  };
};

const stripHtml = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const stripOutlookReplyDividers = (value: string): string => {
  const lines = value.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^_{10,}$/.test(trimmed)) break;
    if (/^-{10,}$/.test(trimmed)) break;

    if (
      /^from:\s.+/i.test(trimmed) &&
      kept.length > 0 &&
      /^_{5,}$|^-{5,}$|^\s*$/.test(kept[kept.length - 1]?.trim() ?? "")
    ) {
      kept.pop();
      break;
    }

    kept.push(line);
  }

  return kept.join("\n");
};

const normalizeSubject = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .trim();
  return normalized.length > 0 ? normalized : null;
};

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const extractBodyText = (msg: GraphMessage): string | null => {
  const body = msg.body;
  if (!body?.content) return null;

  let text: string;
  if (body.contentType === "text") {
    text = body.content;
  } else {
    text = stripHtml(body.content);
  }

  text = stripOutlookReplyDividers(text);
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_STORED_BODY_TEXT_LENGTH);
};

const buildFolderLabels = (msg: GraphMessage): string[] => {
  const labels: string[] = [];

  if (msg.parentFolderId) {
    labels.push(`outlook-folder:${msg.parentFolderId}`);
  }

  for (const category of msg.categories ?? []) {
    labels.push(`outlook-category:${category.toLowerCase()}`);
  }

  if (msg.isRead === false) {
    labels.push("unread");
  }

  if (msg.importance === "high") {
    labels.push("important");
  }

  return labels.sort();
};

const mergeParticipants = (
  messages: OutlookMessageSnapshot[]
): OutlookAddress[] => {
  const participants = new Map<string, OutlookAddress>();

  for (const message of messages) {
    const addresses = [
      {
        name: message.senderName,
        email: message.senderEmail,
        raw:
          message.senderName
            ? `${message.senderName} <${message.senderEmail}>`
            : message.senderEmail
      },
      ...message.toAddresses,
      ...message.ccAddresses,
      ...message.replyToAddresses
    ];

    for (const address of addresses) {
      if (!participants.has(address.email)) {
        participants.set(address.email, address);
      }
    }
  }

  return [...participants.values()];
};

const parseMessage = (msg: GraphMessage): OutlookMessageSnapshot => {
  const from = msg.from ? mapGraphAddress(msg.from) : null;
  const sentAt = parseDate(msg.sentDateTime) ?? new Date();
  const receivedAt = parseDate(msg.receivedDateTime);

  return {
    outlookMessageId: msg.id,
    conversationId: msg.conversationId ?? msg.id,
    subject: msg.subject ?? null,
    senderName: from?.name ?? null,
    senderEmail: from?.email ?? "unknown@invalid.local",
    toAddresses: (msg.toRecipients ?? []).map(mapGraphAddress),
    ccAddresses: (msg.ccRecipients ?? []).map(mapGraphAddress),
    bccAddresses: (msg.bccRecipients ?? []).map(mapGraphAddress),
    replyToAddresses: (msg.replyTo ?? []).map(mapGraphAddress),
    snippet: msg.bodyPreview?.trim().slice(0, 500) ?? null,
    bodyText: extractBodyText(msg),
    bodyHtml: msg.body?.contentType === "html" ? (msg.body.content ?? null) : null,
    hasAttachments: msg.hasAttachments ?? false,
    attachmentMetadata: [],
    folderLabels: buildFolderLabels(msg),
    sentAt,
    receivedAt,
    isRead: msg.isRead ?? true,
    importance: msg.importance ?? null
  };
};

const groupByConversation = (
  messages: OutlookMessageSnapshot[]
): OutlookConversationSnapshot[] => {
  const conversationMap = new Map<string, OutlookMessageSnapshot[]>();

  for (const message of messages) {
    const existing = conversationMap.get(message.conversationId);
    if (existing) {
      existing.push(message);
    } else {
      conversationMap.set(message.conversationId, [message]);
    }
  }

  const conversations: OutlookConversationSnapshot[] = [];

  for (const [conversationId, msgs] of conversationMap) {
    const sorted = msgs.sort(
      (a, b) => a.sentAt.getTime() - b.sentAt.getTime()
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    if (!first || !last) continue;

    const subject = last.subject ?? first.subject ?? null;

    conversations.push({
      conversationId,
      subject,
      normalizedSubject: normalizeSubject(subject),
      snippet: last.snippet ?? first.snippet ?? null,
      participants: mergeParticipants(sorted),
      firstMessageAt: first.sentAt,
      lastMessageAt: last.sentAt,
      messageCount: sorted.length,
      unreadCount: sorted.filter((m) => !m.isRead).length,
      messages: sorted
    });
  }

  return conversations;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfterMs = (response: Response): number => {
  const header = response.headers.get("Retry-After");
  if (!header) return DEFAULT_THROTTLE_WAIT_MS;

  const seconds = Number(header);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 60_000);
  }

  return DEFAULT_THROTTLE_WAIT_MS;
};

export class OutlookClient {
  constructor(private readonly config: OutlookClientConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  async syncMailbox(
    input: OutlookMailboxSyncInput
  ): Promise<OutlookMailboxSyncSnapshot> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("Outlook client is not configured");
    }

    const tokenResult = await this.refreshAccessToken(input.refreshToken);

    const messages = await this.fetchInboxMessages(
      tokenResult.accessToken,
      input.maxMessages ?? MAX_MESSAGES_PER_SYNC,
      input.syncCursor ?? null
    );

    if (messages.hasAttachmentIds.length > 0) {
      await this.fetchAttachmentMetadata(
        tokenResult.accessToken,
        messages.items,
        messages.hasAttachmentIds
      );
    }

    const conversations = groupByConversation(messages.items);

    return {
      conversations,
      newestDeltaLink: messages.deltaLink,
      accessToken: tokenResult.accessToken,
      accessTokenExpiresAt: tokenResult.expiresAt,
      refreshedRefreshToken: tokenResult.refreshedRefreshToken
    };
  }

  private async refreshAccessToken(
    refreshToken: string
  ): Promise<{
    accessToken: string;
    expiresAt: Date | null;
    refreshedRefreshToken: string | null;
  }> {
    const tenantId = this.config.tenantId ?? "common";
    const tokenUrl = `${MICROSOFT_AUTH_BASE_URL}/${tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: this.config.clientId!,
      client_secret: this.config.clientSecret!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: [
        "offline_access",
        "https://graph.microsoft.com/Mail.Read",
        "https://graph.microsoft.com/User.Read"
      ].join(" ")
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Outlook token refresh failed (${response.status}): ${errorText}`
      );
    }

    const raw = await response.json();
    const tokens = tokenResponseSchema.parse(raw);

    const refreshedRefreshToken =
      tokens.refresh_token && tokens.refresh_token !== refreshToken
        ? tokens.refresh_token
        : null;

    return {
      accessToken: tokens.access_token,
      expiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : null,
      refreshedRefreshToken
    };
  }

  private async fetchWithThrottleRetry(
    url: string,
    headers: Record<string, string>
  ): Promise<Response> {
    let attempt = 0;

    while (true) {
      const response = await fetch(url, { headers });

      if (response.status !== 429 || attempt >= MAX_THROTTLE_RETRIES) {
        return response;
      }

      const waitMs = parseRetryAfterMs(response);
      console.warn("outlook-graph-throttled", {
        attempt: attempt + 1,
        retryAfterMs: waitMs,
        url: url.split("?")[0]
      });

      await sleep(waitMs);
      attempt += 1;
    }
  }

  private async fetchInboxMessages(
    accessToken: string,
    maxMessages: number,
    syncCursor: string | null
  ): Promise<{
    items: OutlookMessageSnapshot[];
    deltaLink: string | null;
    hasAttachmentIds: string[];
  }> {
    const pageSize = Math.min(maxMessages, 50);
    const selectFields = [
      "id",
      "conversationId",
      "subject",
      "bodyPreview",
      "body",
      "from",
      "toRecipients",
      "ccRecipients",
      "bccRecipients",
      "replyTo",
      "sentDateTime",
      "receivedDateTime",
      "isRead",
      "hasAttachments",
      "categories",
      "parentFolderId",
      "importance"
    ].join(",");

    let url: string | null;
    let isDelta = false;

    if (syncCursor && syncCursor.startsWith("http")) {
      url = syncCursor;
      isDelta = true;
    } else {
      url =
        `${MICROSOFT_GRAPH_BASE_URL}/me/mailFolders/inbox/messages/delta` +
        `?$select=${selectFields}` +
        `&$top=${pageSize}`;
    }

    const items: OutlookMessageSnapshot[] = [];
    const hasAttachmentIds: string[] = [];
    let deltaLink: string | null = null;
    const seenMessageIds = new Set<string>();

    while (url && items.length < maxMessages) {
      const response = await this.fetchWithThrottleRetry(url, {
        Authorization: `Bearer ${accessToken}`,
        Prefer: "odata.maxpagesize=" + String(pageSize)
      });

      if ((response.status === 410 || response.status === 404) && isDelta) {
        console.warn("outlook-delta-link-expired", {
          cursor: syncCursor?.slice(0, 80)
        });
        return this.fetchInboxMessages(accessToken, maxMessages, null);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Outlook inbox fetch failed (${response.status}): ${errorText}`
        );
      }

      const raw = await response.json();
      const page = graphMessagesResponseSchema.parse(raw);

      for (const graphMsg of page.value) {
        if (items.length >= maxMessages) break;
        if (seenMessageIds.has(graphMsg.id)) continue;

        seenMessageIds.add(graphMsg.id);
        const parsed = parseMessage(graphMsg);
        items.push(parsed);

        if (parsed.hasAttachments) {
          hasAttachmentIds.push(graphMsg.id);
        }
      }

      deltaLink = page["@odata.deltaLink"] ?? deltaLink;
      url = items.length < maxMessages
        ? (page["@odata.nextLink"] ?? null)
        : null;
    }

    return { items, deltaLink, hasAttachmentIds };
  }

  private async fetchAttachmentMetadata(
    accessToken: string,
    messages: OutlookMessageSnapshot[],
    messageIdsWithAttachments: string[]
  ): Promise<void> {
    const messageMap = new Map(
      messages.map((m) => [m.outlookMessageId, m])
    );

    for (const messageId of messageIdsWithAttachments) {
      const msg = messageMap.get(messageId);
      if (!msg) continue;

      try {
        const response = await this.fetchWithThrottleRetry(
          `${MICROSOFT_GRAPH_BASE_URL}/me/messages/${messageId}/attachments?$select=id,contentId,name,contentType,size,isInline`,
          { Authorization: `Bearer ${accessToken}` }
        );

        if (!response.ok) {
          console.warn("outlook-attachment-fetch-failed", {
            messageId,
            status: response.status
          });
          continue;
        }

        const raw = await response.json();
        const parsed = graphAttachmentsResponseSchema.parse(raw);

        msg.attachmentMetadata = parsed.value.map((att) => ({
          attachmentId: att.id ?? null,
          contentId: att.contentId ?? null,
          filename: att.name ?? null,
          inline: att.isInline ?? false,
          mimeType: att.contentType ?? null,
          size: att.size ?? null
        }));
      } catch (error) {
        console.warn("outlook-attachment-fetch-error", {
          messageId,
          error: error instanceof Error ? error.message : "unknown"
        });
      }
    }
  }
}
