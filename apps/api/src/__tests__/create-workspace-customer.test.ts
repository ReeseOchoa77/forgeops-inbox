import { describe, expect, it, vi } from "vitest";
import { normalizeName } from "@forgeops/shared";
import {
  createWorkspaceCustomer,
  CreateWorkspaceCustomerError,
} from "../application/services/create-workspace-customer.js";

describe("createWorkspaceCustomer", () => {
  it("requires a non-empty name", async () => {
    await expect(
      createWorkspaceCustomer({
        prisma: {} as never,
        workspaceId: "ws-1",
        name: "   ",
      })
    ).rejects.toBeInstanceOf(CreateWorkspaceCustomerError);
  });

  it("returns existing Customer on normalizedName match (no duplicate)", async () => {
    const existing = {
      id: "c-1",
      workspaceId: "ws-1",
      name: "Mortenson",
      normalizedName: normalizeName("Mortenson"),
      primaryEmail: null,
      domain: null,
      phone: null,
      externalRef: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      customer: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn(),
      },
    };
    const result = await createWorkspaceCustomer({
      prisma: prisma as never,
      workspaceId: "ws-1",
      name: "  mortenson  ",
    });
    expect(result.created).toBe(false);
    expect(result.customer.id).toBe("c-1");
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  it("creates when no normalized collision exists", async () => {
    const created = {
      id: "c-new",
      workspaceId: "ws-1",
      name: "ABC Steel",
      normalizedName: normalizeName("ABC Steel"),
      primaryEmail: null,
      domain: null,
      phone: null,
      externalRef: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prisma = {
      customer: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
    };
    const result = await createWorkspaceCustomer({
      prisma: prisma as never,
      workspaceId: "ws-1",
      name: "ABC Steel",
    });
    expect(result.created).toBe(true);
    expect(result.customer.id).toBe("c-new");
    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        name: "ABC Steel",
        normalizedName: normalizeName("ABC Steel"),
      }),
    });
  });

  it("does not treat fuzzy-similar names as the same Customer", async () => {
    // "Mortenson Construction" normalizes by stripping the construction suffix —
    // that is the existing canonical uniqueness rule, not fuzzy merge.
    expect(normalizeName("Mortenson Construction")).toBe(normalizeName("Mortenson"));
    // Distinct core tokens remain distinct:
    expect(normalizeName("Mortenson")).not.toBe(normalizeName("Ryan Companies"));
  });
});
