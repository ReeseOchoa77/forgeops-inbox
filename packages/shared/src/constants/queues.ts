export const QueueNames = {
  INBOX_SYNC: "inbox-sync",
  INBOX_ANALYSIS: "inbox-analysis",
  AI_EXTRACTION: "ai-extraction"
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];
