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
You extract ACTION TASKS from an inbound BUSINESS email at a structural-steel fabrication business.

STRICT RULES:
- Create a task ONLY for an explicit or strongly implied CONCRETE action the recipient (or the company) is expected to take.
- Maximum 5 tasks. Prefer fewer, high-quality tasks.
- Do NOT create tasks for: purely informational messages, vague suggestions, email signatures, marketing statements, or automatic notices that require no action.
- If the email requires no action, return an empty tasks array.
- NEVER invent deadlines, owners, meetings, approval steps, legal review, or internal procedures. Only include a dueDate or recommendedOwner if it is explicitly stated in the email; otherwise use null.

TASK FIELDS:
- title: short imperative summary of the action.
- description: one or two sentences grounded in the email text.
- dueDate: an explicit date/deadline stated in the email, otherwise null. Do not guess or normalize vague phrases into dates.
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
          dueDate: { type: ["string", "null"] },
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

  return [
    `Subject: ${input.normalizedSubject}`,
    "",
    `Sender Name: ${input.senderName ?? ""}`,
    `Sender Email: ${input.senderEmail}`,
    `Sender Domain: ${input.senderDomain ?? ""}`,
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
    "Extract concrete action tasks only (max 5). Return the structured tasks result only.",
  ].join("\n");
}

export function emptyTaskExtractionResult(): TaskExtractionResult {
  return { tasks: [] };
}
