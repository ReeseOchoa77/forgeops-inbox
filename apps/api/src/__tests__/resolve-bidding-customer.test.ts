import { describe, expect, it, vi } from "vitest";
import { normalizeName } from "@forgeops/shared";
import {
  resolveBiddingCustomerName,
  resolveOrCreateBiddingCustomer,
} from "../application/services/resolve-bidding-customer.js";

const customers = [
  {
    id: "c-jedunn",
    name: "J.E. Dunn Construction Company",
    normalizedName: normalizeName("J.E. Dunn Construction Company"),
  },
  {
    id: "c-mortenson",
    name: "Mortenson",
    normalizedName: normalizeName("Mortenson"),
  },
  {
    id: "c-turner-a",
    name: "Turner Construction Midwest",
    normalizedName: normalizeName("Turner Construction Midwest"),
  },
  {
    id: "c-turner-b",
    name: "Turner Specialty Contractors",
    normalizedName: normalizeName("Turner Specialty Contractors"),
  },
];

describe("resolveBiddingCustomerName", () => {
  it("matches exact existing Customer", () => {
    const r = resolveBiddingCustomerName("Mortenson", {
      customers,
      aliases: [],
    });
    expect(r.status).toBe("EXISTING");
    expect(r.customerId).toBe("c-mortenson");
  });

  it("reuses when normalized forms match after suffix strip", () => {
    const r = resolveBiddingCustomerName("J.E. Dunn Construction", {
      customers,
      aliases: [],
    });
    expect(r.status).toBe("EXISTING");
    expect(r.customerId).toBe("c-jedunn");
  });

  it("JE Dunn alone reuses only via alias (punctuation makes normalize diverge)", () => {
    const withoutAlias = resolveBiddingCustomerName("JE Dunn", {
      customers,
      aliases: [],
    });
    // "JE Dunn" → "je dunn" vs stored "j e dunn" — conservative: not auto-merged
    expect(withoutAlias.status).not.toBe("EXISTING");

    const withAlias = resolveBiddingCustomerName("JE Dunn", {
      customers,
      aliases: [
        {
          customerId: "c-jedunn",
          normalizedAlias: normalizeName("JE Dunn"),
          alias: "JE Dunn",
        },
      ],
    });
    expect(withAlias.status).toBe("EXISTING");
    expect(withAlias.customerId).toBe("c-jedunn");
  });

  it("does not arbitrarily pick among ambiguous Turner* matches", () => {
    const r = resolveBiddingCustomerName("Turner", {
      customers,
      aliases: [],
    });
    // "Turner" alone may be NOT_FOUND/NEW (weak) or AMBIGUOUS — never a forced pick.
    expect(r.status).not.toBe("EXISTING");
  });

  it("marks unresolved company as NEW", () => {
    const r = resolveBiddingCustomerName("Northland Construction", {
      customers,
      aliases: [],
    });
    expect(r.status).toBe("NEW");
    expect(r.customerId).toBeNull();
    expect(r.customerName).toBe("Northland Construction");
  });

  it("empty → NONE", () => {
    expect(
      resolveBiddingCustomerName("", { customers, aliases: [] }).status
    ).toBe("NONE");
  });
});

describe("resolveOrCreateBiddingCustomer", () => {
  it("reuses customerId without create", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "c-mortenson" });
    const create = vi.fn();
    const tx = {
      customer: {
        findFirst,
        findUnique: vi.fn(),
        create,
        findMany: vi.fn().mockResolvedValue(customers),
      },
      entityAlias: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const r = await resolveOrCreateBiddingCustomer(tx as never, {
      workspaceId: "ws",
      customerId: "c-mortenson",
      customerName: "Should Ignore",
    });
    expect(r).toEqual({ customerId: "c-mortenson", created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates Customer only when unresolved", async () => {
    const create = vi.fn().mockResolvedValue({ id: "c-new" });
    const tx = {
      customer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create,
        findMany: vi.fn().mockResolvedValue(customers),
      },
      entityAlias: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const r = await resolveOrCreateBiddingCustomer(tx as never, {
      workspaceId: "ws",
      customerId: null,
      customerName: "Northland Construction",
    });
    expect(r.created).toBe(true);
    expect(r.customerId).toBe("c-new");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: "ws",
          name: "Northland Construction",
        }),
      })
    );
  });

  it("re-resolves name to existing before create", async () => {
    const create = vi.fn();
    const tx = {
      customer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create,
        findMany: vi.fn().mockResolvedValue(customers),
      },
      entityAlias: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const r = await resolveOrCreateBiddingCustomer(tx as never, {
      workspaceId: "ws",
      customerId: null,
      customerName: "Mortenson",
    });
    expect(r).toEqual({ customerId: "c-mortenson", created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("cleared customer creates nothing", async () => {
    const create = vi.fn();
    const tx = {
      customer: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create,
        findMany: vi.fn(),
      },
      entityAlias: { findMany: vi.fn() },
    };
    const r = await resolveOrCreateBiddingCustomer(tx as never, {
      workspaceId: "ws",
      customerId: null,
      customerName: null,
    });
    expect(r).toEqual({ customerId: null, created: false });
    expect(create).not.toHaveBeenCalled();
  });
});
