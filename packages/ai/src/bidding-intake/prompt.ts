export type BiddingIntakeEmailInput = {
  subject: string;
  cleanBody: string;
  /** Deterministic subject cleanup already applied. */
  deterministicProjectName: string | null;
  /** Deterministic project candidate from PDF attachment filenames (may be null). */
  deterministicAttachmentProjectName?: string | null;
  /** PDF attachment filenames only (no binaries). */
  pdfFilenames?: string[];
  /** Supporting only — never invent Customer from domain alone. */
  senderEmail?: string | null;
  senderName?: string | null;
};

export type BiddingIntakeExtractionResult = {
  projectName: string | null;
  alternateProjectNames: string[];
  bidDueDate: string | null;
  customerCompanyName: string | null;
};

export const biddingIntakeSystemPrompt = `You extract bidding-intake suggestions for a metal fabrication shop CRM.

Return ONLY JSON:
{
  "projectName": string | null,
  "alternateProjectNames": string[],
  "bidDueDate": "YYYY-MM-DD" | null,
  "customerCompanyName": string | null
}

Project identity evidence priority (CRITICAL):
1. Project-identifying design/plan PDF filenames (when they contain a real project title)
2. Email subject / title
3. Email body (only explicit labeled project identity)

IGNORE generic PDF filenames that are only document types or sheet codes, including:
A101.pdf, S001.pdf, RFI 14.pdf, ASI 03.pdf, Addendum 2.pdf, Proposal.pdf, Quote.pdf,
Estimate.pdf, Invoice.pdf, Bid Form.pdf, Instructions to Bidders.pdf, Project Manual.pdf,
Specifications.pdf, Structural Drawings.pdf, Architectural Drawings.pdf

When a filename like "Forte - EP Office Expansion - Structural Drawings.pdf" appears,
the project is the project title portion, NOT "Structural Drawings".

Rules for projectName:
- Prefer deterministicAttachmentProjectName when it is a credible project title.
- Else prefer deterministicProjectName from the subject when it looks like a real project title.
- Only invent/refine from body when BOTH attachment and subject are empty/useless.
- Prefer the strongest clean canonical form (keep accents when present, e.g. Forté).
- Do NOT return customer/contractor company, person names, document types, or bidding platforms as projectName.

Rules for alternateProjectNames:
- Include OTHER credible project-name forms from subject/body/filenames that are NOT the same as projectName.
- Examples: subject "ITB - EP Office Expansion" while canonical is "Forté - EP Office Expansion" → alternate "EP Office Expansion".
- Do NOT include raw noisy filenames, document types, customer names, or duplicates of projectName.
- Prefer [] when there are no meaningful alternatives.

Rules for bidDueDate (CRITICAL — prefer null over guessing):
- Return YYYY-MM-DD ONLY for the BID SUBMISSION / PRICING PROPOSAL deadline.
- Return null for: pre-bid meetings, site visits, RFI/question deadlines, addendum dates, project start, delivery, email sent date, ambiguous dates, or multiple conflicting bid deadlines.
- If both a pre-bid meeting and a bid due appear, choose the bid submission due date only.
- If only a pre-bid / RFI / meeting date exists, return null.
- Never invent a date.

Evidence order for customerCompanyName (CRITICAL):
1. EMAIL SUBJECT / TITLE first
2. Then EMAIL BODY (invitation language, "invited by", branding, signature organization)
3. Sender display name / email domain are SUPPORTING only — never invent a Customer from an arbitrary domain.

Rules for customerCompanyName (CRITICAL — prefer null over guessing):
- Identify the ORGANIZATION / COMPANY acting as the likely customer, general contractor, construction manager, or inviting contractor for this bid opportunity.
- Examples of good answers: Mortenson, Ryan Companies, JE Dunn Construction, McGough, Kraus-Anderson, Turner Construction.
- DO NOT return:
  - the project name / school / building name (use projectName / deterministic names as exclusion context)
  - an individual person's name (John Smith)
  - the sender display name when it is a person
  - bidding software / platforms (BuildingConnected, Procore, PlanHub, ConstructConnect, Autodesk, etc.)
  - architect / engineer / owner / consultant merely because they are listed, unless context clearly shows that organization is the inviting GC/CM/customer
  - generic mailbox providers (gmail, outlook)
- Third-party bidding platforms often send the email; the inviting contractor in the body/subject is the Customer, not the platform.
- Prefer NULL when evidence is weak or conflicting.

json`;

export function buildBiddingIntakeUserPrompt(input: BiddingIntakeEmailInput): string {
  const body = input.cleanBody.trim().slice(0, 6000);
  const pdfs = (input.pdfFilenames ?? []).filter(Boolean).slice(0, 30);
  return [
    `Subject: ${input.subject || "(empty)"}`,
    `deterministicAttachmentProjectName: ${input.deterministicAttachmentProjectName ?? "null"}`,
    `deterministicProjectName: ${input.deterministicProjectName ?? "null"}`,
    `pdfFilenames: ${pdfs.length ? pdfs.join(" | ") : "(none)"}`,
    `senderName: ${input.senderName?.trim() || "(empty)"}`,
    `senderEmail: ${input.senderEmail?.trim() || "(empty)"}`,
    "",
    "Email body (project: PDF filenames first, then subject, then labeled body; company: subject then body):",
    body || "(empty)",
  ].join("\n");
}

export function emptyBiddingIntakeResult(): BiddingIntakeExtractionResult {
  return {
    projectName: null,
    alternateProjectNames: [],
    bidDueDate: null,
    customerCompanyName: null,
  };
}
