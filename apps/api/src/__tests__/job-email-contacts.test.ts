import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { presentJobEmailContact } from "../application/services/job-email-contacts.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("presentJobEmailContact", () => {
  it("maps Prisma rows to the Job-detail DTO", () => {
    expect(
      presentJobEmailContact({
        id: "link-1",
        contactId: "c-1",
        source: "LEARNED_FROM_EMAIL",
        firstEmailMessageId: "em-1",
        lastSeenAt: new Date("2026-10-01T12:00:00.000Z"),
        contact: { name: "Connor Smith", email: "connor@example.com" },
      })
    ).toEqual({
      id: "link-1",
      contactId: "c-1",
      name: "Connor Smith",
      email: "connor@example.com",
      source: "LEARNED_FROM_EMAIL",
      firstEmailMessageId: "em-1",
      lastSeenAt: "2026-10-01T12:00:00.000Z",
    });
  });
});

describe("confirmed assignment writers learn contacts", () => {
  it("jobs assign/move call learnJobContactsFromEmails", () => {
    const src = readFileSync(resolve(here, "../interfaces/http/routes/jobs.route.ts"), "utf8");
    expect(src).toContain("learnJobContactsFromEmails");
    expect(src).toContain("listJobEmailContacts");
    expect(src).toContain("emailContacts");
    const removeBlock = src.slice(
      src.indexOf("DELETE /api/v1/workspaces/:workspaceId/jobs/:jobId/emails/:messageId"),
      src.indexOf("Delete one Job email from ForgeOps")
    );
    expect(removeBlock).not.toContain("jobEmailContact.delete");
    expect(removeBlock).not.toContain("learnJobContactsFromEmails");
  });

  it("bid import association learns contacts for newly attached emails", () => {
    const src = readFileSync(
      resolve(here, "../application/services/associate-bid-import-emails.ts"),
      "utf8"
    );
    expect(src).toContain("learnJobContactsFromEmails");
    expect(src).toContain("emailMessageIds: assignable");
  });
});
