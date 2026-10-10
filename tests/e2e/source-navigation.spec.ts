import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://raw.githubusercontent.com/**/status.json", (route) => route.abort());
  await page.route("https://mcp.irishopendata.ie/mcp", async (route) => {
    const request = route.request().postDataJSON();
    const result = request.method === "tools/list" ? { tools: [] } : {
      structuredContent: { domains: [
        { domain: "stats", sources: [{ id: "cso", name: "CSO", summary: "Official statistics", operations: ["cso_search_tables"] }] },
        { domain: "law/politics", sources: [{ id: "oireachtas", name: "Oireachtas", summary: "Parliamentary data", operations: ["oireachtas_search_bills"] }] }
      ] }
    };
    await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
});

test("source subjects link only to headings in the returned catalogue", async ({ page }) => {
  await page.goto("/#directory");
  const navigation = page.getByRole("navigation", { name: "Source subjects" });
  await expect(navigation.getByRole("link")).toHaveCount(2);
  await expect(navigation.getByRole("link", { name: "Statistics" })).toHaveAttribute("href", "#domain-stats");
  const law = navigation.getByRole("link", { name: "Law and politics" });
  await expect(law).toHaveAttribute("href", "#domain-law-politics");
  await law.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#domain-law-politics")).toBeInViewport();
});

test("sample buttons load matching requests with keyboard access and never submit", async ({ page }) => {
  let submitted = 0;
  page.on("request", (request) => {
    if (request.url() === "https://mcp.irishopendata.ie/mcp" && request.postDataJSON()?.params?.name === "ireland_call") submitted++;
  });
  await page.goto("/#playground");
  for (const [index, source, operation] of [
    ["1", "luas", "luas_get_forecast"],
    ["2", "met-eireann", "met_get_warnings"],
    ["5", "ppr", "ppr_price_stats"],
    ["0", "cso", "cso_search_tables"]
  ]) {
    const sample = page.locator(`[data-example-index="${index}"]`);
    await sample.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#example-select")).toHaveValue(index);
    await expect(page.locator("#example-select")).toBeFocused();
    await expect(page.locator("#pg-source")).toHaveValue(source);
    await expect(page.locator("#pg-operation")).toHaveValue(operation);
    await expect(sample).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-example-index][aria-pressed="true"]')).toHaveCount(1);
  }
  await page.locator("#example-select").selectOption("3");
  await expect(page.locator('[data-example-index][aria-pressed="true"]')).toHaveCount(0);
  expect(submitted).toBe(0);
  await expect(page.locator("#pg-output")).toHaveAccessibleName("Live response");
  await expect(page.locator("#pg-output")).toHaveAttribute("aria-describedby", "response-guide");
});
