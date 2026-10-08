import { describe, expect, it } from "vitest";
import { shouldShowDevelopmentIndicator } from "./app-env";

describe("shouldShowDevelopmentIndicator", () => {
  it("never shows in production builds", () => {
    expect(
      shouldShowDevelopmentIndicator({
        PROD: true,
        DEV: false,
        VITE_APP_ENV: "development",
      })
    ).toBe(false);
  });

  it("shows during Vite DEV server", () => {
    expect(shouldShowDevelopmentIndicator({ PROD: false, DEV: true })).toBe(
      true
    );
  });

  it("shows when VITE_APP_ENV=development outside PROD", () => {
    expect(
      shouldShowDevelopmentIndicator({
        PROD: false,
        DEV: false,
        VITE_APP_ENV: "development",
      })
    ).toBe(true);
  });
});
