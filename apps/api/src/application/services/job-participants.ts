import type { PrismaClient, JobParticipantRole, JobParticipantPartyType } from "@prisma/client";

export const JOB_PARTICIPANT_ROLES = [
  "PROJECT_MANAGER",
  "ESTIMATOR",
  "GENERAL_CONTRACTOR",
  "CLIENT",
  "OWNER",
  "ARCHITECT",
  "ENGINEER",
  "DETAILER",
  "ERECTOR",
  "SUPPLIER",
  "OTHER",
] as const satisfies readonly JobParticipantRole[];

export const JOB_PARTICIPANT_PARTY_TYPES = [
  "USER",
  "CUSTOMER",
  "VENDOR",
  "CONTACT",
] as const satisfies readonly JobParticipantPartyType[];

export type JobParticipantDto = {
  id: string;
  jobId: string;
  role: JobParticipantRole;
  partyType: JobParticipantPartyType;
  isPrimary: boolean;
  title: string | null;
  notes: string | null;
  name: string | null;
  organizationName: string | null;
  email: string | null;
  phone: string | null;
  userId: string | null;
  customerId: string | null;
  vendorId: string | null;
  contactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export class JobParticipantError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "JobParticipantError";
  }
}

type PartyRefs = {
  userId?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  contactId?: string | null;
};

export function resolvePartyType(input: PartyRefs): JobParticipantPartyType {
  const set = [
    input.userId ? "USER" : null,
    input.customerId ? "CUSTOMER" : null,
    input.vendorId ? "VENDOR" : null,
    input.contactId ? "CONTACT" : null,
  ].filter(Boolean) as JobParticipantPartyType[];
  if (set.length !== 1) {
    throw new JobParticipantError(
      "Provide exactly one of userId, customerId, vendorId, or contactId",
      400
    );
  }
  return set[0]!;
}

const includeParty = {
  user: { select: { id: true, name: true, email: true } },
  customer: { select: { id: true, name: true, primaryEmail: true, phone: true } },
  vendor: { select: { id: true, name: true, primaryEmail: true, phone: true } },
  contact: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      customer: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
    },
  },
} as const;

type Row = {
  id: string;
  workspaceId: string;
  jobId: string;
  role: JobParticipantRole;
  partyType: JobParticipantPartyType;
  isPrimary: boolean;
  title: string | null;
  notes: string | null;
  userId: string | null;
  customerId: string | null;
  vendorId: string | null;
  contactId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string | null; email: string } | null;
  customer: { id: string; name: string; primaryEmail: string | null; phone: string | null } | null;
  vendor: { id: string; name: string; primaryEmail: string | null; phone: string | null } | null;
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    customer: { id: string; name: string } | null;
    vendor: { id: string; name: string } | null;
  } | null;
};

