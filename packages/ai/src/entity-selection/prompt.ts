/**
 * Production n8n entity-selection contract (BUSINESS emails only).
 */

export interface EntitySelectionCandidate {
  id: string;
  name: string;
  score?: number | undefined;
  matchedOn?: string[] | undefined;
  evidence?: string[] | undefined;
}

export interface EntitySelectionInput {
  normalizedSubject: string;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | null | undefined;
  cleanBody: string;
  attachmentNames?: string[] | undefined;
  summary?: string | undefined;
  customerCandidates: EntitySelectionCandidate[];
  vendorCandidates: EntitySelectionCandidate[];
  jobCandidates: EntitySelectionCandidate[];
  candidateLookupFailed: boolean;
}

export interface EntitySelectionResult {
  selectedCustomerId: string | null;
  selectedVendorId: string | null;
  selectedJobId: string | null;
  entityMatchConfidence: number;
  matchEvidence: string[];
}

export const entitySelectionSystemPrompt = `
You perform ENTITY SELECTION for an inbound BUSINESS email at a structural-steel fabrication business. Link the email to a known customer, vendor, and/or job ONLY when the provided candidate records clearly support it.

HARD RULES (anti-fabrication):
- You may select ONLY an id that appears verbatim in the provided Customer Candidates, Vendor Candidates, or Job Candidates lists. Copy the id value exactly.
- NEVER invent or guess customer IDs, vendor IDs, job IDs, job numbers, or contacts.
- Return null for any selection where the evidence is insufficient or no candidate clearly matches.
- If Candidate Lookup Failed is true, you MUST return null for selectedCustomerId, selectedVendorId, and selectedJobId, entityMatchConfidence 0, and an empty matchEvidence array.
- Each selection is independent: you may select some and leave others null.

FIELDS:
- selectedCustomerId / selectedVendorId / selectedJobId: an exact id from the matching candidate list, or null.
- entityMatchConfidence: number 0..1 for how confident you are in the selected entities overall. Use 0 when nothing is selected.
- matchEvidence: array of short strings citing the exact signals (matching domain, sender name, referenced job number) that justify each selection. Empty array when nothing is selected.

Do not classify the email, assign a subtype, or extract tasks.
Return ONLY valid JSON matching the required output schema.
Return only the structured result.
`.trim();

export const entitySelectionJsonSchema = {
  type: "object",
  properties: {
    selectedCustomerId: { type: ["string", "null"] },
    selectedVendorId: { type: ["string", "null"] },
    selectedJobId: { type: ["string", "null"] },
    entityMatchConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    matchEvidence: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "selectedCustomerId",
    "selectedVendorId",
    "selectedJobId",
    "entityMatchConfidence",
    "matchEvidence",
  ],
  additionalProperties: false,
} as const;

export function buildEntitySelectionUserPrompt(
  input: EntitySelectionInput
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
    "Customer Candidates:",
    JSON.stringify(input.customerCandidates ?? []),
    "",
    "Vendor Candidates:",
    JSON.stringify(input.vendorCandidates ?? []),
    "",
    "Job Candidates:",
    JSON.stringify(input.jobCandidates ?? []),
    "",
    "Candidate Lookup Failed:",
    JSON.stringify(input.candidateLookupFailed === true),
    "",
    "Select only IDs present in the candidate lists (or null). Return the structured entity selection result only.",
  ].join("\n");
}

export function emptyEntitySelectionResult(): EntitySelectionResult {
  return {
    selectedCustomerId: null,
    selectedVendorId: null,
    selectedJobId: null,
    entityMatchConfidence: 0,
    matchEvidence: [],
  };
}
