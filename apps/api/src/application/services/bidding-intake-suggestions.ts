import {
  createOpenAIClient,
  OpenAIBiddingIntakeExtractor,
} from "@forgeops/ai";
import {
  extractBidDueDateDeterministic,
  sanitizeBiddingCustomerCompanyName,
  suggestBidProjectNameFromSubject,
  suggestNextJobNumberFromList,
} from "@forgeops/shared";
import type { PrismaClient } from "@prisma/client";

import {
  loadWorkspaceCustomerMatchInputs,
  resolveBiddingCustomerName,
  type BiddingCustomerResolveStatus,
} from "./resolve-bidding-customer.js";

export type BiddingIntakeSuggestions = {
  projectName: string | null;
  projectNameSource: "subject_cleanup" | "ai" | null;
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
 * Prepare Add-to-Bidding form suggestions. Never creates a Job, Customer,
 * or EmailMessage.jobId assignment.
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

  const deterministicName = suggestBidProjectNameFromSubject(subject);

  const jobRows = await input.prisma.job.findMany({
    where: { workspaceId: input.workspaceId, jobNumber: { not: null } },
    select: { jobNumber: true },
  });
  const jobNumber = suggestNextJobNumberFromList(
    jobRows.map((r) => r.jobNumber)
  );

  let projectName = deterministicName;
  let projectNameSource: BiddingIntakeSuggestions["projectNameSource"] =
    deterministicName ? "subject_cleanup" : null;
  let bidDueAt = extractBidDueDateDeterministic({
    subject,
    bodyText: body,
  });
  let bidDueSource: BiddingIntakeSuggestions["bidDueSource"] = bidDueAt
    ? "deterministic"
    : null;
  let rawCustomerCompany: string | null = null;

  // One AI call when configured — project refine + bid due + customer company.
  if (input.openaiApiKey?.trim()) {
    const client = createOpenAIClient({ apiKey: input.openaiApiKey.trim() });
    const extractor = new OpenAIBiddingIntakeExtractor(
      client,
      input.openaiModel?.trim() || undefined
    );
    const ai = await extractor.extract({
      subject,
      cleanBody: body,
      deterministicProjectName: deterministicName,
      senderEmail: message.senderEmail,
      senderName: message.senderName,
    });
    if (!bidDueAt && ai.bidDueDate) {
      bidDueAt = ai.bidDueDate;
      bidDueSource = "ai";
    }
    if (!projectName && ai.projectName) {
      projectName = ai.projectName;
      projectNameSource = "ai";
    } else if (
      projectName &&
      ai.projectName &&
      ai.projectName !== projectName &&
      /^(invitation|itb|bid invitation|reminder)/i.test(projectName)
    ) {
      projectName = ai.projectName;
      projectNameSource = "ai";
    }
    rawCustomerCompany = ai.customerCompanyName;
  }

  const sanitizedCompany = sanitizeBiddingCustomerCompanyName({
    companyName: rawCustomerCompany,
    projectName,
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
    projectName,
    projectNameSource,
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
