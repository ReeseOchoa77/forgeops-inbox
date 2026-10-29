import { describe, expect, it, vi } from "vitest";
import {
  learnJobContactFromEmail,
  learnJobContactsFromEmails,
  shouldLearnJobEmailContact,
  type JobEmailContactPrisma,
} from "../jobs/learn-job-contact-from-email.js";

function email(overrides: Partial<{
  id: string;
  workspaceId: string;
  jobId: string | null;
  senderEmail: string | null;
  senderName: string | null;
  receivedAt: Date | null;
  sentAt: Date | null;
  jobAssignmentSource: string | null;
  jobAssignmentIsManual: boolean | null;
}> = {}) {
  return {
    id: "em-1",
    workspaceId: "ws-1",
    jobId: "job-2191",
    senderEmail: "connor@example.com",
    senderName: "Connor Smith",
    receivedAt: new Date("2026-10-01T12:00:00.000Z"),
    sentAt: new Date("2026-10-01T12:00:00.000Z"),
    jobAssignmentSource: "USER_ASSIGNED" as string | null,
    jobAssignmentIsManual: true as boolean | null,
    ...overrides,
  };
}

function mockPrisma(opts?: {
  existingContact?: {
    id: string;
    name: string | null;
    email: string | null;
    normalizedEmail: string | null;
  } | null;
  existingLink?: {
    id: string;
    source: string;
    firstEmailMessageId: string | null;
  } | null;
  emails?: ReturnType<typeof email>[];
}) {
  const contacts = new Map<string, {
    id: string;
    name: string | null;
    email: string | null;
    normalizedEmail: string | null;
  }>();
  if (opts?.existingContact) contacts.set(opts.existingContact.id, opts.existingContact);

  const links = new Map<string, { id: string; source: string; firstEmailMessageId: string | null; jobId: string; contactId: string }>();
  if (opts?.existingLink && opts.existingContact) {
    links.set(`${"job-2191"}:${opts.existingContact.id}`, {
      ...opts.existingLink,
      jobId: "job-2191",
      contactId: opts.existingContact.id,
    });
  }

  const prisma: JobEmailContactPrisma = {
    emailMessage: {
      findMany: vi.fn(async () => opts?.emails ?? []),
    },
    entityContact: {
      findFirst: vi.fn(async (args: unknown) => {
        const where = (args as { where: { workspaceId: string } }).where;
        for (const c of contacts.values()) {
          if (where.workspaceId && c.normalizedEmail) return c;
        }
        const list = [...contacts.values()];
        return list[0] ?? null;
      }),
      create: vi.fn(async (args: unknown) => {
        const data = (args as { data: {
          workspaceId: string;
          email: string;
          normalizedEmail: string;
          name: string | null;
        } }).data;
        const created = {
          id: `contact-${contacts.size + 1}`,
          name: data.name,
          email: data.email,
          normalizedEmail: data.normalizedEmail,
        };
        contacts.set(created.id, created);
        return created;
      }),
      update: vi.fn(async (args: unknown) => {
        const { where, data } = args as { where: { id: string }; data: { name?: string } };
        const current = contacts.get(where.id)!;
        const next = { ...current, name: data.name ?? current.name };
        contacts.set(where.id, next);
        return next;
      }),
    },
    jobEmailContact: {
      findUnique: vi.fn(async (args: unknown) => {
        const key = (args as { where: { jobId_contactId: { jobId: string; contactId: string } } })
          .where.jobId_contactId;
        return links.get(`${key.jobId}:${key.contactId}`) ?? null;
      }),
      create: vi.fn(async (args: unknown) => {
        const data = (args as { data: {
          jobId: string;
          contactId: string;
          source: string;
          firstEmailMessageId: string | null;
        } }).data;
        const created = {
          id: `link-${links.size + 1}`,
          source: data.source,
          firstEmailMessageId: data.firstEmailMessageId,
          jobId: data.jobId,
          contactId: data.contactId,
        };
        links.set(`${data.jobId}:${data.contactId}`, created);
        return created;
      }),
      update: vi.fn(async (args: unknown) => {
        const { where } = args as { where: { id: string } };
        return { id: where.id };
      }),
    },
  };

  return { prisma, contacts, links };
}