export function presentJobParticipant(row: Row): JobParticipantDto {
  let name: string | null = null;
  let organizationName: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;

  if (row.partyType === "USER" && row.user) {
    name = row.user.name?.trim() || row.user.email;
    email = row.user.email;
    organizationName = "Internal";
  } else if (row.partyType === "CUSTOMER" && row.customer) {
    name = row.customer.name;
    organizationName = row.customer.name;
    email = row.customer.primaryEmail;
    phone = row.customer.phone;
  } else if (row.partyType === "VENDOR" && row.vendor) {
    name = row.vendor.name;
    organizationName = row.vendor.name;
    email = row.vendor.primaryEmail;
    phone = row.vendor.phone;
  } else if (row.partyType === "CONTACT" && row.contact) {
    name = row.contact.name?.trim() || row.contact.email;
    email = row.contact.email;
    phone = row.contact.phone;
    organizationName =
      row.contact.customer?.name ?? row.contact.vendor?.name ?? null;
  }

  return {
    id: row.id,
    jobId: row.jobId,
    role: row.role,
    partyType: row.partyType,
    isPrimary: row.isPrimary,
    title: row.title,
    notes: row.notes,
    name,
    organizationName,
    email,
    phone,
    userId: row.userId,
    customerId: row.customerId,
    vendorId: row.vendorId,
    contactId: row.contactId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertPartyInWorkspace(
  prisma: PrismaClient,
  workspaceId: string,
  partyType: JobParticipantPartyType,
  refs: Required<PartyRefs>
): Promise<void> {
  if (partyType === "USER") {
    const membership = await prisma.membership.findFirst({
      where: { workspaceId, userId: refs.userId! },
      select: { id: true },
    });
    if (!membership) {
      throw new JobParticipantError("User is not a member of this workspace", 404);
    }
    return;
  }
  if (partyType === "CUSTOMER") {
    const row = await prisma.customer.findFirst({
      where: { id: refs.customerId!, workspaceId },
      select: { id: true },
    });
    if (!row) throw new JobParticipantError("Customer not found in this workspace", 404);
    return;
  }
  if (partyType === "VENDOR") {
    const row = await prisma.vendor.findFirst({
      where: { id: refs.vendorId!, workspaceId },
      select: { id: true },
    });
    if (!row) throw new JobParticipantError("Vendor not found in this workspace", 404);
    return;
  }
  const row = await prisma.entityContact.findFirst({
    where: { id: refs.contactId!, workspaceId },
    select: { id: true },
  });
  if (!row) throw new JobParticipantError("Contact not found in this workspace", 404);
}

export async function listJobParticipants(
  prisma: PrismaClient,
  input: { workspaceId: string; jobId: string }
): Promise<JobParticipantDto[]> {
  const rows = await prisma.jobParticipant.findMany({
    where: { workspaceId: input.workspaceId, jobId: input.jobId },
    include: includeParty,
    orderBy: [{ role: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(presentJobParticipant);
}

export async function createJobParticipant(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    role: JobParticipantRole;
    userId?: string | null;
    customerId?: string | null;
    vendorId?: string | null;
    contactId?: string | null;
    isPrimary?: boolean;
    title?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
): Promise<JobParticipantDto> {
  const refs = {
    userId: input.userId ?? null,
    customerId: input.customerId ?? null,
    vendorId: input.vendorId ?? null,
    contactId: input.contactId ?? null,
  };
  const partyType = resolvePartyType(refs);
  await assertPartyInWorkspace(prisma, input.workspaceId, partyType, refs);

  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new JobParticipantError("Job not found", 404);

  const wantPrimary =
    input.role === "PROJECT_MANAGER" ? input.isPrimary !== false : Boolean(input.isPrimary);

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (wantPrimary && input.role === "PROJECT_MANAGER") {
        await tx.jobParticipant.updateMany({
          where: {
            workspaceId: input.workspaceId,
            jobId: input.jobId,
            role: "PROJECT_MANAGER",
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }

      const row = await tx.jobParticipant.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: input.jobId,
          role: input.role,
          partyType,
          userId: refs.userId,
          customerId: refs.customerId,
          vendorId: refs.vendorId,
          contactId: refs.contactId,
          isPrimary: wantPrimary && input.role === "PROJECT_MANAGER" ? true : Boolean(input.isPrimary),
          title: input.title?.trim() || null,
          notes: input.notes?.trim() || null,
        },
        include: includeParty,
      });

      await tx.jobActivityLog.create({
        data: {
          workspaceId: input.workspaceId,
          jobId: input.jobId,
          action: "PARTICIPANT_ADDED",
          entityType: "JOB_PARTICIPANT",
          entityId: row.id,
          actorUserId: input.actorUserId,
          newValue: {
            role: row.role,
            partyType: row.partyType,
            isPrimary: row.isPrimary,
          },
        },
      });

      return row;
    });

    return presentJobParticipant(created);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      throw new JobParticipantError(
        "This party is already on the job with this role",
        409
      );
    }
    throw error;
  }
}

export async function updateJobParticipant(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    participantId: string;
    role?: JobParticipantRole;
    isPrimary?: boolean;
    title?: string | null;
    notes?: string | null;
    actorUserId: string;
  }
): Promise<JobParticipantDto> {
  const existing = await prisma.jobParticipant.findFirst({
    where: {
      id: input.participantId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
  });
  if (!existing) throw new JobParticipantError("Participant not found", 404);

  const nextRole = input.role ?? existing.role;
  const nextPrimary =
    input.isPrimary !== undefined
      ? input.isPrimary
      : existing.isPrimary;

  const updated = await prisma.$transaction(async (tx) => {
    if (nextPrimary && nextRole === "PROJECT_MANAGER") {
      await tx.jobParticipant.updateMany({
        where: {
          workspaceId: input.workspaceId,
          jobId: input.jobId,
          role: "PROJECT_MANAGER",
          isPrimary: true,
          id: { not: input.participantId },
        },
        data: { isPrimary: false },
      });
    }

    const row = await tx.jobParticipant.update({
      where: { id: input.participantId },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
      include: includeParty,
    });

    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "PARTICIPANT_UPDATED",
        entityType: "JOB_PARTICIPANT",
        entityId: row.id,
        actorUserId: input.actorUserId,
        previousValue: {
          role: existing.role,
          isPrimary: existing.isPrimary,
        },
        newValue: {
          role: row.role,
          isPrimary: row.isPrimary,
        },
      },
    });

    return row;
  });

  return presentJobParticipant(updated);
}

