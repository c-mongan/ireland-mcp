import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const endpoint = "https://mcp.irishopendata.ie/mcp";
const envelope = { source: "CSO", licence: "CC BY 4.0", url: "https://data.cso.ie/table/F1001", retrieved_at: "2025-12-01T12:30:00Z", cached: true, stale: true, truncated: true, partial: true, data: [{ code: "F1001", title: "Population by county", released: "2025-11-01" }] };

async function mockPage(page: Page, result = { structuredContent: envelope }) {
  await page.route("https://raw.githubusercontent.com/**", (route) => route.fulfill({ json: { checked_at: new Date().toISOString(), status: "ok", sources: [] } }));
  await page.route(endpoint, (route) => {
    const request = route.request().postDataJSON();
    const response = request.method === "tools/list" ? { tools: [] } : request.params?.name === "ireland_catalogue" ? { structuredContent: { domains: [] } } : result;
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: response } });
  });
}

test("the first trial precedes installation and shows data, flags, provenance and optional raw text", async ({ page }) => {
  await mockPage(page);
  await page.goto("/");
  expect(await page.locator("#top").evaluate((node) => node.nextElementSibling?.id)).toBe("playground");
  await page.getByRole("button", { name: "Run live query" }).click();
  const result = page.locator("#pg-result");
  await expect(result).toContainText("Population by county");
  await expect(result).toContainText("CC BY 4.0");
  await expect(result).toContainText("UTC");
  for (const flag of ["Cached response", "Stale response", "Truncated response", "Partial response"]) await expect(result).toContainText(flag);
  await expect(result.getByRole("link", { name: "Open the source response" })).toHaveAttribute("href", envelope.url);
  await expect(page.locator("#pg-raw-details")).not.toHaveAttribute("open");
  await page.locator("#pg-raw-details summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#pg-output")).toBeVisible();
  expect(JSON.parse(await page.locator("#pg-output").innerText())).toEqual(envelope);
  await expect(page.locator("#pg-request-label")).toContainText("cso_search_tables");
  await expect(page.getByRole("link", { name: "Tell us what you could not find" })).toHaveAttribute("href", "https://github.com/c-mongan/ireland-mcp/issues/new");
});

test("upstream strings cannot create elements or executable source links", async ({ page }) => {
  const malicious = { ...envelope, source: '<img src=x onerror="alert(1)">', licence: "<script>window.pwned=true</script>", url: "javascript:alert(1)", data: [{ code: "<svg onload=alert(1)>", title: '<img src=x onerror="alert(1)">', released: null }] };
  await mockPage(page, { structuredContent: malicious });
  await page.goto("/#playground");
  await page.getByRole("button", { name: "Run live query" }).click();
  const result = page.locator("#pg-result");
  await expect(result).toContainText(malicious.source);
  await expect(result).toContainText(malicious.licence);
  await expect(result.locator("img, svg, script, a")).toHaveCount(0);
  await expect(result).toContainText("No safe source URL was supplied");
});

test("long CSO titles keep headings on one line and preserve local scrolling at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await mockPage(page, { structuredContent: { ...envelope, data: [{ code: "F1001", title: "Population statistics for counties, local authorities and census areas across Ireland".repeat(3), released: "2025-11-01" }] } });
  await page.goto("/#playground");
  await page.getByRole("button", { name: "Run live query" }).click();
  const heading = page.getByRole("columnheader", { name: "Released" });
  const lines = await heading.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects().length;
  });
  expect(lines).toBe(1);
  const scroll = page.locator("#pg-result .result-table-scroll");
  await expect(scroll).toHaveCSS("overflow-x", "auto");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("a delayed request cannot be relabelled, and changing a sample clears the previous result", async ({ page }) => {
  await mockPage(page);
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(endpoint, async (route) => {
    const request = route.request().postDataJSON();
    if (request.params?.name !== "ireland_call") return route.fallback();
    await pending;
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: { structuredContent: envelope } } });
  });
  try {
    await page.goto("/#playground");
    await page.getByRole("button", { name: "Run live query" }).click();
    await expect(page.locator("#pg-result")).toHaveAttribute("data-state", "loading");
    await expect(page.locator("#example-select")).toBeDisabled();
    await expect(page.locator("#pg-source")).toBeDisabled();
    await expect(page.locator('.question-examples [data-example-index="1"]')).toBeDisabled();
    await expect(page.locator("#pg-output")).not.toContainText("Population by county");
    release();
    await expect(page.locator("#pg-result")).toContainText("Population by county");
    await page.locator('.question-examples [data-example-index="1"]').click();
    await expect(page.locator("#pg-result")).not.toContainText("Population by county");
    await expect(page.locator("#pg-result")).not.toContainText("CC BY 4.0");
    await expect(page.locator("#pg-output")).toHaveText("Choose an example, then run it.");
    await expect(page.locator("#pg-request-label")).toHaveText("No request has run yet.");
    await expect(page.locator("#pg-status")).toBeEmpty();
  } finally { release(); }
});

test("JSON and tool errors replace previous success without a success preview", async ({ page }) => {
  await mockPage(page);
  await page.goto("/#playground");
  await page.getByRole("button", { name: "Run live query" }).click();
  await expect(page.locator("#pg-result")).toContainText("Population by county");
  await page.locator(".query-settings summary").click();
  await page.locator("#pg-args").fill("[]");
  await page.getByRole("button", { name: "Run live query" }).click();
  await expect(page.locator("#pg-status")).toContainText("Request not sent");
  await expect(page.locator("#pg-output")).toContainText("JSON object");
  await expect(page.locator("#pg-result table")).toHaveCount(0);
  await page.locator("#pg-args").fill("{}");
  await page.route(endpoint, async (route) => {
    const request = route.request().postDataJSON();
    if (request.params?.name !== "ireland_call") return route.fallback();
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: { isError: true, structuredContent: envelope } } });
  });
  await page.getByRole("button", { name: "Run live query" }).click();
  await expect(page.locator("#pg-status")).toContainText("Query failed");
  await expect(page.locator("#pg-result")).toContainText("source returned an error");
  await expect(page.locator("#pg-result table")).toHaveCount(0);
  await expect(page.locator("#pg-output")).toBeVisible();
});

for (const colorScheme of ["dark", "light"] as const) {
  test(`historical rent is readable at 320px in ${colorScheme} theme without claiming zero rent`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await mockPage(page, { structuredContent: { ...envelope, data: { code: "RIQ02", title: "RTB Average Monthly Rent Report", rows: [{ Location: "Galway City", Quarter: "2025Q4", "Number of Bedrooms": "Two bed", "Property Type": "Apartment", value: 0, unit: "Euro" }] } } });
    await page.goto("/#playground");
    await page.locator('.question-examples [data-example-index="6"]').click();
    await page.getByRole("button", { name: "Run live query" }).click();
    await expect(page.locator("#pg-result")).toContainText("Insufficient published data");
    await expect(page.locator("#pg-result")).toContainText("Historical registered-tenancy statistics");
    await expect(page.locator("#pg-result")).not.toContainText("0 Euro");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });
}
