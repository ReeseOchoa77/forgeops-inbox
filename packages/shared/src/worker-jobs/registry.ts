import { QueueNames, type QueueName } from "../constants/queues.js";

export type WorkerJobDisplayState =
  | "QUEUED"
  | "ACTIVE"
  | "PAUSED"
  | "DELAYED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLING"
  | "CANCELLED"
  | "STALE";

export type WorkerJobCapabilities = {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  retry: boolean;
  remove: boolean;
  revert: boolean;
};

const REDACTED = "[redacted]";
const SECRET_KEY = /token|secret|password|authorization|credential|api[_-]?key|database_url|redis|body|html|raw/i;

export type WorkerJobDefinition = {
  queue: QueueName;
  displayName: string;
  purpose: string;
  /** Per-job pause is not implemented. Queue pause is a separate control. */
  pause: false;
  resume: false;
  /** Active jobs can be cooperatively cancelled. */
  cancelActive: boolean;
  revert: false;
  revertReason: string;
};

export const WORKER_JOB_DEFINITIONS: Record<QueueName, WorkerJobDefinition> = {
  [QueueNames.INBOX_SYNC]: {
    queue: QueueNames.INBOX_SYNC,
    displayName: "Mailbox sync",
    purpose: "Live mailbox synchronization. Repeatable schedules stay separate from one execution.",
    pause: false,
    resume: false,
    cancelActive: false,
    revert: false,
    revertReason: "Sync does not record a reversible set of created rows.",
  },
  [QueueNames.INBOX_ANALYSIS]: {
    queue: QueueNames.INBOX_ANALYSIS,
    displayName: "Inbox analysis",
    purpose: "Legacy mailbox analysis pass.",
    pause: false,
    resume: false,
    cancelActive: false,
    revert: false,
    revertReason: "Analysis does not store a previous classification snapshot.",
  },
  [QueueNames.AI_EXTRACTION]: {
    queue: QueueNames.AI_EXTRACTION,
    displayName: "AI extraction",
    purpose: "Named queue with no active worker registration.",
    pause: false,
    resume: false,
    cancelActive: false,
    revert: false,
    revertReason: "No reversible effect journal exists.",
  },
  [QueueNames.ATTACHMENT_INGEST]: {
    queue: QueueNames.ATTACHMENT_INGEST,
    displayName: "Attachment ingest",
    purpose: "Download and store attachments for one email.",
    pause: false,
    resume: false,
    cancelActive: false,
    revert: false,
    revertReason: "Stored attachments may already be referenced. Removing the job does not delete them.",
  },
  [QueueNames.MAILBOX_HISTORICAL_IMPORT]: {
    queue: QueueNames.MAILBOX_HISTORICAL_IMPORT,
    displayName: "Historical import",
    purpose: "Explicit historical mailbox import. Live sync still honors inboxClearedAt.",
    pause: false,
    resume: false,
    cancelActive: true,
    revert: false,
    revertReason: "Imported messages are not journaled separately from mail that already existed.",
  },
  [QueueNames.MAILBOX_CLASSIFY]: {
    queue: QueueNames.MAILBOX_CLASSIFY,
    displayName: "Mailbox classify",
    purpose: "Classify one email. Too short to pause.",
    pause: false,
    resume: false,
    cancelActive: false,
    revert: false,
    revertReason: "Previous classification state is not stored, so it cannot be restored.",
  },
  [QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE]: {
    queue: QueueNames.PROJECT_FOLDER_EMAIL_ANALYZE,
    displayName: "Project folder analysis",
    purpose: "Import mail from verified project folders. Removing the job does not remove folder mappings.",
    pause: false,
    resume: false,
    cancelActive: false,
    revert: false,
    revertReason: "This run does not record which rows it created versus reused.",
  },
  [QueueNames.MAILBOX_RECLASSIFY]: {
    queue: QueueNames.MAILBOX_RECLASSIFY,
    displayName: "Mailbox reclassify",
    purpose: "Batch reclassification. Cancellation is cooperative between batches.",
    pause: false,
    resume: false,
    cancelActive: true,
    revert: false,
    revertReason: "Previous classifications are not snapshotted for this run.",
  },
};

export function isKnownQueue(value: string): value is QueueName {
  return Object.values(QueueNames).includes(value as QueueName);
}

export function displayStateForBull(state: string, runStatus?: string | null): WorkerJobDisplayState {
  if (runStatus === "CANCELLING") return "CANCELLING";
  if (runStatus === "CANCELLED") return "CANCELLED";
  switch (state) {
    case "waiting":
    case "waiting-children":
      return "QUEUED";
    case "active":
      return "ACTIVE";
    case "delayed":
      return "DELAYED";
    case "paused":
      return "PAUSED";
    case "completed":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    default:
      return "STALE";
  }
}

export function capabilitiesForJob(input: {
  queue: QueueName;
  bullState: string;
  runStatus?: string | null;
}): WorkerJobCapabilities {
  const def = WORKER_JOB_DEFINITIONS[input.queue];
  const state = input.bullState;
  const waiting =
    state === "waiting" ||
    state === "delayed" ||
    state === "paused" ||
    state === "waiting-children" ||
    state === "prioritized";
  const active = state === "active";
  const terminal =
    input.runStatus === "COMPLETED" ||
    input.runStatus === "FAILED" ||
    input.runStatus === "CANCELLED" ||
    input.runStatus === "CANCELLING";
  return {
    pause: false,
    resume: false,
    cancel: waiting || (active && def.cancelActive && !terminal),
    retry: state === "failed",
    remove: state !== "active" && state !== "missing",
    revert: false,
  };
}

export function sanitizeJobData(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 240) return `${value.slice(0, 240)}…`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeJobData(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : sanitizeJobData(child, depth + 1);
    }
    return out;
  }
  return String(value);
}
