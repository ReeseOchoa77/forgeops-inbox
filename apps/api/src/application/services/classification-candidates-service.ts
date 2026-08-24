import type { PrismaClient } from "@prisma/client";
import {
  normalizeName,
  normalizeEmail,
  extractDomain,
  computeSimilarity,
  rankJobMatchCandidates,
  JOB_MATCHER_VERSION,
} from "@forgeops/shared";

export interface ClassificationCandidatesInput {
  workspaceId: string;
  mailboxEmail: string;
  senderName?: string | null | undefined;
  senderEmail: string;
  senderDomain?: string | undefined;
  subject?: string | null | undefined;
  cleanBody?: string | null | undefined;
  attachmentNames?: string[] | null | undefined;
}

export interface ClassificationCandidateRow {
  id: string;
  name: string;
  score: number;
  matchedOn: string[];
  evidence: string[];
}

export interface ClassificationCandidatesResult {
  workspaceId: string;
  knownSender: boolean;
  matcherVersion: string;
  customerCandidates: ClassificationCandidateRow[];
  vendorCandidates: ClassificationCandidateRow[];
  jobCandidates: ClassificationCandidateRow[];
  senderEvidence: {
    status: string;
    confidence: number;
    businessCount: number;
    personalCount: number;
  } | null;
  domainEvidence: {
    status: string;
    confidence: number;
    isPublicDomain: boolean;
  } | null;
  activeBusinessTypes: Array<{
    key: string;
    label: string;
    group: string | null;
    order: number | null;
  }>;
  classificationInstructions: Array<{ title: string; content: string }>;
}

/** Preloaded workspace rows for pure assembly (tests + service). */
export interface ClassificationCandidatesSourceData {
  contacts: Array<{
    id: string;
    customerId: string | null;
    vendorId: string | null;
    normalizedEmail: string | null;
    domain: string | null;
  }>;
  aliases: Array<{
    id: string;
    entityType: string;
    customerId: string | null;
    vendorId: string | null;
    jobId: string | null;
    normalizedAlias: string;
  }>;
  customers: Array<{
    id: string;
    name: string;
    normalizedName: string;
    domain: string | null;
    primaryEmail: string | null;
  }>;
  vendors: Array<{
    id: string;
    name: string;
    normalizedName: string;
    domain: string | null;
    primaryEmail: string | null;
  }>;
  jobs: Array<{
    id: string;
    name: string;
    normalizedName: string;
    jobNumber: string | null;
    customerId: string | null;
    externalRef: string | null;
  }>;
  businessTypes: Array<{
    systemKey: string;
    displayLabel: string;
    displayGroup: string | null;
    displayOrder: number | null;
  }>;
  instructions: Array<{ title: string; content: string }>;
  senderEvidence: {
    status: string;
    confidence: { toString(): string } | number;
    businessEvidenceCount: number;
    personalEvidenceCount: number;
  } | null;
  domainEvidence: {
    status: string;
    confidence: { toString(): string } | number;
    isPublicDomain: boolean;
  } | null;
  approvedFolders: Array<{
    normalizedFolderName: string;
    matchedJobId: string | null;
    rawFolderName: string;
    detectedJobNumber: string | null;
  }>;
}

/**
 * Pure candidate assembly — same logic previously inline in classification-engine.route.
 * Kept free of Prisma so response shape can be parity-tested without a database.
 */
