import { afterEach, describe, expect, it } from "vitest";
import {
  isInlineImageAiAnalyzeEnabled,
  isJobMatcherAutoAssignEnabled,
} from "../ai-automation-gates.js";

describe("ai-automation-gates", () => {
  const prevMatch = process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
  const prevImage = process.env.INLINE_IMAGE_AI_ANALYZE_ENABLED;

  afterEach(() => {
    if (prevMatch === undefined) delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    else process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = prevMatch;
    if (prevImage === undefined) delete process.env.INLINE_IMAGE_AI_ANALYZE_ENABLED;
    else process.env.INLINE_IMAGE_AI_ANALYZE_ENABLED = prevImage;
  });

  it("defaults job matcher auto-assign OFF", () => {
    delete process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED;
    expect(isJobMatcherAutoAssignEnabled()).toBe(false);
  });

  it("enables job matcher auto-assign when env is true", () => {
    process.env.JOB_MATCHER_AUTO_ASSIGN_ENABLED = "true";
    expect(isJobMatcherAutoAssignEnabled()).toBe(true);
  });

  it("defaults inline image AI analyze OFF", () => {
    delete process.env.INLINE_IMAGE_AI_ANALYZE_ENABLED;
    expect(isInlineImageAiAnalyzeEnabled()).toBe(false);
  });

  it("enables inline image AI analyze when env is true", () => {
    process.env.INLINE_IMAGE_AI_ANALYZE_ENABLED = "1";
    expect(isInlineImageAiAnalyzeEnabled()).toBe(true);
  });
});
