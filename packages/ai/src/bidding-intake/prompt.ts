export type BiddingIntakeEmailInput = {
  subject: string;
  cleanBody: string;
  /** Deterministic subject cleanup already applied — AI may refine only if still noisy. */
  deterministicProjectName: string | null;
  /** Supporting only — never invent Customer from domain alone. */
  senderEmail?: string | null;
  senderName?: string | null;
};

export type BiddingIntakeExtractionResult = {
  projectName: string | null;
  bidDueDate: string | null;
  customerCompanyName: string | null;
};

export const biddingIntakeSystemPrompt = `You extract bidding-intake suggestions for a metal fabrication shop CRM.

Return ONLY JSON:
{
  "projectName": string | null,
  "bidDueDate": "YYYY-MM-DD" | null,
  "customerCompanyName": string | null
}

Evidence order for customerCompanyName (CRITICAL):
1. EMAIL SUBJECT / TITLE first
2. Then EMAIL BODY (invitation language, "invited by", branding, signature organization)
3. Sender display name / email domain are SUPPORTING only — never invent a Customer from an arbitrary domain.

Rules for projectName:
- Prefer the deterministicProjectName when it already looks like a real project title.
- Only change projectName when the deterministic value still contains invitation boilerplate or is empty/useless.
- Project name MUST come from the email SUBJECT / title, not invented from body.
- Do not invent a different project.

Rules for bidDueDate (CRITICAL — prefer null over guessing):
- Return YYYY-MM-DD ONLY for the BID SUBMISSION / PRICING PROPOSAL deadline.
- Return null for: pre-bid meetings, site visits, RFI/question deadlines, addendum dates, project start, delivery, email sent date, ambiguous dates, or multiple conflicting bid deadlines.
- If both a pre-bid meeting and a bid due appear, choose the bid submission due date only.
- If only a pre-bid / RFI / meeting date exists, return null.
- Never invent a date.

Rules for customerCompanyName (CRITICAL — prefer null over guessing):
- Identify the ORGANIZATION / COMPANY acting as the likely customer, general contractor, construction manager, or inviting contractor for this bid opportunity.
- Examples of good answers: Mortenson, Ryan Companies, JE Dunn Construction, McGough, Kraus-Anderson, Turner Construction.
- DO NOT return:
  - the project name / school / building name (use deterministicProjectName as exclusion context)
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
  return [
    `Subject: ${input.subject || "(empty)"}`,
    `deterministicProjectName: ${input.deterministicProjectName ?? "null"}`,
    `senderName: ${input.senderName?.trim() || "(empty)"}`,
    `senderEmail: ${input.senderEmail?.trim() || "(empty)"}`,
    "",
    "Email body (subject first for company; body/signature for fallback company + bid-due evidence):",
    body || "(empty)",
  ].join("\n");
}

export function emptyBiddingIntakeResult(): BiddingIntakeExtractionResult {
  return { projectName: null, bidDueDate: null, customerCompanyName: null };
}
