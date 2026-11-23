import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildJobMatchPersistence } from "../application/services/persist-job-match.js";
import type { JobMatchResult } from "@forgeops/shared";

const here = dirname(fileURLToPath(import.meta.url));

const sampleMatch: JobMatchResult = {
  selectedJobId: "job-1",
  confidence: 0.95,
  assignmentSource: "AI_AUTO_ASSIGNED",
  requiresReview: false,
  evidence: [],
  ambiguousCandidateIds: [],
  candidateCount: 1,
  matcherVersion: "test",
  identityPolicy: "CONTEXT_AWARE_V2",
};

describe("AI Control Center worker enforcement", () => {
  it("respects autoAssignEnabled override independent of env", () => {
    const prev = process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    try {
      process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "true";
      expect(
        buildJobMatchPersistence(sampleMatch, null, { autoAssignEnabled: false })
      ).toBeNull();
      process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "false";
      expect(
        buildJobMatchPersistence(sampleMatch, null, { autoAssignEnabled: true })
      ).not.toBeNull();
    } finally {
      if (prev === undefined) delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
      else process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = prev;
    }
  });

  it("wires native classification, sync, JI, and inline gates", () => {
    const persistNative = readFileSync(
      join(here, "../application/services/persist-native-classification.ts"),
      "utf8"
    );
    const classify = readFileSync(
      join(here, "../application/services/classify-email-message-native.ts"),
      "utf8"
    );
    const sync = readFileSync(
      join(here, "../application/processors/inbox-sync.processor.ts"),
      "utf8"
    );
    const ji = readFileSync(
      join(here, "../application/processors/job-intelligence.processor.ts"),
      "utf8"
    );
    const inline = readFileSync(
      join(here, "../application/services/analyze-inline-images.ts"),
      "utf8"
    );
    const historical = readFileSync(
      join(here, "../application/processors/mailbox-historical-import.processor.ts"),
      "utf8"
    );

    expect(persistNative).toContain("resolveJobMatcherGate");
    expect(persistNative).toContain("identityPolicy: matcherGate.identityPolicy");
    expect(persistNative).toContain("autoAssignEnabled: matcherGate.enabled");
    expect(classify).toContain("email-classification");
    expect(classify).toContain("ai_control_disabled");
    expect(sync).toContain("email-classification");
    expect(sync).toContain("classificationAiEnabled");
    expect(ji).toContain("job-intelligence");
    expect(ji).toContain("ai_control_disabled");
    expect(inline).toContain("inline-image-relevance");
    expect(historical).toContain("email-classification");
  });
});