export function assembleClassificationCandidates(
  workspaceId: string,
  input: {
    senderName?: string | null | undefined;
    senderEmail: string;
    senderDomain?: string | undefined;
    subject?: string | null | undefined;
    cleanBody?: string | null | undefined;
    attachmentNames?: string[] | null | undefined;
  },
  data: ClassificationCandidatesSourceData
): ClassificationCandidatesResult {
  const normalizedSenderEmail = input.senderEmail
    ? normalizeEmail(input.senderEmail)
    : "";
  const senderDomain = (
    input.senderDomain ||
    extractDomain(input.senderEmail) ||
    ""
  ).toLowerCase();
  const attachmentNames = input.attachmentNames ?? [];

  const {
    contacts,
    aliases,
    customers,
    vendors,
    jobs,
    businessTypes,
    instructions,
    senderEvidence,
    domainEvidence,
    approvedFolders,
  } = data;

  let knownSender = false;
  if (senderEvidence && senderEvidence.status !== "OBSERVED") knownSender = true;

  const scored = new Map<
    string,
    {
      id: string;
      name: string;
      matchedOn: Set<string>;
      evidence: string[];
      score: number;
      type: "customer" | "vendor";
    }
  >();

  function addCandidate(
    type: "customer" | "vendor",
    id: string,
    name: string,
    matchOn: string,
    evidence: string,
    score: number
  ) {
    const key = `${type}:${id}`;
    const existing = scored.get(key);
    if (existing) {
      existing.matchedOn.add(matchOn);
      existing.evidence.push(evidence);
      existing.score = Math.max(existing.score, score);
    } else {
      scored.set(key, {
        id,
        name,
        matchedOn: new Set([matchOn]),
        evidence: [evidence],
        score,
        type,
      });
    }
  }

  for (const contact of contacts) {
    knownSender = true;
    const isEmailMatch = contact.normalizedEmail === normalizedSenderEmail;
    if (contact.customerId) {
      const c = customers.find((x) => x.id === contact.customerId);
      if (c)
        addCandidate(
          "customer",
          c.id,
          c.name,
          isEmailMatch ? "email" : "domain",
          `contact ${isEmailMatch ? "email" : "domain"} match`,
          isEmailMatch ? 1.0 : 0.85
        );
    }
    if (contact.vendorId) {
      const v = vendors.find((x) => x.id === contact.vendorId);
      if (v)
        addCandidate(
          "vendor",
          v.id,
          v.name,
          isEmailMatch ? "email" : "domain",
          `contact ${isEmailMatch ? "email" : "domain"} match`,
          isEmailMatch ? 1.0 : 0.85
        );
    }
  }

  for (const c of customers) {
    if (c.domain === senderDomain)
      addCandidate(
        "customer",
        c.id,
        c.name,
        "domain",
        `org domain ${senderDomain}`,
        0.85
      );
    if (c.primaryEmail && normalizeEmail(c.primaryEmail) === normalizedSenderEmail)
      addCandidate("customer", c.id, c.name, "email", `primary email match`, 1.0);
  }
  for (const v of vendors) {
    if (v.domain === senderDomain)
      addCandidate(
        "vendor",
        v.id,
        v.name,
        "domain",
        `org domain ${senderDomain}`,
        0.85
      );
    if (v.primaryEmail && normalizeEmail(v.primaryEmail) === normalizedSenderEmail)
      addCandidate("vendor", v.id, v.name, "email", `primary email match`, 1.0);
  }

  if (input.senderName) {
    const normalizedSender = normalizeName(input.senderName);
    for (const alias of aliases) {
      if (alias.normalizedAlias === normalizedSender) {
        if (alias.entityType === "CUSTOMER" && alias.customerId) {
          const c = customers.find((x) => x.id === alias.customerId);
          if (c)
            addCandidate(
              "customer",
              c.id,
              c.name,
              "alias",
              `alias "${alias.normalizedAlias}"`,
              0.9
            );
        }
        if (alias.entityType === "VENDOR" && alias.vendorId) {
          const v = vendors.find((x) => x.id === alias.vendorId);
          if (v)
            addCandidate(
              "vendor",
              v.id,
              v.name,
              "alias",
              `alias "${alias.normalizedAlias}"`,
              0.9
            );
        }
      }
    }
    for (const c of customers) {
      const sim = computeSimilarity(normalizedSender, c.normalizedName);
      if (sim >= 0.6)
        addCandidate(
          "customer",
          c.id,
          c.name,
          "name",
          `name similarity ${Math.round(sim * 100)}%`,
          sim * 0.8
        );
    }
    for (const v of vendors) {
      const sim = computeSimilarity(normalizedSender, v.normalizedName);
      if (sim >= 0.6)
        addCandidate(
          "vendor",
          v.id,
          v.name,
          "name",
          `name similarity ${Math.round(sim * 100)}%`,
          sim * 0.8
        );
    }
  }

  const jobCandidates: ClassificationCandidateRow[] = [];
  const searchText =
    `${input.subject ?? ""} ${input.cleanBody ?? ""} ${attachmentNames.join(" ")}`.toLowerCase();

  for (const folder of approvedFolders) {
    if (!folder.matchedJobId) continue;
    const job = jobs.find((j) => j.id === folder.matchedJobId);
    if (!job) continue;

    if (
      folder.detectedJobNumber &&
      searchText.includes(folder.detectedJobNumber.toLowerCase())
    ) {
      jobCandidates.push({
        id: job.id,
        name: job.name,
        score: 0.95,
        matchedOn: ["folderJobNumber"],
        evidence: [`folder job# ${folder.detectedJobNumber}`],
      });
    } else if (searchText.includes(folder.normalizedFolderName)) {
      jobCandidates.push({
        id: job.id,
        name: job.name,
        score: 0.85,
        matchedOn: ["folderName"],
        evidence: [`folder "${folder.rawFolderName}"`],
      });
    }
  }

  const jobAliasRecords = aliases
    .filter((a) => a.entityType === "JOB" && a.jobId)
    .map((a) => ({
      jobId: a.jobId!,
      alias: a.normalizedAlias,
      normalizedAlias: a.normalizedAlias,
    }));

  const rankedJobs = rankJobMatchCandidates({
    subject: input.subject ?? "",
    cleanBody: input.cleanBody ?? "",
    bodyText: input.cleanBody ?? "",
    senderDomain: senderDomain || null,
    jobs: jobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      name: j.name,
      normalizedName: j.normalizedName,
      customerId: j.customerId,
      externalRef: j.externalRef,
    })),
    aliases: jobAliasRecords,
    limit: 10,
  });

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  for (const ranked of rankedJobs) {
    if (jobCandidates.some((c) => c.id === ranked.jobId)) {
      const existing = jobCandidates.find((c) => c.id === ranked.jobId)!;
      existing.score = Math.max(existing.score, ranked.score);
      existing.matchedOn.push(...ranked.evidence.map((e) => e.type));
      existing.evidence.push(
        ...ranked.evidence.map((e) => `${e.type}: ${e.value}`)
      );
      continue;
    }
    const job = jobById.get(ranked.jobId);
    if (!job) continue;
    jobCandidates.push({
      id: job.id,
      name: job.name,
      score: ranked.score,
      matchedOn: ranked.evidence.map((e) => e.type),
      evidence: ranked.evidence.map((e) => `${e.type}: ${e.value}`),
    });
  }

  const customerCandidates: ClassificationCandidateRow[] = [];
  const vendorCandidates: ClassificationCandidateRow[] = [];

  for (const [, entry] of scored) {
    const candidate = {
      id: entry.id,
      name: entry.name,
      score: entry.score,
      matchedOn: [...entry.matchedOn],
      evidence: entry.evidence,
    };
    if (entry.type === "customer") customerCandidates.push(candidate);
    else vendorCandidates.push(candidate);
  }

  customerCandidates.sort((a, b) => b.score - a.score);
  vendorCandidates.sort((a, b) => b.score - a.score);
  jobCandidates.sort((a, b) => b.score - a.score);

  return {
    workspaceId,
    knownSender,
    matcherVersion: JOB_MATCHER_VERSION,
    customerCandidates: customerCandidates.slice(0, 5),
    vendorCandidates: vendorCandidates.slice(0, 5),
    jobCandidates: jobCandidates.slice(0, 5),
    senderEvidence: senderEvidence
      ? {
          status: senderEvidence.status,
          confidence: Number(senderEvidence.confidence.toString()),
          businessCount: senderEvidence.businessEvidenceCount,
          personalCount: senderEvidence.personalEvidenceCount,
        }
      : null,
    domainEvidence: domainEvidence
      ? {
          status: domainEvidence.status,
          confidence: Number(domainEvidence.confidence.toString()),
          isPublicDomain: domainEvidence.isPublicDomain,
        }
      : null,
    activeBusinessTypes: businessTypes.map((bt) => ({
      key: bt.systemKey,
      label: bt.displayLabel,
      group: bt.displayGroup,
      order: bt.displayOrder,
    })),
    classificationInstructions: instructions.map((i) => ({
      title: i.title,
      content: i.content,
    })),
  };
}