export async function deleteJobParticipant(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    participantId: string;
    actorUserId: string;
  }
): Promise<void> {
  const existing = await prisma.jobParticipant.findFirst({
    where: {
      id: input.participantId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
    select: { id: true, role: true, partyType: true, isPrimary: true },
  });
  if (!existing) throw new JobParticipantError("Participant not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.jobParticipant.delete({ where: { id: existing.id } });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "PARTICIPANT_REMOVED",
        entityType: "JOB_PARTICIPANT",
        entityId: existing.id,
        actorUserId: input.actorUserId,
        previousValue: {
          role: existing.role,
          partyType: existing.partyType,
          isPrimary: existing.isPrimary,
        },
      },
    });
  });
}

export async function searchParticipantCandidates(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    q: string;
    limit?: number;
  }
): Promise<{
  users: Array<{ id: string; name: string | null; email: string; partyType: "USER" }>;
  customers: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    partyType: "CUSTOMER";
  }>;
  vendors: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    partyType: "VENDOR";
  }>;
  contacts: Array<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    organizationName: string | null;
    partyType: "CONTACT";
  }>;
}> {
  const q = input.q.trim();
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 25);
  if (q.length < 1) {
    return { users: [], customers: [], vendors: [], contacts: [] };
  }

  const contains = { contains: q, mode: "insensitive" as const };

  const [memberships, customers, vendors, contacts] = await Promise.all([
    prisma.membership.findMany({
      where: {
        workspaceId: input.workspaceId,
        OR: [
          { user: { name: contains } },
          { user: { email: contains } },
        ],
      },
      take: limit,
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.customer.findMany({
      where: {
        workspaceId: input.workspaceId,
        OR: [{ name: contains }, { primaryEmail: contains }, { domain: contains }],
      },
      take: limit,
      select: { id: true, name: true, primaryEmail: true, phone: true },
      orderBy: { normalizedName: "asc" },
    }),
    prisma.vendor.findMany({
      where: {
        workspaceId: input.workspaceId,
        OR: [{ name: contains }, { primaryEmail: contains }, { domain: contains }],
      },
      take: limit,
      select: { id: true, name: true, primaryEmail: true, phone: true },
      orderBy: { normalizedName: "asc" },
    }),
    prisma.entityContact.findMany({
      where: {
        workspaceId: input.workspaceId,
        OR: [{ name: contains }, { email: contains }, { phone: contains }],
      },
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        customer: { select: { name: true } },
        vendor: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    users: memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      partyType: "USER" as const,
    })),
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.primaryEmail,
      phone: c.phone,
      partyType: "CUSTOMER" as const,
    })),
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.name,
      email: v.primaryEmail,
      phone: v.phone,
      partyType: "VENDOR" as const,
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      organizationName: c.customer?.name ?? c.vendor?.name ?? null,
      partyType: "CONTACT" as const,
    })),
  };
}

export function pickPrimaryProjectManager(
  participants: JobParticipantDto[]
): JobParticipantDto | null {
  const pms = participants.filter((p) => p.role === "PROJECT_MANAGER");
  if (pms.length === 0) return null;
  return pms.find((p) => p.isPrimary) ?? pms[0] ?? null;
}
