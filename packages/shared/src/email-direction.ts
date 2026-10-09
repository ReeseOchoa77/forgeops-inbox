/**
 * Canonical EmailMessage.direction helpers.
 * Provider Sent Items folder is authoritative for SENT.
 */

export type EmailDirectionValue = "RECEIVED" | "SENT";

/** Merge direction on refresh: SENT is sticky; never downgrade SENT → RECEIVED. */
export function mergeEmailDirection(input: {
  existing: EmailDirectionValue | null | undefined;
  incoming: EmailDirectionValue | null | undefined;
}): EmailDirectionValue | null {
  if (input.existing === "SENT" || input.incoming === "SENT") return "SENT";
  if (input.incoming === "RECEIVED" || input.existing === "RECEIVED") {
    return "RECEIVED";
  }
  return null;
}

/**
 * Prisma WHERE fragment for Inbox list sent/received filters.
 * Prefer canonical direction; fall back to sender∈monitored for legacy null rows.
 */
export function emailDirectionListWhere(input: {
  sentOnly: boolean;
  monitoredEmails: string[];
}): Record<string, unknown> {
  const monitored = input.monitoredEmails
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (input.sentOnly) {
    if (monitored.length === 0) {
      return { id: "__no_monitored_inboxes__" };
    }
    return {
      OR: [
        { direction: "SENT" },
        {
          AND: [
            { direction: null },
            {
              senderEmail: { in: monitored, mode: "insensitive" as const },
            },
          ],
        },
      ],
    };
  }

  if (monitored.length === 0) {
    return {
      OR: [{ direction: "RECEIVED" }, { direction: null }],
    };
  }

  return {
    OR: [
      { direction: "RECEIVED" },
      {
        AND: [
          { direction: null },
          {
            senderEmail: { notIn: monitored, mode: "insensitive" as const },
          },
        ],
      },
    ],
  };
}
