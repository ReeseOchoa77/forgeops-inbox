/**
 * Bounded evidence for subtype classification.
 * Current message stays primary. Quoted history and signatures are not subtype evidence.
 * Attachment names are metadata only — file bytes are never read here.
 */

export const SUBTYPE_CLASSIFIER_VERSION = "subtype-v2";

export type SubtypeConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export function subtypeConfidenceBand(confidence: number): SubtypeConfidenceBand {
  if (confidence >= 0.8) return "HIGH";
  if (confidence >= 0.5) return "MEDIUM";
  return "LOW";
}

export interface SubtypeThreadSnippet {
  senderEmail?: string | null;
  subject?: string | null;
  snippet?: string | null;
}

export interface SubtypeJobContext {
  name: string;
  jobNumber?: string | null;
}

export interface SubtypeEvidencePacketInput {
  subject: string;
  cleanBody: string;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  attachmentNames?: string[] | null | undefined;
  threadSnippets?: SubtypeThreadSnippet[] | null | undefined;
  job?: SubtypeJobContext | null | undefined;
  summary?: string | null | undefined;
}

const MAX_CURRENT_BODY = 4_000;
const MAX_THREAD_MESSAGES = 3;
const MAX_SNIPPET = 400;
const MAX_ATTACHMENTS = 12;

export function isolateCurrentMessage(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^>+/.test(trimmed)) break;
    if (/^on .+wrote:$/i.test(trimmed)) break;
    if (/^from:\s/i.test(trimmed) && kept.length > 0) break;
    if (/^sent:\s/i.test(trimmed) && kept.length > 0) break;
    if (/^-{2,}\s*original message\s*-{2,}/i.test(trimmed)) break;
    if (/^_{5,}/.test(trimmed)) break;
    kept.push(line);
  }
  return dropSignature(kept.join("\n")).slice(0, MAX_CURRENT_BODY).trim();
}

function dropSignature(body: string): string {
  const lines = body.split("\n");
  const cut = lines.findIndex((line, index) => {
    if (index < 1) return false;
    const trimmed = line.trim();
    if (trimmed === "--" || trimmed === "—") return true;
    return /^(thanks|thank you|regards|best regards|sincerely|kind regards),?$/i.test(trimmed);
  });
  if (cut < 0) return body;
  return lines.slice(0, cut).join("\n");
}

export function buildSubtypeEvidencePacket(input: SubtypeEvidencePacketInput): {
  subject: string;
  currentMessage: string;
  attachments: string[];
  thread: Array<{ senderEmail: string; subject: string; snippet: string }>;
  sender: { name: string; email: string; domain: string };
  job: { name: string; jobNumber: string } | null;
  summary: string;
} {
  const attachments = (input.attachmentNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .slice(0, MAX_ATTACHMENTS);
  const thread = (input.threadSnippets ?? [])
    .slice(0, MAX_THREAD_MESSAGES)
    .map((row) => ({
      senderEmail: (row.senderEmail ?? "").trim(),
      subject: (row.subject ?? "").trim().slice(0, 200),
      snippet: isolateCurrentMessage(row.snippet ?? "").slice(0, MAX_SNIPPET),
    }))
    .filter((row) => row.subject || row.snippet);

  return {
    subject: input.subject.trim().slice(0, 300),
    currentMessage: isolateCurrentMessage(input.cleanBody),
    attachments,
    thread,
    sender: {
      name: (input.senderName ?? "").trim().slice(0, 120),
      email: input.senderEmail.trim(),
      domain: (input.senderDomain ?? "").trim(),
    },
    job: input.job
      ? {
          name: input.job.name.trim().slice(0, 160),
          jobNumber: (input.job.jobNumber ?? "").trim().slice(0, 40),
        }
      : null,
    summary: (input.summary ?? "").trim().slice(0, 500),
  };
}
