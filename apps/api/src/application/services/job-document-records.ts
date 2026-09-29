import type {
  JobDocumentRecordType,
  JobDocumentSubmittalStatus,
  PrismaClient,
} from "@prisma/client";
import { safeDateOrNull } from "@forgeops/shared";

export const JOB_DOCUMENT_RECORD_TYPES = [
  "OTHER",
  "ARCHITECTURAL_DRAWING",
  "STRUCTURAL_DRAWING",
  "CIVIL_DRAWING",
  "SPECIFICATION",
  "SHOP_DRAWING",
  "SUBMITTAL",
  "RFI_DOCUMENT",
  "ASI",
  "BULLETIN",
  "ADDENDUM",
  "PROPOSAL_QUOTE",
  "PURCHASE_ORDER",
  "CONTRACT",
  "CHANGE_ORDER",
  "INVOICE",
  "DELIVERY_DOCUMENT",
] as const satisfies readonly JobDocumentRecordType[];

export const JOB_DOCUMENT_SUBMITTAL_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "APPROVED_AS_NOTED",
  "REVISE_AND_RESUBMIT",
  "REJECTED",
] as const satisfies readonly JobDocumentSubmittalStatus[];

export const DOCUMENT_TYPE_LABELS: Record<JobDocumentRecordType, string> = {
  OTHER: "Other",
  ARCHITECTURAL_DRAWING: "Architectural drawing",
  STRUCTURAL_DRAWING: "Structural drawing",
  CIVIL_DRAWING: "Civil drawing",
  SPECIFICATION: "Specification",
  SHOP_DRAWING: "Shop drawing",
  SUBMITTAL: "Submittal",
  RFI_DOCUMENT: "RFI",
  ASI: "ASI",
  BULLETIN: "Bulletin",
  ADDENDUM: "Addendum",
  PROPOSAL_QUOTE: "Proposal / Quote",
  PURCHASE_ORDER: "Purchase order",
  CONTRACT: "Contract",
  CHANGE_ORDER: "Change order",
  INVOICE: "Invoice",
  DELIVERY_DOCUMENT: "Delivery document",
};

export const SUBMITTAL_STATUS_LABELS: Record<JobDocumentSubmittalStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  APPROVED_AS_NOTED: "Approved as noted",
  REVISE_AND_RESUBMIT: "Revise and resubmit",
  REJECTED: "Rejected",
};

/** UI/API category filters for Documents tab. */
export const DOCUMENT_CATEGORY_FILTERS = [
  "ALL",
  "DRAWINGS",
  "SHOP_SUBMITTALS",
  "RFIS",
  "ASI_BULLETIN_ADDENDUM",
  "CONTRACTS_POS",
  "CHANGE_ORDERS",
  "INVOICES",
  "DELIVERY",
  "OTHER",
] as const;

export type DocumentCategoryFilter = (typeof DOCUMENT_CATEGORY_FILTERS)[number];

export const DOCUMENT_CONTROL_STATE_FILTERS = [
  "ALL",
  "CURRENT",
  "SUPERSEDED",
  "UNCLASSIFIED",
] as const;

export type DocumentControlStateFilter = (typeof DOCUMENT_CONTROL_STATE_FILTERS)[number];

const CATEGORY_TYPES: Record<Exclude<DocumentCategoryFilter, "ALL">, JobDocumentRecordType[]> = {
  DRAWINGS: ["ARCHITECTURAL_DRAWING", "STRUCTURAL_DRAWING", "CIVIL_DRAWING", "SPECIFICATION"],
  SHOP_SUBMITTALS: ["SHOP_DRAWING", "SUBMITTAL"],
  RFIS: ["RFI_DOCUMENT"],
  ASI_BULLETIN_ADDENDUM: ["ASI", "BULLETIN", "ADDENDUM"],
  CONTRACTS_POS: ["PROPOSAL_QUOTE", "PURCHASE_ORDER", "CONTRACT"],
  CHANGE_ORDERS: ["CHANGE_ORDER"],
  INVOICES: ["INVOICE"],
  DELIVERY: ["DELIVERY_DOCUMENT"],
  OTHER: ["OTHER"],
};

export class JobDocumentRecordError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409
  ) {
    super(message);
    this.name = "JobDocumentRecordError";
  }
}

export function allowsSubmittalStatus(type: JobDocumentRecordType): boolean {
  return type === "SHOP_DRAWING" || type === "SUBMITTAL";
}

export function documentMatchesCategory(
  documentType: JobDocumentRecordType | null | undefined,
  category: DocumentCategoryFilter
): boolean {
  if (category === "ALL") return true;
  if (!documentType) return false;
  return CATEGORY_TYPES[category].includes(documentType);
}

