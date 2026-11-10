/**
 * Workspace-scoped EmailMessage payload for Intelligence Job Matcher email inspector.
 * Bodies loaded on demand — never embedded in evaluation result lists.
 */
import type { PrismaClient } from "@prisma/client";

function asAddressList(value: unknown): Array<{ name: string | null; email: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ name: string | null; email: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const email = (item as { email?: unknown }).email;
    if (typeof email !== "string" || !email.trim()) continue;
    const name = (item as { name?: unknown }).name;
    out.push({
      email: email.trim(),
      name: typeof name === "string" ? name : null,
    });
  }
  return out;
}

export async function loadIntelligenceEvalEmail(input: {
  prisma: PrismaClient;
  workspaceId: string;
  emailMessageId: string;
}) {
  const email = await input.prisma.emailMessage.findFirst({
    where: { id: input.emailMessageId, workspaceId: input.workspaceId },
    select: {
      id: true,
      subject: true,
      senderName: true,
      senderEmail: true,
      toAddresses: true,
      ccAddresses: true,
      direction: true,
      sentAt: true,
      receivedAt: true,
      bodyText: true,
      bodyHtml: true,
      snippet: true,
      hasAttachments: true,
      inboxConnectionId: true,
      jobId: true,
      jobAssignmentSource: true,
      jobAssignmentIsManual: true,
      job: { select: { id: true, name: true, jobNumber: true, status: true } },
      normalizedEmail: { select: { cleanTextBody: true } },
    },
  });

  if (!email) {
    return null;
  }

  const attachments = await input.prisma.emailAttachment.findMany({
    where: { workspaceId: input.workspaceId, emailMessageId: email.id },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      isInline: true,
      uploadStatus: true,
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  return {
    id: email.id,
    subject: email.subject,
    from: {
      name: email.senderName,
      email: email.senderEmail,
    },
    to: asAddressList(email.toAddresses),
    cc: asAddressList(email.ccAddresses),
    direction: email.direction,
    sentAt: email.sentAt,
    receivedAt: email.receivedAt,
    bodyText: email.bodyText ?? email.normalizedEmail?.cleanTextBody ?? email.snippet,
    bodyHtml: email.bodyHtml,
    hasAttachments: email.hasAttachments,
    inboxConnectionId: email.inboxConnectionId,
    jobId: email.jobId,
    jobAssignmentSource: email.jobAssignmentSource,
    jobAssignmentIsManual: email.jobAssignmentIsManual,
    job: email.job,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      isInline: a.isInline,
      uploadStatus: a.uploadStatus,
    })),
  };
}
