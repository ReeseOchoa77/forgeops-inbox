import { describe, expect, it, vi } from "vitest";
import {
  createJobParticipant,
  JobParticipantError,
  pickPrimaryProjectManager,
  presentJobParticipant,
  resolvePartyType,
  searchParticipantCandidates,
} from "../application/services/job-participants.js";

describe("job-participants", () => {
  it("requires exactly one party reference", () => {
    expect(() => resolvePartyType({})).toThrow(JobParticipantError);
    expect(() =>
      resolvePartyType({ userId: "u1", customerId: "c1" })
    ).toThrow(JobParticipantError);
    expect(resolvePartyType({ userId: "u1" })).toBe("USER");
    expect(resolvePartyType({ contactId: "ct1" })).toBe("CONTACT");
  });

  it("presents user / customer / contact party fields", () => {
    const user = presentJobParticipant({
      id: "p1",
      workspaceId: "ws",
      jobId: "job",
      role: "PROJECT_MANAGER",
      partyType: "USER",
      isPrimary: true,
      title: null,
      notes: null,
      userId: "u1",
      customerId: null,
      vendorId: null,
      contactId: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      user: { id: "u1", name: "Alex PM", email: "alex@co.com" },
      customer: null,
      vendor: null,
      contact: null,
    });
    expect(user.name).toBe("Alex PM");
    expect(user.email).toBe("alex@co.com");
    expect(user.organizationName).toBe("Internal");

    const contact = presentJobParticipant({
      id: "p2",
      workspaceId: "ws",
      jobId: "job",
      role: "ARCHITECT",
      partyType: "CONTACT",
      isPrimary: false,
      title: null,
      notes: null,
      userId: null,
      customerId: null,
      vendorId: null,
      contactId: "ct1",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      user: null,
      customer: null,
      vendor: null,
      contact: {
        id: "ct1",
        name: "Pat Draw",
        email: "pat@a.com",
        phone: "555",
        customer: { id: "c1", name: "Acme Arch" },
        vendor: null,
      },
    });
    expect(contact.organizationName).toBe("Acme Arch");
    expect(contact.phone).toBe("555");
  });

  it("picks primary project manager", () => {
    const pm = pickPrimaryProjectManager([
      {
        id: "1",
        jobId: "j",
        role: "PROJECT_MANAGER",
        partyType: "USER",
        isPrimary: false,
        title: null,
        notes: null,
        name: "A",
        organizationName: "Internal",
        email: "a@x.com",
        phone: null,
        userId: "u1",
        customerId: null,
        vendorId: null,
        contactId: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "2",
        jobId: "j",
        role: "PROJECT_MANAGER",
        partyType: "USER",
        isPrimary: true,
        title: null,
        notes: null,
        name: "B",
        organizationName: "Internal",
        email: "b@x.com",
        phone: null,
        userId: "u2",
        customerId: null,
        vendorId: null,
        contactId: null,
        createdAt: "",
        updatedAt: "",
      },
    ]);
    expect(pm?.id).toBe("2");
  });

  it("rejects cross-workspace customer on create", async () => {
    const prisma = {
      membership: { findFirst: vi.fn() },
      customer: { findFirst: vi.fn(async () => null) },
      vendor: { findFirst: vi.fn() },
      entityContact: { findFirst: vi.fn() },
      job: { findFirst: vi.fn() },
      $transaction: vi.fn(),
      jobParticipant: { create: vi.fn(), findMany: vi.fn() },
      jobActivityLog: { create: vi.fn() },
    };
    await expect(
      createJobParticipant(prisma as never, {
        workspaceId: "ws1",
        jobId: "job1",
        role: "CLIENT",
        customerId: "other-ws-customer",
        actorUserId: "actor",
      })
    ).rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining("Customer") });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("searches candidates with narrow selects and limit", async () => {
    const prisma = {
      membership: {
        findMany: vi.fn(async () => [
          { user: { id: "u1", name: "Sam", email: "sam@x.com" } },
        ]),
      },
      customer: { findMany: vi.fn(async () => []) },
      vendor: { findMany: vi.fn(async () => []) },
      entityContact: { findMany: vi.fn(async () => []) },
    };
    const result = await searchParticipantCandidates(prisma as never, {
      workspaceId: "ws1",
      q: "sam",
      limit: 5,
    });
    expect(result.users).toHaveLength(1);
    expect(prisma.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });
});

describe("job participants route + overview contracts", () => {
  it("registers participant APIs and keeps list free of participant hydration", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const route = readFileSync(
      resolve(process.cwd(), "src/interfaces/http/routes/job-participants.route.ts"),
      "utf8"
    );
    const jobs = readFileSync(
      resolve(process.cwd(), "src/interfaces/http/routes/jobs.route.ts"),
      "utf8"
    );
    expect(route).toContain("/jobs/:jobId/participants");
    expect(route).toContain("participant-candidates");
    expect(route).toContain('canEdit(auth.workspaceRole)');
    // Job list select must not include participants
    const listBlock = jobs.slice(
      jobs.indexOf('app.get("/api/v1/workspaces/:workspaceId/jobs"'),
      jobs.indexOf('app.post("/api/v1/workspaces/:workspaceId/jobs"')
    );
    expect(listBlock).not.toContain("participants");
    expect(listBlock).not.toContain("jobParticipant");
    expect(jobs).toContain("listJobParticipants");
    expect(jobs).toContain("projectManager");
  });
});
