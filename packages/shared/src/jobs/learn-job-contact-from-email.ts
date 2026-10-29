import { isAuthoritativeEmailJobAssignment } from "../project-folders/verified-folder-job-assignment.js";
import {
  extractDomain,
  isValidEmailFormat,
  normalizeEmail,
} from "../reference/normalize.js";

export type JobEmailContactLearningSource =
  | "LEARNED_FROM_EMAIL"
  | "MANUAL";

export type JobEmailContactLearnResult =
  | { status: "learned"; contactId: string; jobEmailContactId: string; createdContact: boolean }
  | { status: "skipped"; reason: string };

type EmailForContactLearning = {
  id: string;
  workspaceId: string;
  jobId: string | null;
  senderEmail: string | null;
  senderName: string | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  jobAssignmentSource: string | null;
  jobAssignmentIsManual: boolean | null;
};

type ContactRow = {
  id: string;
  name: string | null;
  email: string | null;
  normalizedEmail: string | null;
};

type JobEmailContactRow = {
  id: string;
  source: string;
  firstEmailMessageId: string | null;
};

export type JobEmailContactPrisma = {
  emailMessage: {
    findMany: (args: {
      where: { workspaceId: string; id: { in: string[] } };
      select: {
        id: true;
        workspaceId: true;
        jobId: true;
        senderEmail: true;
        senderName: true;
        receivedAt: true;
        sentAt: true;
        jobAssignmentSource: true;
        jobAssignmentIsManual: true;
      };
    }) => Promise<EmailForContactLearning[]>;
  };
  entityContact: {
    findFirst: (args: {
      where: {
        workspaceId: string;
        OR: Array<
          | { normalizedEmail: string }
          | { email: { equals: string; mode: "insensitive" } }
        >;
      };
      orderBy: { createdAt: "asc" };
      select: {
        id: true;
        name: true;
        email: true;
        normalizedEmail: true;
      };
    }) => Promise<ContactRow | null>;
    create: (args: {
      data: {
        workspaceId: string;
        email: string;
        normalizedEmail: string;
        name: string | null;
        domain: string | null;
        customerId: null;
        vendorId: null;
      };
      select: {
        id: true;
        name: true;
        email: true;
        normalizedEmail: true;
      };
    }) => Promise<ContactRow>;
    update: (args: {
      where: { id: string };
      data: { name: string };
      select: {
        id: true;
        name: true;
        email: true;
        normalizedEmail: true;
      };
    }) => Promise<ContactRow>;
  };
  jobEmailContact: {
    findUnique: (args: {
      where: { jobId_contactId: { jobId: string; contactId: string } };
      select: { id: true; source: true; firstEmailMessageId: true };
    }) => Promise<JobEmailContactRow | null>;
    create: (args: {
      data: {
        workspaceId: string;
        jobId: string;
        contactId: string;
        source: "LEARNED_FROM_EMAIL";
        firstEmailMessageId: string;
        lastSeenAt: Date;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: { lastSeenAt: Date };
    }) => Promise<{ id: string }>;
  };
};

export function shouldLearnJobEmailContact(input: {
  jobId?: string | null;
  jobAssignmentIsManual?: boolean | null;
  jobAssignmentSource?: string | null;
}): boolean {
  if (!input.jobId) return false;
  return isAuthoritativeEmailJobAssignment(input);
}

function usefulDisplayName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function seenAt(email: EmailForContactLearning, fallback: Date): Date {
  return email.receivedAt ?? email.sentAt ?? fallback;
}

async function findWorkspaceContactByEmail(
  prisma: JobEmailContactPrisma,
  workspaceId: string,
  normalized: string
): Promise<{
  id: string;
  name: string | null;
  email: string | null;
  normalizedEmail: string | null;
} | null> {
  return prisma.entityContact.findFirst({
    where: {
      workspaceId,
      OR: [
        { normalizedEmail: normalized },
        { email: { equals: normalized, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, normalizedEmail: true },
  });
}

/**
 * Remember the sender on a Job when the email already has a confirmed
 * USER_ASSIGNED / manual / VERIFIED_PROJECT_FOLDER association.
 * Does not delete contacts. Does not match Jobs.
 */
export async function learnJobContactFromEmail(
  prisma: JobEmailContactPrisma,
  email: EmailForContactLearning,
  now: Date = new Date()
): Promise<JobEmailContactLearnResult> {
  if (email.workspaceId.trim() === "") {
    return { status: "skipped", reason: "missing_workspace" };
  }
  if (!shouldLearnJobEmailContact(email)) {
    return { status: "skipped", reason: "not_confirmed_assignment" };
  }

  const rawEmail = email.senderEmail?.trim() ?? "";
  if (!rawEmail || !isValidEmailFormat(rawEmail)) {
    return { status: "skipped", reason: "invalid_sender_email" };
  }

  const normalized = normalizeEmail(rawEmail);
  const displayName = usefulDisplayName(email.senderName);
  const jobId = email.jobId!;

  let createdContact = false;
  let contact = await findWorkspaceContactByEmail(
    prisma,
    email.workspaceId,
    normalized
  );

  if (!contact) {
    contact = await prisma.entityContact.create({
      data: {
        workspaceId: email.workspaceId,
        email: normalized,
        normalizedEmail: normalized,
        name: displayName,
        domain: extractDomain(normalized),
        customerId: null,
        vendorId: null,
      },
      select: { id: true, name: true, email: true, normalizedEmail: true },
    });
    createdContact = true;
  } else if (!usefulDisplayName(contact.name) && displayName) {
    contact = await prisma.entityContact.update({
      where: { id: contact.id },
      data: { name: displayName },
      select: { id: true, name: true, email: true, normalizedEmail: true },
    });
  }

  const existingLink = await prisma.jobEmailContact.findUnique({
    where: { jobId_contactId: { jobId, contactId: contact.id } },
    select: { id: true, source: true, firstEmailMessageId: true },
  });

  if (existingLink) {
    await prisma.jobEmailContact.update({
      where: { id: existingLink.id },
      data: { lastSeenAt: seenAt(email, now) },
    });
    return {
      status: "learned",
      contactId: contact.id,
      jobEmailContactId: existingLink.id,
      createdContact,
    };
  }

  const created = await prisma.jobEmailContact.create({
    data: {
      workspaceId: email.workspaceId,
      jobId,
      contactId: contact.id,
      source: "LEARNED_FROM_EMAIL",
      firstEmailMessageId: email.id,
      lastSeenAt: seenAt(email, now),
    },
    select: { id: true },
  });

  return {
    status: "learned",
    contactId: contact.id,
    jobEmailContactId: created.id,
    createdContact,
  };
}

export async function learnJobContactsFromEmails(
  prisma: JobEmailContactPrisma,
  input: {
    workspaceId: string;
    emailMessageIds: string[];
    now?: Date;
  }
): Promise<{ learned: number; skipped: number }> {
  try {
    return await learnJobContactsFromEmailsUnsafe(prisma, input);
  } catch (error) {
    console.warn("job-email-contact-learn-failed", {
      workspaceId: input.workspaceId,
      emailMessageIds: input.emailMessageIds,
      error: error instanceof Error ? error.message : "unknown",
    });
    return { learned: 0, skipped: 0 };
  }
}

async function learnJobContactsFromEmailsUnsafe(
  prisma: JobEmailContactPrisma,
  input: {
    workspaceId: string;
    emailMessageIds: string[];
    now?: Date;
  }
): Promise<{ learned: number; skipped: number }> {
  const ids = [...new Set(input.emailMessageIds.filter(Boolean))];
  if (ids.length === 0) return { learned: 0, skipped: 0 };

  const emails = await prisma.emailMessage.findMany({
    where: { workspaceId: input.workspaceId, id: { in: ids } },
    select: {
      id: true,
      workspaceId: true,
      jobId: true,
      senderEmail: true,
      senderName: true,
      receivedAt: true,
      sentAt: true,
      jobAssignmentSource: true,
      jobAssignmentIsManual: true,
    },
  });

  let learned = 0;
  let skipped = 0;
  const now = input.now ?? new Date();
  for (const email of emails) {
    const result = await learnJobContactFromEmail(prisma, email, now);
    if (result.status === "learned") learned += 1;
    else skipped += 1;
  }
  return { learned, skipped };
}