describe("shouldLearnJobEmailContact", () => {
  it("allows USER_ASSIGNED and VERIFIED_PROJECT_FOLDER", () => {
    expect(
      shouldLearnJobEmailContact({
        jobId: "job-1",
        jobAssignmentSource: "USER_ASSIGNED",
        jobAssignmentIsManual: true,
      })
    ).toBe(true);
    expect(
      shouldLearnJobEmailContact({
        jobId: "job-1",
        jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
        jobAssignmentIsManual: false,
      })
    ).toBe(true);
  });

  it("rejects unassigned, AI_SUGGESTED, AI_AUTO_ASSIGNED, JOB_NUMBER_MATCH", () => {
    expect(shouldLearnJobEmailContact({ jobId: null })).toBe(false);
    expect(
      shouldLearnJobEmailContact({
        jobId: "job-1",
        jobAssignmentSource: "AI_SUGGESTED",
        jobAssignmentIsManual: false,
      })
    ).toBe(false);
    expect(
      shouldLearnJobEmailContact({
        jobId: "job-1",
        jobAssignmentSource: "AI_AUTO_ASSIGNED",
        jobAssignmentIsManual: false,
      })
    ).toBe(false);
    expect(
      shouldLearnJobEmailContact({
        jobId: "job-1",
        jobAssignmentSource: "JOB_NUMBER_MATCH",
        jobAssignmentIsManual: false,
      })
    ).toBe(false);
  });
});

