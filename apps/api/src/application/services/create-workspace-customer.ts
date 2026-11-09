/**
 * Canonical workspace Customer create — idempotent on normalizedName.
 * Does not fuzzy-merge distinct display names that normalize differently.
 */

import { normalizeName } from "@forgeops/shared";
import type { Prisma, PrismaClient } from "@prisma/client";

export type CreateWorkspaceCustomerInput = {
  prisma: PrismaClient | Prisma.TransactionClient;
  workspaceId: string;
  name: string;
  primaryEmail?: string | null | undefined;
  domain?: string | null | undefined;
  phone?: string | null | undefined;
  externalRef?: string | null | undefined;
  notes?: string | null | undefined;
};

export type CreateWorkspaceCustomerResult = {
  customer: {
    id: string;
    workspaceId: string;
    name: string;
    normalizedName: string;
    primaryEmail: string | null;
    domain: string | null;
    phone: string | null;
    externalRef: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  created: boolean;
};

export class CreateWorkspaceCustomerError extends Error {
  constructor(
    public readonly code: "NAME_REQUIRED" | "INVALID_NAME",
    message: string
  ) {
    super(message);
    this.name = "CreateWorkspaceCustomerError";
  }
}

/**
 * Create a Customer, or return the existing row when (workspaceId, normalizedName)
 * already exists. Never creates on keystroke — callers invoke only on explicit Create.
 */
export async function createWorkspaceCustomer(
  input: CreateWorkspaceCustomerInput
): Promise<CreateWorkspaceCustomerResult> {
  const name = input.name.trim();
  if (!name) {
    throw new CreateWorkspaceCustomerError("NAME_REQUIRED", "Customer name is required");
  }
  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    throw new CreateWorkspaceCustomerError(
      "INVALID_NAME",
      "Customer name is not valid after normalization"
    );
  }

  const existing = await input.prisma.customer.findUnique({
    where: {
      workspaceId_normalizedName: {
        workspaceId: input.workspaceId,
        normalizedName,
      },
    },
  });
  if (existing) {
    return { customer: existing, created: false };
  }

  try {
    const customer = await input.prisma.customer.create({
      data: {
        workspaceId: input.workspaceId,
        name,
        normalizedName,
        primaryEmail: input.primaryEmail?.trim() || null,
        domain: input.domain?.trim() || null,
        phone: input.phone?.trim() || null,
        externalRef: input.externalRef?.trim() || null,
        notes: input.notes?.trim() || null,
      },
    });
    return { customer, created: true };
  } catch (e) {
    const raced = await input.prisma.customer.findUnique({
      where: {
        workspaceId_normalizedName: {
          workspaceId: input.workspaceId,
          normalizedName,
        },
      },
    });
    if (raced) return { customer: raced, created: false };
    throw e;
  }
}
