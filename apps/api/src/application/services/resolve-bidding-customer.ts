import { normalizeName } from "@forgeops/shared";
import { matchCustomerForImport } from "./job-import.js";
import type { Prisma, PrismaClient } from "@prisma/client";

export type BiddingCustomerResolveStatus =
  | "NONE"
  | "EXISTING"
  | "AMBIGUOUS"
  | "NEW";

export type BiddingCustomerResolution = {
  status: BiddingCustomerResolveStatus;
  /** Existing Customer id when status === EXISTING */
  customerId: string | null;
  /** Display / create name */
  customerName: string | null;
  candidates: Array<{ id: string; name: string; score: number }>;
};

export async function loadWorkspaceCustomerMatchInputs(
  prisma: PrismaClient | Prisma.TransactionClient,
  workspaceId: string
): Promise<{
  customers: Array<{ id: string; name: string; normalizedName: string }>;
  aliases: Array<{
    customerId: string | null;
    normalizedAlias: string;
    alias: string;
  }>;
}> {
  const [customers, aliases] = await Promise.all([
    prisma.customer.findMany({
      where: { workspaceId },
      select: { id: true, name: true, normalizedName: true },
      take: 5000,
    }),
    prisma.entityAlias.findMany({
      where: { workspaceId, entityType: "CUSTOMER", customerId: { not: null } },
      select: { customerId: true, normalizedAlias: true, alias: true },
      take: 5000,
    }),
  ]);
  return { customers, aliases };
}

/**
 * Resolve an organization name to an existing workspace Customer, or mark NEW.
 * Does not create a Customer.
 */
export function resolveBiddingCustomerName(
  companyName: string | null | undefined,
  inputs: {
    customers: Array<{ id: string; name: string; normalizedName: string }>;
    aliases: Array<{
      customerId: string | null;
      normalizedAlias: string;
      alias: string;
    }>;
  }
): BiddingCustomerResolution {
  const raw = companyName?.trim() ?? "";
  if (!raw || !normalizeName(raw)) {
    return {
      status: "NONE",
      customerId: null,
      customerName: null,
      candidates: [],
    };
  }

  const match = matchCustomerForImport({
    rawCustomerName: raw,
    customers: inputs.customers,
    aliases: inputs.aliases,
  });

  if (match.status === "MATCHED" && match.customerId) {
    return {
      status: "EXISTING",
      customerId: match.customerId,
      customerName: match.customerName,
      candidates: match.candidates,
    };
  }
  if (match.status === "AMBIGUOUS") {
    return {
      status: "AMBIGUOUS",
      customerId: null,
      customerName: raw,
      candidates: match.candidates,
    };
  }
  if (match.status === "EMPTY") {
    return {
      status: "NONE",
      customerId: null,
      customerName: null,
      candidates: [],
    };
  }

  return {
    status: "NEW",
    customerId: null,
    customerName: raw,
    candidates: match.candidates,
  };
}

/**
 * On Add-to-Bidding confirm: reuse existing Customer or create one.
 * Always re-resolves inside the caller's transaction.
 */
export async function resolveOrCreateBiddingCustomer(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    /** Existing Customer id chosen by the user */
    customerId?: string | null;
    /** Proposed / typed company name for create-or-link */
    customerName?: string | null;
  }
): Promise<{ customerId: string | null; created: boolean }> {
  if (input.customerId) {
    const existing = await tx.customer.findFirst({
      where: { id: input.customerId, workspaceId: input.workspaceId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error("Customer not found");
    }
    return { customerId: existing.id, created: false };
  }

  const name = input.customerName?.trim() ?? "";
  if (!name) return { customerId: null, created: false };

  const normalizedName = normalizeName(name);
  if (!normalizedName) return { customerId: null, created: false };

  const inputs = await loadWorkspaceCustomerMatchInputs(tx, input.workspaceId);
  const resolved = resolveBiddingCustomerName(name, inputs);
  if (resolved.status === "EXISTING" && resolved.customerId) {
    return { customerId: resolved.customerId, created: false };
  }

  try {
    const created = await tx.customer.create({
      data: {
        workspaceId: input.workspaceId,
        name,
        normalizedName,
      },
      select: { id: true },
    });
    return { customerId: created.id, created: true };
  } catch (e) {
    // Concurrent create with same normalized name — reuse winner.
    const raced = await tx.customer.findUnique({
      where: {
        workspaceId_normalizedName: {
          workspaceId: input.workspaceId,
          normalizedName,
        },
      },
      select: { id: true },
    });
    if (raced) return { customerId: raced.id, created: false };
    throw e;
  }
}
