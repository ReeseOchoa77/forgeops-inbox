import { google } from "googleapis";
import { z } from "zod";

const INBOX_LABEL_ID = "INBOX";
const MAX_THREADS_PER_SYNC = 100;
const MAX_STORED_BODY_TEXT_LENGTH = 20_000;
const GMAIL_ME = "me";

const gmailThreadListItemSchema = z.object({
  id: z.string().min(1),
  historyId: z.string().optional(),
  snippet: z.string().optional()
});

const gmailThreadListResponseSchema = z.object({
  threads: z.array(gmailThreadListItemSchema).optional()
});

const gmailHeaderSchema = z.object({
  name: z.string().min(1),
  value: z.string()
});

const gmailPartBodySchema = z.object({
  attachmentId: z.string().optional(),
  data: z.string().optional(),
  size: z.number().optional()
});

const gmailMessagePartSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(gmailHeaderSchema).optional(),
    body: gmailPartBodySchema.optional(),
    parts: z.array(gmailMessagePartSchema).optional()
  })
);

type GmailMessagePart = z.infer<typeof gmailMessagePartSchema>;

const gmailMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional(),
  historyId: z.string().optional(),
  internalDate: z.string().optional(),
  snippet: z.string().optional(),
  sizeEstimate: z.number().optional(),
  payload: gmailMessagePartSchema.optional()
});

const gmailThreadSchema = z.object({
  id: z.string().min(1),
  historyId: z.string().optional(),
  snippet: z.string().optional(),
  messages: z.array(gmailMessageSchema).optional()
});

const gmailHistoryMessageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  labelIds: z.array(z.string()).optional()
});

const gmailHistoryRecordSchema = z.object({
  id: z.string().min(1),
  messages: z.array(gmailHistoryMessageSchema).optional(),
  messagesAdded: z
    .array(z.object({ message: gmailHistoryMessageSchema }))
    .optional(),
  labelsAdded: z
    .array(z.object({ message: gmailHistoryMessageSchema }))
    .optional(),
  labelsRemoved: z
    .array(z.object({ message: gmailHistoryMessageSchema }))
    .optional()
});

const gmailHistoryResponseSchema = z.object({
  history: z.array(gmailHistoryRecordSchema).optional(),
  historyId: z.string().optional(),
  nextPageToken: z.string().optional()
});

export interface GmailClientConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface GmailAddress {
  name: string | null;
  email: string;
  raw: string;
}

export interface GmailAttachmentMetadata {
  attachmentId: string | null;
  contentId: string | null;
  filename: string | null;
  inline: boolean;
  mimeType: string | null;
  partId: string | null;
  size: number | null;
}

export interface GmailMessageSnapshot {
  gmailMessageId: string;
  gmailThreadId: string;
  historyId: string | null;
  subject: string | null;
  senderName: string | null;
  senderEmail: string;
  toAddresses: GmailAddress[];
  ccAddresses: GmailAddress[];
  bccAddresses: GmailAddress[];
  replyToAddresses: GmailAddress[];
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  hasAttachments: boolean;
  attachmentMetadata: GmailAttachmentMetadata[];
  labelIds: string[];
  sentAt: Date;
  receivedAt: Date | null;
  sizeEstimate: number | null;
}

export interface GmailThreadSnapshot {
  gmailThreadId: string;
  historyId: string | null;
  subject: string | null;
  normalizedSubject: string | null;
  snippet: string | null;
  participants: GmailAddress[];
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  messageCount: number;
  unreadCount: number;
  messages: GmailMessageSnapshot[];
}

export interface GmailMailboxSyncSnapshot {
  threads: GmailThreadSnapshot[];
  newestHistoryId: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
}

export interface GmailMailboxSyncInput {
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  syncCursor?: string | null;
  maxThreads?: number;
}

const toHeaderMap = (
  headers: Array<{ name: string; value: string }> | undefined
): Map<string, string> =>
  new Map(
    (headers ?? []).map((header) => [header.name.toLowerCase(), header.value])
  );

const decodeBase64Url = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf8");

const stripHtml = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"");

const normalizeBodyText = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_STORED_BODY_TEXT_LENGTH);
};