export function toUtcDateOnly(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizeDocumentDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const parsed = safeDateOrNull(raw);
  if (!parsed) throw new JobDocumentRecordError("Invalid document date", 400);
  const ymd = toUtcDateOnly(parsed);
  if (!ymd) throw new JobDocumentRecordError("Invalid document date", 400);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export type DocumentControlDto = {
  id: string;
  jobId: string;
  sourceType: "EMAIL_ATTACHMENT" | "JOB_UPLOAD";
  jobFileId: string | null;
  emailAttachmentId: string | null;
  documentType: JobDocumentRecordType;
  documentTypeLabel: string;
  documentNumber: string | null;
  title: string | null;
  revision: string | null;
  documentDate: string | null;
  workPackageId: string | null;
  workPackageName: string | null;
  submittalStatus: JobDocumentSubmittalStatus | null;
  submittalStatusLabel: string | null;
  isCurrent: boolean;
  supersedesId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type RecordRow = {
  id: string;
  jobId: string;
  jobFileId: string | null;
  emailAttachmentId: string | null;
  documentType: JobDocumentRecordType;
  documentNumber: string | null;
  title: string | null;
  revision: string | null;
  documentDate: Date | null;
  workPackageId: string | null;
  submittalStatus: JobDocumentSubmittalStatus | null;
  isCurrent: boolean;
  supersedesId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  workPackage?: { id: string; name: string } | null;
};

export function presentDocumentControl(row: RecordRow): DocumentControlDto {
  return {
    id: row.id,
    jobId: row.jobId,
    sourceType: row.jobFileId ? "JOB_UPLOAD" : "EMAIL_ATTACHMENT",
    jobFileId: row.jobFileId,
    emailAttachmentId: row.emailAttachmentId,
    documentType: row.documentType,
    documentTypeLabel: DOCUMENT_TYPE_LABELS[row.documentType],
    documentNumber: row.documentNumber,
    title: row.title,
    revision: row.revision,
    documentDate: toUtcDateOnly(row.documentDate),
    workPackageId: row.workPackageId,
    workPackageName: row.workPackage?.name ?? null,
    submittalStatus: row.submittalStatus,
    submittalStatusLabel: row.submittalStatus
      ? SUBMITTAL_STATUS_LABELS[row.submittalStatus]
      : null,
    isCurrent: row.isCurrent,
    supersedesId: row.supersedesId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const includePackage = { workPackage: { select: { id: true, name: true } } } as const;

export async function loadDocumentControlsForSources(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    jobFileIds: string[];
    emailAttachmentIds: string[];
  }
): Promise<Map<string, DocumentControlDto>> {
  const or: Array<{ jobFileId?: { in: string[] }; emailAttachmentId?: { in: string[] } }> = [];
  if (input.jobFileIds.length) or.push({ jobFileId: { in: input.jobFileIds } });
  if (input.emailAttachmentIds.length) {
    or.push({ emailAttachmentId: { in: input.emailAttachmentIds } });
  }
  if (or.length === 0) return new Map();

  const rows = await prisma.jobDocumentRecord.findMany({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      OR: or,
    },
    include: includePackage,
  });

  const map = new Map<string, DocumentControlDto>();
  for (const row of rows) {
    const dto = presentDocumentControl(row);
    const key = row.jobFileId
      ? `JOB_UPLOAD:${row.jobFileId}`
      : `EMAIL_ATTACHMENT:${row.emailAttachmentId}`;
    map.set(key, dto);
  }
  return map;
}

async function resolveSource(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    sourceType: "EMAIL_ATTACHMENT" | "JOB_UPLOAD";
    sourceId: string;
  }
): Promise<{ jobFileId: string | null; emailAttachmentId: string | null }> {
  if (input.sourceType === "JOB_UPLOAD") {
    const file = await prisma.jobFile.findFirst({
      where: {
        id: input.sourceId,
        workspaceId: input.workspaceId,
        jobId: input.jobId,
      },
      select: { id: true },
    });
    if (!file) throw new JobDocumentRecordError("Job file not found on this job", 404);
    return { jobFileId: file.id, emailAttachmentId: null };
  }

  const attachment = await prisma.emailAttachment.findFirst({
    where: {
      id: input.sourceId,
      workspaceId: input.workspaceId,
      emailMessage: { jobId: input.jobId, workspaceId: input.workspaceId },
    },
    select: { id: true },
  });
  if (!attachment) {
    throw new JobDocumentRecordError("Email attachment not found on this job", 404);
  }
  return { jobFileId: null, emailAttachmentId: attachment.id };
}

export async function upsertDocumentControl(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    sourceType: "EMAIL_ATTACHMENT" | "JOB_UPLOAD";
    sourceId: string;
    documentType: JobDocumentRecordType;
    documentNumber?: string | null;
    title?: string | null;
    revision?: string | null;
    documentDate?: string | null;
    workPackageId?: string | null;
    submittalStatus?: JobDocumentSubmittalStatus | null;
    supersedesId?: string | null;
    notes?: string | null;
    isCurrent?: boolean;
    actorUserId: string;
  }
): Promise<DocumentControlDto> {
  const job = await prisma.job.findFirst({
    where: { id: input.jobId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!job) throw new JobDocumentRecordError("Job not found", 404);

  const refs = await resolveSource(prisma, input);

  if (input.workPackageId) {
    const pkg = await prisma.jobWorkPackage.findFirst({
      where: {
        id: input.workPackageId,
        workspaceId: input.workspaceId,
        jobId: input.jobId,
      },
      select: { id: true },
    });
    if (!pkg) throw new JobDocumentRecordError("Work package not found on this job", 404);
  }

  let supersedesId = input.supersedesId ?? null;
  if (supersedesId) {
    const older = await prisma.jobDocumentRecord.findFirst({
      where: {
        id: supersedesId,
        workspaceId: input.workspaceId,
        jobId: input.jobId,
      },
      select: { id: true },
    });
    if (!older) throw new JobDocumentRecordError("Superseded document not found on this job", 404);
  }

  const submittalStatus = allowsSubmittalStatus(input.documentType)
    ? (input.submittalStatus ?? null)
    : null;

  if (
    input.submittalStatus &&
    !allowsSubmittalStatus(input.documentType)
  ) {
    throw new JobDocumentRecordError(
      "Submittal status applies only to shop drawings and submittals",
      400
    );
  }

  const existing = await prisma.jobDocumentRecord.findFirst({
    where: {
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      ...(refs.jobFileId
        ? { jobFileId: refs.jobFileId }
        : { emailAttachmentId: refs.emailAttachmentId! }),
    },
  });

  const isCreate = !existing;
  const markSupersede = Boolean(supersedesId);

  const saved = await prisma.$transaction(async (tx) => {
    if (supersedesId) {
      await tx.jobDocumentRecord.update({
        where: { id: supersedesId },
        data: { isCurrent: false },
      });
    }

    const data = {
      documentType: input.documentType,
      documentNumber: input.documentNumber?.trim() || null,
      title: input.title?.trim() || null,
      revision: input.revision?.trim() || null,
      documentDate:
        input.documentDate === undefined
          ? existing?.documentDate ?? null
          : normalizeDocumentDate(input.documentDate),
      workPackageId:
        input.workPackageId === undefined
          ? existing?.workPackageId ?? null
          : input.workPackageId,
      submittalStatus,
      isCurrent: input.isCurrent ?? true,
      supersedesId: supersedesId ?? existing?.supersedesId ?? null,
      notes: input.notes === undefined ? existing?.notes ?? null : input.notes?.trim() || null,
    };

    const row = existing
      ? await tx.jobDocumentRecord.update({
          where: { id: existing.id },
          data,
          include: includePackage,
        })
      : await tx.jobDocumentRecord.create({
          data: {
            workspaceId: input.workspaceId,
            jobId: input.jobId,
            jobFileId: refs.jobFileId,
            emailAttachmentId: refs.emailAttachmentId,
            ...data,
          },
          include: includePackage,
        });

    let action:
      | "DOCUMENT_CLASSIFIED"
      | "DOCUMENT_METADATA_UPDATED"
      | "DOCUMENT_SUPERSEDED" = isCreate
      ? "DOCUMENT_CLASSIFIED"
      : "DOCUMENT_METADATA_UPDATED";
    if (markSupersede) action = "DOCUMENT_SUPERSEDED";

    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action,
        entityType: "JOB_DOCUMENT_RECORD",
        entityId: row.id,
        actorUserId: input.actorUserId,
        ...(existing
          ? {
              previousValue: {
                documentType: existing.documentType,
                documentNumber: existing.documentNumber,
                revision: existing.revision,
                isCurrent: existing.isCurrent,
              },
            }
          : {}),
        newValue: {
          documentType: row.documentType,
          documentNumber: row.documentNumber,
          revision: row.revision,
          isCurrent: row.isCurrent,
          supersedesId: row.supersedesId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
    });

    return row;
  });

  return presentDocumentControl(saved);
}

export async function clearDocumentControl(
  prisma: PrismaClient,
  input: {
    workspaceId: string;
    jobId: string;
    recordId: string;
    actorUserId: string;
  }
): Promise<void> {
  const existing = await prisma.jobDocumentRecord.findFirst({
    where: {
      id: input.recordId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    },
    select: {
      id: true,
      documentType: true,
      documentNumber: true,
      jobFileId: true,
      emailAttachmentId: true,
    },
  });
  if (!existing) throw new JobDocumentRecordError("Document control record not found", 404);

  await prisma.$transaction(async (tx) => {
    await tx.jobDocumentRecord.delete({ where: { id: existing.id } });
    await tx.jobActivityLog.create({
      data: {
        workspaceId: input.workspaceId,
        jobId: input.jobId,
        action: "DOCUMENT_CONTROL_CLEARED",
        entityType: "JOB_DOCUMENT_RECORD",
        entityId: existing.id,
        actorUserId: input.actorUserId,
        previousValue: {
          documentType: existing.documentType,
          documentNumber: existing.documentNumber,
          jobFileId: existing.jobFileId,
          emailAttachmentId: existing.emailAttachmentId,
        },
      },
    });
  });
}