describe("learnJobContactFromEmail", () => {
  it("1. USER_ASSIGNED email learns sender", async () => {
    const { prisma } = mockPrisma();
    const result = await learnJobContactFromEmail(prisma, email());
    expect(result.status).toBe("learned");
    expect(prisma.entityContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "connor@example.com",
          name: "Connor Smith",
          customerId: null,
          vendorId: null,
        }),
      })
    );
    expect(prisma.jobEmailContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId: "job-2191",
          source: "LEARNED_FROM_EMAIL",
          firstEmailMessageId: "em-1",
        }),
      })
    );
  });

  it("2. VERIFIED_PROJECT_FOLDER learns sender", async () => {
    const { prisma } = mockPrisma();
    const result = await learnJobContactFromEmail(
      prisma,
      email({
        jobAssignmentSource: "VERIFIED_PROJECT_FOLDER",
        jobAssignmentIsManual: false,
      })
    );
    expect(result.status).toBe("learned");
  });

  it("3. same sender twice → one EntityContact / one JobEmailContact", async () => {
    const { prisma, contacts, links } = mockPrisma();
    await learnJobContactFromEmail(prisma, email({ id: "em-1" }));
    await learnJobContactFromEmail(prisma, email({ id: "em-2" }));
    expect(contacts.size).toBe(1);
    expect(links.size).toBe(1);
    expect(prisma.entityContact.create).toHaveBeenCalledTimes(1);
    expect(prisma.jobEmailContact.create).toHaveBeenCalledTimes(1);
    expect(prisma.jobEmailContact.update).toHaveBeenCalledTimes(1);
  });

  it("4. case-insensitive sender email dedupe", async () => {
    const { prisma } = mockPrisma({
      existingContact: {
        id: "contact-existing",
        name: "Connor Smith",
        email: "connor@example.com",
        normalizedEmail: "connor@example.com",
      },
    });
    const result = await learnJobContactFromEmail(
      prisma,
      email({ senderEmail: "Connor@Example.COM" })
    );
    expect(result.status).toBe("learned");
    if (result.status !== "learned") return;
    expect(result.contactId).toBe("contact-existing");
    expect(result.createdContact).toBe(false);
    expect(prisma.entityContact.create).not.toHaveBeenCalled();
  });

  it("5. same sender can belong to multiple Jobs", async () => {
    const { prisma, contacts, links } = mockPrisma();
    await learnJobContactFromEmail(prisma, email({ jobId: "job-2191" }));
    await learnJobContactFromEmail(prisma, email({ id: "em-2", jobId: "job-2204" }));
    expect(contacts.size).toBe(1);
    expect(links.size).toBe(2);
  });

  it("6. unassigned email learns nothing", async () => {
    const { prisma } = mockPrisma();
    const result = await learnJobContactFromEmail(
      prisma,
      email({ jobId: null, jobAssignmentSource: null, jobAssignmentIsManual: false })
    );
    expect(result).toEqual({ status: "skipped", reason: "not_confirmed_assignment" });
    expect(prisma.entityContact.create).not.toHaveBeenCalled();
  });

  it("7. AI_SUGGESTED learns nothing", async () => {
    const { prisma } = mockPrisma();
    const result = await learnJobContactFromEmail(
      prisma,
      email({
        jobAssignmentSource: "AI_SUGGESTED",
        jobAssignmentIsManual: false,
      })
    );
    expect(result.status).toBe("skipped");
    expect(prisma.jobEmailContact.create).not.toHaveBeenCalled();
  });

  it("8. ambiguous Marker 1 (no jobId) learns nothing", async () => {
    const { prisma } = mockPrisma();
    const result = await learnJobContactFromEmail(
      prisma,
      email({
        jobId: null,
        jobAssignmentSource: null,
        jobAssignmentIsManual: false,
      })
    );
    expect(result.status).toBe("skipped");
  });

  it("9. Bid Candidate → Job conversion learns from USER_ASSIGNED emails", async () => {
    const { prisma } = mockPrisma({
      emails: [
        email({ id: "invite-1", jobAssignmentSource: "USER_ASSIGNED", jobAssignmentIsManual: true }),
      ],
    });
    const summary = await learnJobContactsFromEmails(prisma, {
      workspaceId: "ws-1",
      emailMessageIds: ["invite-1"],
    });
    expect(summary.learned).toBe(1);
  });

  it("10. learning never deletes a JobEmailContact", async () => {
    const src = await import("node:fs");
    const text = src.readFileSync(
      new URL("../jobs/learn-job-contact-from-email.ts", import.meta.url),
      "utf8"
    );
    expect(text).not.toMatch(/jobEmailContact\.delete/);
  });

  it("11. moving email to another Job can result in contact history on both Jobs", async () => {
    const { prisma, links } = mockPrisma();
    await learnJobContactFromEmail(prisma, email({ jobId: "job-2191" }));
    await learnJobContactFromEmail(
      prisma,
      email({ id: "em-moved", jobId: "job-2200" })
    );
    expect([...links.keys()].sort()).toEqual([
      "job-2191:contact-1",
      "job-2200:contact-1",
    ]);
  });

  it("12. existing EntityContact name is not overwritten", async () => {
    const { prisma } = mockPrisma({
      existingContact: {
        id: "contact-existing",
        name: "Connor Smith",
        email: "connor@example.com",
        normalizedEmail: "connor@example.com",
      },
    });
    await learnJobContactFromEmail(
      prisma,
      email({ senderName: "Connor" })
    );
    expect(prisma.entityContact.update).not.toHaveBeenCalled();
  });

  it("13. blank EntityContact name may be populated from sender display name", async () => {
    const { prisma } = mockPrisma({
      existingContact: {
        id: "contact-existing",
        name: null,
        email: "connor@example.com",
        normalizedEmail: "connor@example.com",
      },
    });
    await learnJobContactFromEmail(prisma, email({ senderName: "Connor Smith" }));
    expect(prisma.entityContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "contact-existing" },
        data: { name: "Connor Smith" },
      })
    );
  });

  it("14. workspace isolation", async () => {
    const { prisma } = mockPrisma({
      existingContact: {
        id: "other-ws",
        name: "Connor Smith",
        email: "connor@example.com",
        normalizedEmail: "connor@example.com",
      },
    });
    const findFirst = prisma.entityContact.findFirst as ReturnType<typeof vi.fn>;
    findFirst.mockImplementationOnce(async () => null);
    await learnJobContactFromEmail(prisma, email({ workspaceId: "ws-2" }));
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "ws-2" }),
      })
    );
  });

  it("does not downgrade MANUAL source to LEARNED_FROM_EMAIL", async () => {
    const { prisma } = mockPrisma({
      existingContact: {
        id: "contact-existing",
        name: "Connor Smith",
        email: "connor@example.com",
        normalizedEmail: "connor@example.com",
      },
      existingLink: {
        id: "link-manual",
        source: "MANUAL",
        firstEmailMessageId: "em-old",
      },
    });
    await learnJobContactFromEmail(prisma, email());
    expect(prisma.jobEmailContact.create).not.toHaveBeenCalled();
    expect(prisma.jobEmailContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-manual" },
        data: { lastSeenAt: expect.any(Date) },
      })
    );
  });
});
