import {
  createOpenAIClient,
  OpenAIBiddingIntakeExtractor,
} from "@forgeops/ai";
import {
  extractBidDueDateDeterministic,
  extractProjectIdentityFromPdfFilenames,
  resolveBidProjectIdentity,
  sanitizeBiddingCustomerCompanyName,
  suggestBidProjectNameFromSubject,
  suggestNextJobNumberFromList,
  type BidProjectNameSource,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";

import {
  loadWorkspaceCustomerMatchInputs,
  resolveBiddingCustomerName,
  type BiddingCustomerResolveStatus,
} from "./resolve-bidding-customer.js";

export type BiddingIntakeSuggestions = {
  projectName: string | null;
  projectNameSource: BidProjectNameSource;
  alternateProjectNames: string[];
  jobNumber: string | null;
  bidDueAt: string | null;
  bidDueSource: "deterministic" | "ai" | null;
  customer: {
    status: BiddingCustomerResolveStatus;
    customerId: string | null;
    customerName: string | null;
    candidates: Array<{ id: string; name: string; score: number }>;
  };
};

/**
 * Prepare Add-to-Bidding / Create Job form suggestions. Never creates a Job,
 * Customer, EntityAlias, or EmailMessage.jobId assignment.
 */
export async function buildBiddingIntakeSuggestions(input: {
  prisma: PrismaClient;
  workspaceId: string;
  messageId: string;
  openaiApiKey?: string | null;
  openaiModel?: string | null;
}): Promise<BiddingIntakeSuggestions | null> {
  const message = await input.prisma.emailMessage.findFirst({
    where: {
      id: input.messageId,
      workspaceId: input.workspaceId,
      isTrashed: false,
    },
    select: {
      id: true,
      subject: true,
      bodyText: true,
      senderEmail: true,
      senderName: true,
      normalizedEmail: {
        select: {
          cleanTextBody: true,
          normalizedSubject: true,
          subject: true,
        },
      },
      attachments: {
        where: { isInline: false },
        select: { filename: true, mimeType: true },
        take: 40,
      },
    },
  });
  if (!message) return null;

  const subject =
    message.normalizedEmail?.normalizedSubject?.trim() ||
    message.normalizedEmail?.subject?.trim() ||
    message.subject?.trim() ||
    "";
  const body =
    message.normalizedEmail?.cleanTextBody?.trim() ||
    message.bodyText?.trim() ||
    "";

  const pdfFilenames = (message.attachments ?? [])
    .filter(
      (a) =>
        /\.pdf$/i.test(a.filename) ||
        a.mimeType?.toLowerCase() === "application/pdf"
    )
    .map((a) => a.filename);

  const attachmentEvidence = extractProjectIdentityFromPdfFilenames(pdfFilenames);
  const subjectDeterministic = suggestBidProjectNameFromSubject(subject);

  const jobRows = await input.prisma.job.findMany({
    where: { workspaceId: input.workspaceId, jobNumber: { not: null } },
    select: { jobNumber: true },
  });
  const jobNumber = suggestNextJobNumberFromList(
    jobRows.map((r) => r.jobNumber)
  );

  let bidDueAt = extractBidDueDateDeterministic({
    subject,
    bodyText: body,
  });
  let bidDueSource: BiddingIntakeSuggestions["bidDueSource"] = bidDueAt
    ? "deterministic"
    : null;
  let rawCustomerCompany: string | null = null;
  let aiProjectName: string | null = null;
  let aiAlternateProjectNames: string[] = [];

  // One AI call when configured — project + alternates + bid due + customer.
  if (input.openaiApiKey?.trim()) {
    const client = createOpenAIClient({ apiKey: input.openaiApiKey.trim() });
    const extractor = new OpenAIBiddingIntakeExtractor(
      client,
      input.openaiModel?.trim() || undefined
    );
    const ai = await extractor.extract({
      subject,
      cleanBody: body,
      deterministicProjectName: subjectDeterministic,
      deterministicAttachmentProjectName: attachmentEvidence.projectName,
      pdfFilenames,
      senderEmail: message.senderEmail,
      senderName: message.senderName,
    });
    if (!bidDueAt && ai.bidDueDate) {
      bidDueAt = ai.bidDueDate;
      bidDueSource = "ai";
    }
    aiProjectName = ai.projectName;
    aiAlternateProjectNames = ai.alternateProjectNames;
    rawCustomerCompany = ai.customerCompanyName;
  }

  const identity = resolveBidProjectIdentity({
    pdfFilenames,
    subject,
    bodyText: body,
    aiProjectName,
    aiAlternateProjectNames,
  });

  const sanitizedCompany = sanitizeBiddingCustomerCompanyName({
    companyName: rawCustomerCompany,
    projectName: identity.projectName,
  });

  let customer: BiddingIntakeSuggestions["customer"] = {
    status: "NONE",
    customerId: null,
    customerName: null,
    candidates: [],
  };

  if (sanitizedCompany) {
    const matchInputs = await loadWorkspaceCustomerMatchInputs(
      input.prisma,
      input.workspaceId
    );
    const resolved = resolveBiddingCustomerName(sanitizedCompany, matchInputs);
    customer = {
      status: resolved.status,
      customerId: resolved.customerId,
      customerName: resolved.customerName,
      candidates: resolved.candidates,
    };
  }

  return {
    projectName: identity.projectName,
    projectNameSource: identity.projectNameSource,
    alternateProjectNames: identity.alternateProjectNames,
    jobNumber,
    bidDueAt,
    bidDueSource,
    customer,
  };
}

/** DB-backed next job number suggestion (no reservation). */
export async function suggestNextJobNumberForWorkspace(
  prisma: PrismaClient,
  workspaceId: string
): Promise<string | null> {
  const jobRows = await prisma.job.findMany({
    where: { workspaceId, jobNumber: { not: null } },
    select: { jobNumber: true },
  });
  return suggestNextJobNumberFromList(jobRows.map((r) => r.jobNumber));
}
