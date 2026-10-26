import { describe, expect, it } from "vitest";
import { BUDGET_RESOURCES, budgetResourceUrl, isAllowedBudgetUrl } from "./manifest.js";

describe("council budget resource allowlist", () => {
  it("accepts only the exact official publisher URL for the selected resource", () => {
    const resource = BUDGET_RESOURCES.find(({ year }) => year === 2026)!;
    const url = budgetResourceUrl(resource);
    expect(isAllowedBudgetUrl(url, resource)).toBe(true);
    expect(isAllowedBudgetUrl(url.replace("opendata.housing.gov.ie", "attacker.example"), resource)).toBe(false);
    expect(isAllowedBudgetUrl(`${url}?redirect=https://attacker.example`, resource)).toBe(false);
    expect(isAllowedBudgetUrl(`${url}/extra`, resource)).toBe(false);
  });
});
