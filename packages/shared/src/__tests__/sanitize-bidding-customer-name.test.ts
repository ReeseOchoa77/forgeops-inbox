import { describe, expect, it } from "vitest";
import {
  isBiddingPlatformCompanyName,
  looksLikePersonName,
  sanitizeBiddingCustomerCompanyName,
} from "../bidding/sanitize-bidding-customer-name.js";

describe("sanitizeBiddingCustomerCompanyName", () => {
  it("rejects project-name collisions", () => {
    expect(
      sanitizeBiddingCustomerCompanyName({
        companyName: "Garden City Elementary School 2023 Referendum Alterations",
        projectName: "Garden City Elementary School 2023 Referendum Alterations",
      })
    ).toBeNull();
  });

  it("keeps company distinct from project", () => {
    expect(
      sanitizeBiddingCustomerCompanyName({
        companyName: "Mortenson",
        projectName: "Garden City Elementary School",
      })
    ).toBe("Mortenson");
  });

  it("rejects person names", () => {
    expect(looksLikePersonName("John Smith")).toBe(true);
    expect(
      sanitizeBiddingCustomerCompanyName({ companyName: "John Smith" })
    ).toBeNull();
  });

  it("keeps organization-looking names", () => {
    expect(looksLikePersonName("JE Dunn Construction")).toBe(false);
    expect(
      sanitizeBiddingCustomerCompanyName({
        companyName: "JE Dunn Construction",
      })
    ).toBe("JE Dunn Construction");
    expect(
      sanitizeBiddingCustomerCompanyName({ companyName: "Mortenson" })
    ).toBe("Mortenson");
  });

  it("rejects bidding platforms", () => {
    expect(isBiddingPlatformCompanyName("BuildingConnected")).toBe(true);
    expect(
      sanitizeBiddingCustomerCompanyName({
        companyName: "BuildingConnected",
      })
    ).toBeNull();
  });
});
