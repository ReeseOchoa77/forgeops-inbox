import { describe, expect, it } from "vitest";
import {
  canReplaceClassificationAuthority,
  resolveClassificationAuthority,
  withClassificationAuthority,
} from "../classification-authority.js";
import {
  matchesForgeOpsOutboundCandidate,
  isForgeOpsLocalSentMessageId,
} from "../outbound-send-reconcile.js";
import { BUSINESS_SUBTYPE_LABELS, businessSubtypeComposeOptions } from "../business-subtypes.js";

describe("classification authority", () => {
  it("C) AI cannot overwrite USER_EXPLICIT", () => {
    expect(
      canReplaceClassificationAuthority({
        existing: "USER_EXPLICIT",
        incoming: "AI",
      })
    ).toBe(false);
  });

  it("D/E) AI cannot overwrite SYSTEM_DETERMINISTIC", () => {
    expect(
      canReplaceClassificationAuthority({
        existing: "SYSTEM_DETERMINISTIC",
        incoming: "AI",
      })
    ).toBe(false);
  });

  it("G) AI may classify ordinary email", () => {
    expect(
      canReplaceClassificationAuthority({
        existing: "AI",
        incoming: "AI",
      })
    ).toBe(true);
  });

  it("USER_EXPLICIT outranks SYSTEM_DETERMINISTIC", () => {
    expect(
      canReplaceClassificationAuthority({
        existing: "USER_EXPLICIT",
        incoming: "SYSTEM_DETERMINISTIC",
      })
    ).toBe(false);
    expect(
      canReplaceClassificationAuthority({
        existing: "SYSTEM_DETERMINISTIC",
        incoming: "USER_EXPLICIT",
      })
    ).toBe(true);
  });

  it("resolves legacy folder deterministic + reviewedByUserId", () => {
    expect(
      resolveClassificationAuthority({
        routingHints: { source: "quotes_folder", deterministic: true },
      })
    ).toBe("SYSTEM_DETERMINISTIC");
    expect(
      resolveClassificationAuthority({
        routingHints: null,
        reviewedByUserId: "u1",
      })
    ).toBe("USER_EXPLICIT");
    expect(resolveClassificationAuthority({ routingHints: null })).toBe("AI");
  });

  it("withClassificationAuthority stamps authority", () => {
    const h = withClassificationAuthority(null, "USER_EXPLICIT", "forgeops_compose");
    expect(h.authority).toBe("USER_EXPLICIT");
    expect(h.source).toBe("forgeops_compose");
  });
});

describe("outbound reconcile helpers", () => {
  it("recognizes forgeops-sent local ids", () => {
    expect(isForgeOpsLocalSentMessageId("forgeops-sent-abc")).toBe(true);
    expect(isForgeOpsLocalSentMessageId("AAMkADxx")).toBe(false);
  });

  it("Q) similar subjects with different To do not match", () => {
    const now = new Date();
    expect(
      matchesForgeOpsOutboundCandidate({
        localSubject: "Project Falcon Quote",
        incomingSubject: "Project Falcon Quote",
        localTo: [{ email: "a@x.com" }],
        incomingTo: [{ email: "b@x.com" }],
        localSentAt: now,
        incomingSentAt: now,
      })
    ).toBe(false);
  });

  it("matches when subject+To+time align", () => {
    const now = new Date();
    expect(
      matchesForgeOpsOutboundCandidate({
        localSubject: "Project Falcon Quote",
        incomingSubject: "Re: Project Falcon Quote",
        localTo: [{ email: "gc@example.com" }],
        incomingTo: [{ email: "gc@example.com" }],
        localSentAt: now,
        incomingSentAt: new Date(now.getTime() + 30_000),
      })
    ).toBe(true);
  });
});

describe("compose options", () => {
  it("includes General and Quote", () => {
    const opts = businessSubtypeComposeOptions();
    expect(opts[0]?.key).toBe("GENERAL");
    expect(BUSINESS_SUBTYPE_LABELS.GENERAL).toBe("General");
    expect(opts.some((o) => o.key === "ESTIMATE_QUOTE" && o.label === "Quote")).toBe(
      true
    );
  });
});