export class ClassificationCandidatesService {
  constructor(private readonly prisma: PrismaClient) {}

  async getCandidates(
    input: ClassificationCandidatesInput
  ): Promise<ClassificationCandidatesResult> {
    const workspaceId = input.workspaceId;
    const normalizedSenderEmail = input.senderEmail
      ? normalizeEmail(input.senderEmail)
      : "";
    const senderDomain = (
      input.senderDomain ||
      extractDomain(input.senderEmail) ||
      ""
    ).toLowerCase();

    const [
      contacts,
      aliases,
      customers,
      vendors,
      jobs,
      businessTypes,
      instructions,
      senderEvidence,
      domainEvidence,
      approvedFolders,
    ] = await Promise.all([
      this.prisma.entityContact.findMany({
        where: {
          workspaceId,
          OR: [
            { normalizedEmail: normalizedSenderEmail },
            { domain: senderDomain },
          ],
        },
        select: {
          id: true,
          customerId: true,
          vendorId: true,
          normalizedEmail: true,
          domain: true,
        },
      }),
      this.prisma.entityAlias.findMany({
        where: { workspaceId },
        select: {
          id: true,
          entityType: true,
          customerId: true,
          vendorId: true,
          jobId: true,
          normalizedAlias: true,
        },
      }),
      this.prisma.customer.findMany({
        where: { workspaceId },
        select: {
          id: true,
          name: true,
          normalizedName: true,
          domain: true,
          primaryEmail: true,
        },
      }),
      this.prisma.vendor.findMany({
        where: { workspaceId },
        select: {
          id: true,
          name: true,
          normalizedName: true,
          domain: true,
          primaryEmail: true,
        },
      }),
      this.prisma.job.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          status: { notIn: ["ARCHIVED", "CANCELLED"] },
        },
        select: {
          id: true,
          name: true,
          normalizedName: true,
          jobNumber: true,
          customerId: true,
          externalRef: true,
        },
      }),
      this.prisma.businessType.findMany({
        where: { OR: [{ workspaceId: null }, { workspaceId }], active: true },
        select: {
          systemKey: true,
          displayLabel: true,
          displayGroup: true,
          displayOrder: true,
        },
        orderBy: [{ displayGroup: "asc" }, { displayOrder: "asc" }],
      }),
      this.prisma.classificationInstruction.findMany({
        where: { workspaceId, active: true },
        select: { title: true, content: true },
        orderBy: { sortOrder: "asc" },
      }),
      normalizedSenderEmail
        ? this.prisma.senderEvidence.findFirst({
            where: { workspaceId, normalizedEmail: normalizedSenderEmail },
            select: {
              status: true,
              confidence: true,
              businessEvidenceCount: true,
              personalEvidenceCount: true,
            },
          })
        : Promise.resolve(null),
      senderDomain
        ? this.prisma.domainEvidence.findFirst({
            where: { workspaceId, domain: senderDomain },
            select: {
              status: true,
              confidence: true,
              isPublicDomain: true,
            },
          })
        : Promise.resolve(null),
      this.prisma.discoveredFolder.findMany({
        where: {
          workspaceId,
          status: "APPROVED",
          matchedJobId: { not: null },
        },
        select: {
          normalizedFolderName: true,
          matchedJobId: true,
          rawFolderName: true,
          detectedJobNumber: true,
        },
      }),
    ]);

    return assembleClassificationCandidates(
      workspaceId,
      {
        senderName: input.senderName,
        senderEmail: input.senderEmail,
        senderDomain: input.senderDomain,
        subject: input.subject,
        cleanBody: input.cleanBody,
        attachmentNames: input.attachmentNames,
      },
      {
        contacts,
        aliases,
        customers,
        vendors,
        jobs,
        businessTypes,
        instructions,
        senderEvidence,
        domainEvidence,
        approvedFolders,
      }
    );
  }

  /**
   * Approved JOB aliases for semantic extraction (n8n `approvedJobAliases`).
   * Not part of the HTTP classification-candidates response shape.
   */
  async listApprovedJobAliases(workspaceId: string): Promise<
    Array<{ jobId: string; alias: string; normalizedAlias: string }>
  > {
    const rows = await this.prisma.entityAlias.findMany({
      where: { workspaceId, entityType: "JOB", jobId: { not: null } },
      select: { jobId: true, alias: true, normalizedAlias: true },
    });
    return rows
      .filter((r): r is typeof r & { jobId: string } => r.jobId != null)
      .map((r) => ({
        jobId: r.jobId,
        alias: r.alias,
        normalizedAlias: r.normalizedAlias,
      }));
  }
}
