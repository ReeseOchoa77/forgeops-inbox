export type BiddingIntakeEmailInput = {
  subject: string;
  cleanBody: string;
  /** Deterministic subject cleanup already applied. */
  deterministicProjectName: string | null;
  /**
   * Deterministic project candidate from PDF filenames when confidence is high.
   * Null when filenames are ambiguous — still reason over pdfFilenames.
   */
  deterministicAttachmentProjectName?: string | null;
  /** PDF attachment filenames only (no binaries). Reason across ALL of them. */
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

You are identifying the construction PROJECT, not naming the attached document.

Return ONLY JSON:
{
  "projectName": string | null,
  "alternateProjectNames": string[],
  "bidDueDate": "YYYY-MM-DD" | null,
  "customerCompanyName": string | null
}

CRITICAL — filename ≠ project name:
- Attachment filenames are PROJECT IDENTITY EVIDENCE, not automatic project names.
- Do NOT strip ".pdf" and return the filename as projectName.
- Semantically separate in every filename:
  1) CONTRACTOR / SENDER / COMPANY (who issued the invite)
  2) DOCUMENT PURPOSE (Bid Invite, ITB, Structural Drawings, Specs, Addendum, …)
  3) PROJECT IDENTITY (the job a fab shop would file this under)
  4) REVISION / DATE / DRAWING METADATA
- Example: "CoBeck Bid Invite -Prieto Battery.pdf"
  → customerCompanyName: "CoBeck Construction" (if body/subject supports CoBeck Construction)
  → projectName: "Prieto Battery"
  → NOT projectName: "CoBeck Bid Invite -Prieto Battery"

Reason across ALL pdfFilenames together in ONE pass (never invent a second call):
- Prefer the project identity that REPEATS or agrees semantically across files.
- Exact string equality is NOT required — use semantic agreement.
- Example agreement:
  "CoBeck Bid Invite - Prieto Battery.pdf" + "Prieto Battery Structural Drawings.pdf"
  + "Prieto Battery Specifications.pdf" → projectName "Prieto Battery"
- Example with abbreviation:
  "North Loop Apartments.pdf" + "North Loop Apts - Structural Set.pdf"
  → canonical "North Loop Apartments", alternate "North Loop Apts"
- If files clearly name DIFFERENT projects (Project Alpha vs Project Beta) and
  subject/body do not resolve the conflict: return null for projectName (do not guess).

Document-purpose wrappers (NOT the project) — strip/ignore when a real project remains:
Bid Invite, Bid Invitation, Invitation to Bid, ITB, Request for Bid, Request for Quote,
RFQ, RFP, Bid Documents, Bid Package, Bid Set, Plan Set, Construction Documents,
Architectural Drawings, Structural Drawings, Specifications, Project Manual,
Addendum/Addenda, Proposal, Quote, Estimate, Issued for Bid, IFB.

Company / contractor separation (NO hard-coded contractor list):
- A company name at the start of a filename often identifies who issued the document.
- Use customerCompanyName, sender context, subject, and body to distinguish company vs project.
- Do NOT leave the inviting contractor inside projectName when evidence clearly separates them.
- Unknown companies must be handled the same way as known ones (structural + context cues).

Project identity evidence priority:
1. Project-identifying design/plan PDF filenames (project TITLE portion only)
2. Email subject / title (after invitation boilerplate)
3. Email body (only explicit labeled project identity)
4. deterministicAttachmentProjectName / deterministicProjectName are HINTS only —
   override them when they still contain company or document wrappers.

IGNORE generic PDF filenames that are only document types or sheet codes, including:
A101.pdf, S001.pdf, RFI 14.pdf, ASI 03.pdf, Addendum 2.pdf, Proposal.pdf, Quote.pdf,
Estimate.pdf, Invoice.pdf, Bid Form.pdf, Instructions to Bidders.pdf, Project Manual.pdf,
Specifications.pdf, Structural Drawings.pdf, Architectural Drawings.pdf
These may provide document context but must never become projectName by themselves.
When only generics exist, resolve projectName from subject/body.

Rules for projectName:
- Concise name a steel fabrication shop would use for the Job.
- Prefer the strongest clean canonical form (keep accents when present, e.g. Forté).
- Do NOT return customer/contractor company, person names, document types, bidding platforms,
  drawing disciplines, or revision/date tokens as projectName.
- Prefer null over guessing when evidence conflicts or is weak.

Rules for alternateProjectNames:
- Include OTHER credible project-name forms (abbreviations, shorter titles) that are NOT
  the same as projectName.
- Examples: canonical "North Loop Apartments" → alternate "North Loop Apts".
- Do NOT include raw filenames, document wrappers, customer/contractor names,
  or "Company Bid Invite - Project" composites.
- Prefer [] when there are no meaningful alternatives.

Rules for bidDueDate (CRITICAL — prefer null over guessing):
- Return YYYY-MM-DD ONLY for the BID SUBMISSION / PRICING PROPOSAL deadline.
- Return null for: pre-bid meetings, site visits, RFI/question deadlines, addendum dates,
  project start, delivery, email sent date, ambiguous dates, or multiple conflicting bid deadlines.
- If both a pre-bid meeting and a bid due appear, choose the bid submission due date only.
- If only a pre-bid / RFI / meeting date exists, return null.
- Never invent a date.

Evidence order for customerCompanyName (CRITICAL):
1. EMAIL SUBJECT / TITLE first
2. Then EMAIL BODY (invitation language, "invited by", branding, signature organization)
3. Sender display name / email domain are SUPPORTING only — never invent a Customer from an arbitrary domain.
4. Company tokens peeled from filenames may SUPPORT but must not invent a Customer alone.

Rules for customerCompanyName (CRITICAL — prefer null over guessing):
- Identify the ORGANIZATION / COMPANY acting as the likely customer, general contractor,
  construction manager, or inviting contractor for this bid opportunity.
- Examples of good answers: Mortenson, Ryan Companies, JE Dunn Construction, McGough,
  Kraus-Anderson, Turner Construction, CoBeck Construction.
- DO NOT return:
  - the project name / school / building name (use projectName as exclusion context)
  - an individual person's name (John Smith)
  - the sender display name when it is a person
  - bidding software / platforms (BuildingConnected, Procore, PlanHub, ConstructConnect, Autodesk, etc.)
  - architect / engineer / owner / consultant merely because they are listed, unless context
    clearly shows that organization is the inviting GC/CM/customer
  - generic mailbox providers (gmail, outlook)
- Third-party bidding platforms often send the email; the inviting contractor in the
  body/subject is the Customer, not the platform.
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
    "Task: identify the construction PROJECT and the inviting CUSTOMER/CONTRACTOR separately.",
    "Filenames are evidence — reason across all of them; do not copy a filename as projectName.",
    "Email body:",
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