const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const splitAddressHeader = (value: string): string[] =>
  value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => part.trim())
    .filter(Boolean);

const parseEmailAddress = (raw: string): GmailAddress | null => {
  const emailMatch = raw.match(emailRegex);
  if (!emailMatch) {
    return null;
  }

  const email = emailMatch[0].toLowerCase();
  const name = raw
    .replace(emailMatch[0], "")
    .replace(/[<>"]/g, "")
    .trim()
    .replace(/\s+/g, " ");

  return {
    name: name.length > 0 ? name : null,
    email,
    raw
  };
};

const parseEmailAddressList = (value: string | null): GmailAddress[] =>
  value
    ? splitAddressHeader(value)
        .map(parseEmailAddress)
        .filter((address): address is GmailAddress => address !== null)
    : [];

const pickMessageDate = (headerValue: string | undefined, fallback: Date): Date => {
  if (!headerValue) {
    return fallback;
  }

  const parsed = new Date(headerValue);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const parseInternalDate = (internalDate: string | undefined): Date | null => {
  if (!internalDate) {
    return null;
  }

  const milliseconds = Number(internalDate);
  if (Number.isNaN(milliseconds)) {
    return null;
  }

  return new Date(milliseconds);
};

const normalizeSubject = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .trim();

  return normalized.length > 0 ? normalized : null;
};

const mergeParticipants = (messages: GmailMessageSnapshot[]): GmailAddress[] => {
  const participants = new Map<string, GmailAddress>();

  for (const message of messages) {
    const addresses = [
      {
        name: message.senderName,
        email: message.senderEmail,
        raw:
          message.senderName && message.senderName.length > 0
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

const compareHistoryIds = (
  current: string | null,
  candidate: string | null
): string | null => {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  try {
    return BigInt(candidate) > BigInt(current) ? candidate : current;
  } catch {
    return candidate > current ? candidate : current;
  }
};

const collectContent = (
  part: GmailMessagePart | undefined,
  state: {
    plainTextParts: string[];
    htmlParts: string[];
    attachments: GmailAttachmentMetadata[];
  }
): void => {
  if (!part) {
    return;
  }

  const headers = toHeaderMap(part.headers);
  const filename = part.filename?.trim() || null;
  const attachmentId = part.body?.attachmentId ?? null;
  const mimeType = part.mimeType ?? null;
  const contentId = headers.get("content-id") ?? null;
  const disposition = headers.get("content-disposition") ?? "";
  const inline = disposition.toLowerCase().includes("inline");

  if (filename || attachmentId) {
    state.attachments.push({
      attachmentId,
      contentId,
      filename,
      inline,
      mimeType,
      partId: part.partId ?? null,
      size: part.body?.size ?? null
    });
  }

  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);

    if (mimeType === "text/plain") {
      state.plainTextParts.push(decoded);
    } else if (mimeType === "text/html") {
      state.htmlParts.push(decoded);
    }
  }

  for (const nestedPart of part.parts ?? []) {
    collectContent(nestedPart, state);
  }
};

const parseMessage = (message: z.infer<typeof gmailMessageSchema>): GmailMessageSnapshot => {
  const headers = toHeaderMap(message.payload?.headers);
  const receivedAt = parseInternalDate(message.internalDate);
  const fallbackTimestamp = receivedAt ?? new Date();
  const subject = headers.get("subject") ?? null;
  const from = parseEmailAddress(headers.get("from") ?? "");
  const toAddresses = parseEmailAddressList(headers.get("to") ?? null);
  const ccAddresses = parseEmailAddressList(headers.get("cc") ?? null);
  const bccAddresses = parseEmailAddressList(headers.get("bcc") ?? null);
  const replyToAddresses = parseEmailAddressList(headers.get("reply-to") ?? null);

  const content = {
    plainTextParts: [] as string[],
    htmlParts: [] as string[],
    attachments: [] as GmailAttachmentMetadata[]
  };

  collectContent(message.payload, content);

  const plainText = normalizeBodyText(content.plainTextParts.join("\n\n"));
  const rawHtml = content.htmlParts.join("\n\n").trim() || null;
  const htmlFallbackText = normalizeBodyText(stripHtml(rawHtml ?? ""));
  const bodyText = plainText ?? htmlFallbackText;

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    historyId: message.historyId ?? null,
    subject,
    senderName: from?.name ?? null,
    senderEmail: from?.email ?? "unknown@invalid.local",
    toAddresses,
    ccAddresses,
    bccAddresses,
    replyToAddresses,
    snippet: message.snippet ?? null,
    bodyText,
    bodyHtml: rawHtml,
    hasAttachments: content.attachments.length > 0,
    attachmentMetadata: content.attachments,
    labelIds: message.labelIds ?? [],
    sentAt: pickMessageDate(headers.get("date"), fallbackTimestamp),
    receivedAt,
    sizeEstimate: message.sizeEstimate ?? null
  };
};

const parseThread = (thread: z.infer<typeof gmailThreadSchema>): GmailThreadSnapshot | null => {
  const parsedMessages = (thread.messages ?? [])
    .map(parseMessage)
    .sort((left, right) => left.sentAt.getTime() - right.sentAt.getTime());

  if (parsedMessages.length === 0) {
    return null;
  }

  const firstMessage = parsedMessages[0];
  const lastMessage = parsedMessages[parsedMessages.length - 1];

  if (!firstMessage || !lastMessage) {
    return null;
  }

  const subject =
    lastMessage.subject ??
    parsedMessages.find((message) => message.subject)?.subject ??
    null;

  return {
    gmailThreadId: thread.id,
    historyId: thread.historyId ?? null,
    subject,
    normalizedSubject: normalizeSubject(subject),
    snippet: thread.snippet ?? lastMessage.snippet ?? null,
    participants: mergeParticipants(parsedMessages),
    firstMessageAt: firstMessage.sentAt ?? null,
    lastMessageAt: lastMessage.sentAt ?? null,
    messageCount: parsedMessages.length,
    unreadCount: parsedMessages.filter((message) =>
      message.labelIds.includes("UNREAD")
    ).length,
    messages: parsedMessages
  };
};

const isHistoryCursorExpiredError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("notfound") ||
    message.includes("start history id") ||
    message.includes("invalid history") ||
    message.includes("historyid")
  );
};

export class GmailClient {
  constructor(private readonly config: GmailClientConfig) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.clientId &&
        this.config.clientSecret &&
        this.config.redirectUri
    );
  }

  async syncMailbox(input: GmailMailboxSyncInput): Promise<GmailMailboxSyncSnapshot> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
      throw new Error("Google Gmail client is not configured");
    }

    const client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri
    );

    client.setCredentials({
      refresh_token: input.refreshToken,
      ...(input.accessToken ? { access_token: input.accessToken } : {}),
      ...(input.accessTokenExpiresAt
        ? { expiry_date: input.accessTokenExpiresAt.getTime() }
        : {})
    });

    const accessTokenResponse = await client.getAccessToken();
    const gmail = google.gmail({
      version: "v1",
      auth: client
    });

    const cursorValue = input.syncCursor;
    if (cursorValue) {
      try {
        return await this.incrementalSync(gmail, client, {
          ...input,
          syncCursor: cursorValue
        });
      } catch (error) {
        if (isHistoryCursorExpiredError(error)) {
          console.warn("gmail-history-cursor-expired", {
            syncCursor: cursorValue,
            error: error instanceof Error ? error.message : "unknown"
          });
          return this.fullSync(gmail, client, accessTokenResponse, input);
        }
        throw error;
      }
    }

    return this.fullSync(gmail, client, accessTokenResponse, input);
  }

  private async incrementalSync(
    gmail: ReturnType<typeof google.gmail>,
    client: InstanceType<typeof google.auth.OAuth2>,
    input: GmailMailboxSyncInput & { syncCursor: string }
  ): Promise<GmailMailboxSyncSnapshot> {
    const changedThreadIds = new Set<string>();
    let pageToken: string | undefined;
    let newestHistoryId: string | null = input.syncCursor;

    do {
      const historyResponse = await gmail.users.history.list({
        userId: GMAIL_ME,
        startHistoryId: input.syncCursor,
        labelId: INBOX_LABEL_ID,
        historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
        ...(pageToken ? { pageToken } : {})
      });

      const parsed = gmailHistoryResponseSchema.parse(historyResponse.data);
      newestHistoryId = compareHistoryIds(
        newestHistoryId,
        parsed.historyId ?? null
      );

      for (const record of parsed.history ?? []) {
        const allMessages = [
          ...(record.messages ?? []),
          ...(record.messagesAdded ?? []).map((m) => m.message),
          ...(record.labelsAdded ?? []).map((m) => m.message),
          ...(record.labelsRemoved ?? []).map((m) => m.message)
        ];

        for (const msg of allMessages) {
          changedThreadIds.add(msg.threadId);
        }
      }

      pageToken = parsed.nextPageToken;
    } while (pageToken);

    if (changedThreadIds.size === 0) {
      console.info("gmail-incremental-sync-no-changes", {
        syncCursor: input.syncCursor,
        newestHistoryId
      });

      return {
        threads: [],
        newestHistoryId,
        accessToken: client.credentials.access_token ?? null,
        accessTokenExpiresAt: client.credentials.expiry_date
          ? new Date(client.credentials.expiry_date)
          : null
      };
    }

    const threadIds = [...changedThreadIds].slice(0, MAX_THREADS_PER_SYNC);
    const threads: GmailThreadSnapshot[] = [];

    console.info("gmail-incremental-sync-fetching", {
      changedThreads: changedThreadIds.size,
      fetchingThreads: threadIds.length,
      syncCursor: input.syncCursor
    });

    for (const threadId of threadIds) {
      const threadResponse = await gmail.users.threads.get({
        userId: GMAIL_ME,
        id: threadId,
        format: "full"
      });
      const thread = gmailThreadSchema.parse(threadResponse.data);
      const parsedThread = parseThread(thread);

      newestHistoryId = compareHistoryIds(
        newestHistoryId,
        thread.historyId ?? null
      );

      if (!parsedThread) {
        continue;
      }

      const hasInboxMessage = parsedThread.messages.some((msg) =>
        msg.labelIds.includes(INBOX_LABEL_ID)
      );
      if (!hasInboxMessage) {
        continue;
      }

      for (const message of parsedThread.messages) {
        newestHistoryId = compareHistoryIds(newestHistoryId, message.historyId);
      }

      threads.push(parsedThread);
    }

    return {
      threads,
      newestHistoryId,
      accessToken: client.credentials.access_token ?? null,
      accessTokenExpiresAt: client.credentials.expiry_date
        ? new Date(client.credentials.expiry_date)
        : null
    };
  }

  private async fullSync(
    gmail: ReturnType<typeof google.gmail>,
    client: InstanceType<typeof google.auth.OAuth2>,
    accessTokenResponse: { token?: string | null },
    input: GmailMailboxSyncInput
  ): Promise<GmailMailboxSyncSnapshot> {
    const threadListResponse = await gmail.users.threads.list({
      userId: GMAIL_ME,
      labelIds: [INBOX_LABEL_ID],
      maxResults: Math.min(input.maxThreads ?? MAX_THREADS_PER_SYNC, MAX_THREADS_PER_SYNC),
      q: "-in:chats"
    });
    const threadList = gmailThreadListResponseSchema.parse(threadListResponse.data);

    const threads: GmailThreadSnapshot[] = [];
    let newestHistoryId: string | null = null;

    for (const threadStub of threadList.threads ?? []) {
      const threadResponse = await gmail.users.threads.get({
        userId: GMAIL_ME,
        id: threadStub.id,
        format: "full"
      });
      const thread = gmailThreadSchema.parse(threadResponse.data);
      const parsedThread = parseThread(thread);

      newestHistoryId = compareHistoryIds(
        newestHistoryId,
        thread.historyId ?? threadStub.historyId ?? null
      );

      if (!parsedThread) {
        continue;
      }

      for (const message of parsedThread.messages) {
        newestHistoryId = compareHistoryIds(newestHistoryId, message.historyId);
      }

      threads.push(parsedThread);
    }

    return {
      threads,
      newestHistoryId,
      accessToken: accessTokenResponse.token ?? client.credentials.access_token ?? null,
      accessTokenExpiresAt: client.credentials.expiry_date
        ? new Date(client.credentials.expiry_date)
        : null
    };
  }
}
