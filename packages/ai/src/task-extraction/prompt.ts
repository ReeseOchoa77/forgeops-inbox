/**
 * Production n8n task-extraction contract (BUSINESS emails only).
 */

export interface TaskExtractionEmailInput {
  normalizedSubject: string;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  cleanBody: string;
  attachmentNames?: string[] | undefined;
  summary?: string | undefined;
  containsActionRequest: boolean;
  /**
   * When present (e.g. BID_OPPORTUNITY / BID_UPDATE), treat the opportunity's
   * own bid/proposal submission deadline as metadata — not an ordinary Task.
   */
  businessTypeKey?: string | null | undefined;
  /** Canonical mail direction relative to the monitored mailbox. */
  direction?: "RECEIVED" | "SENT" | null | undefined;
  monitoredMailboxEmail?: string | null | undefined;
  toAddresses?: string[] | undefined;
}

export interface ExtractedTask {
  title: string;
  description: string;
  dueDate: string | null;
  recommendedOwner: string | null;
  confidence: number;
}

export interface TaskExtractionResult {
  tasks: ExtractedTask[];
}

export const taskExtractionSystemPrompt = `
You extract ACTION TASKS from a BUSINESS email at a structural-steel fabrication business.

EMAIL DIRECTION (critical):
- RECEIVED: someone wrote TO the monitored mailbox. Imperatives/questions usually ask OUR company to act → potential ForgeOps tasks.
- SENT: the monitored mailbox wrote TO someone else.
  - SENT OUTBOUND REQUEST ("Can you send us the drawings?") asks the EXTERNAL party to act → do NOT create a ForgeOps task for that work.
  - SENT COMMITMENT ("We will send revised pricing Friday.") is OUR obligation → may create a ForgeOps task.
  - Purely informational SENT mail → empty tasks array.

STRICT RULES:
- Create a task ONLY for an explicit or strongly implied CONCRETE action OUR company (the monitored mailbox / ForgeOps team) is expected to take.
- Maximum 5 tasks. Prefer fewer, high-quality tasks.
- Do NOT create tasks for: purely informational messages, vague suggestions, email signatures, marketing statements, or automatic notices that require no action.
- Do NOT create tasks that assign work to an external recipient when DIRECTION is SENT and the request is outbound.
- If the email requires no action from our company, return an empty tasks array.
- NEVER invent deadlines, owners, meetings, approval steps, legal review, or internal procedures. Only include a dueDate or recommendedOwner if it is explicitly stated in the email; otherwise use null.
- A deadline alone does NOT automatically imply a Task.

BIDDING OPPORTUNITIES (critical):
- When Business Type is BID_OPPORTUNITY or BID_UPDATE (or the email is clearly an invitation to bid / ITB / RFP opportunity), the deadline for submitting the bid, proposal, quote, or pricing for that opportunity is OPPORTUNITY METADATA — not an ordinary Task.
- Do NOT create tasks such as: "Submit bid", "Submit proposal", "Provide pricing", "Bid due", "Proposal due", "Complete bid", or "Respond to ITB" merely because the invitation has a submission deadline.
- Unpursued bid invitations must not flood the Tasks list. The shop decides later via Add to Bidding whether to pursue the opportunity.
- DO create Tasks for DISTINCT actions beyond submitting the opportunity itself, when explicitly requested, for example:
  - Confirm intent / participation to bid
  - RSVP for a pre-bid meeting or walkthrough
  - Submit bidder questions / RFIs by a stated date
  - Submit a substitution request
  - Provide insurance certificates or other documents for a walkthrough
- Mixed emails: keep the distinct action Task(s); omit the bid-submission Task.
- BID_UPDATE that only extends/changes the bid deadline: return an empty tasks array (do not create "Update bid" / "Submit bid").
- ESTIMATE_QUOTE and other non-ITB subtypes: normal task rules apply. Do not suppress legitimate quote/contract work merely because words like quote, pricing, or estimate appear.

TASK FIELDS:
- title: short imperative summary of the DISTINCT action (not the project name, not "Bid opportunity", not "Bid deadline").
- description: one or two sentences grounded in the email text.
- dueDate: ISO 8601 datetime (e.g. "2026-09-02T00:00:00.000Z") when an explicit calendar deadline for THAT action is stated; otherwise null. Never invent dates, never return relative phrases ("ASAP", "Friday", "end of week"), and never guess. Do not attach the opportunity's bid submission deadline to an unrelated Task.
- recommendedOwner: a person explicitly named as responsible in the email, otherwise null.
- confidence: number 0..1 for how clearly the email supports this task.

Return ONLY valid JSON matching the required output schema.
Return only the structured result with the tasks array.
`.trim();

export const taskExtractionJsonSchema = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          dueDate: {
            type: ["string", "null"],
            description:
              "ISO 8601 datetime string when an explicit deadline is stated, otherwise null",
          },
          recommendedOwner: { type: ["string", "null"] },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: ["title", "description", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
} as const;

export function buildTaskExtractionUserPrompt(
  input: TaskExtractionEmailInput
): string {
  const attachments =
    input.attachmentNames && input.attachmentNames.length > 0
      ? input.attachmentNames.join(", ")
      : "None";

  const recipients =
    input.toAddresses && input.toAddresses.length > 0
      ? input.toAddresses.join(", ")
      : "(unknown)";

  return [
    `Subject: ${input.normalizedSubject}`,
    "",
    `Email Direction: ${input.direction ?? "RECEIVED"}`,
    `Monitored Mailbox: ${input.monitoredMailboxEmail ?? ""}`,
    `Sender Name: ${input.senderName ?? ""}`,
    `Sender Email: ${input.senderEmail}`,
    `Sender Domain: ${input.senderDomain ?? ""}`,
    `To: ${recipients}`,
    "",
    "Business Type:",
    input.businessTypeKey?.trim() || "(unknown)",
    "",
    "Clean Body:",
    input.cleanBody,
    "",
    "Attachments:",
    attachments,
    "",
    "Summary:",
    input.summary ?? "",
    "",
    "Contains Action Request:",
    JSON.stringify(input.containsActionRequest === true),
    "",
    "Extract concrete action tasks for OUR company only (max 5). For SENT outbound requests to external parties, return empty tasks. For bidding opportunities, omit bid-submission deadline tasks; keep only distinct actionable work. Return the structured tasks result only.",
  ].join("\n");
}

export function emptyTaskExtractionResult(): TaskExtractionResult {
  return { tasks: [] };
}
