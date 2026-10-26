import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const samples = [
  { option: "Tourism attractions in Galway", source: "failte-ireland", operation: "failte_search", args: { dataset: "attractions", county: "Galway", limit: 5 }, data: { source_updated_at: null, records: [{ name: "<img src=x onerror=alert(1)> Sample attraction", county: "Galway", category: null, address: null }] }, table: "Tourism listings", text: "Sample attraction", notice: "Source update date: Not reported" },
  { option: "Static transport stops named Heuston", source: "tfi-static", operation: "tfi_static_search_stops", args: { name: "Heuston", limit: 5 }, data: { snapshot_modified_at: "2026-01-01T11:00:00", fetched_at: "2026-01-02T12:00:00Z", stops: [{ name: "Sample Heuston stop", atco_code: "SAMPLE-ATCO", plate_code: null, status: "active" }] }, table: "Static transport stops", text: "SAMPLE-ATCO", notice: "time zone is not supplied" },
  { option: "Groundwater vulnerability at a Dublin point", source: "gsi", operation: "groundwater_vulnerability_at", args: { lat: 53.3498, lon: -6.2603 }, data: { map_scale: "1:40000", dataset_revision: null, areas: [{ id: "SAMPLE-AREA", category: "H", description: "High" }] }, table: "Groundwater vulnerability areas", text: "SAMPLE-AREA", notice: "Dataset revision: Not reported" }
];

for (const theme of ["light", "dark"] as const) {
  test(`new source examples render safe, accessible ${theme} previews on mobile`, async ({ page }) => {
    const calls: unknown[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") return route.continue();
      if (url.hostname !== "mcp.irishopendata.ie") return route.abort();
      const body = route.request().postDataJSON();
      let result: object = {};
      if (body.params?.name === "ireland_catalogue") result = { structuredContent: { domains: [] } };
      if (body.params?.name === "ireland_call") {
        calls.push(body.params.arguments);
        const sample = samples.find((item) => item.source === body.params.arguments.source)!;
        result = { structuredContent: { source: "Synthetic fixture publisher", url: "https://data.gov.ie/", licence: "CC BY 4.0", retrieved_at: "2026-01-03T12:00:00Z", cached: true, stale: true, truncated: true, data: sample.data } };
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }) });
    });
    await page.goto("/#playground");
    for (const sample of samples) {
      await page.locator("#example-select").selectOption({ label: sample.option });
      await page.locator('#playground-form button[type="submit"]').click();
      const preview = page.locator("#pg-result");
      await expect(preview.getByRole("table", { name: sample.table })).toContainText(sample.text);
      await expect(preview).toContainText(sample.notice);
      await expect(preview).toContainText("Stale response");
      await expect(preview).toContainText("Truncated response");
      await expect(preview).toContainText("Synthetic fixture publisher");
      await expect(preview.locator("img")).toHaveCount(0);
      await expect(preview.locator(".result-table-scroll")).toHaveAttribute("tabindex", "0");
      const tableRegion = preview.locator(".result-table-scroll");
      await tableRegion.focus();
      await expect(tableRegion).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).include("#playground").analyze()).violations).toEqual([]);
    }
    expect(calls).toEqual(samples.map(({ source, operation, args }) => ({ source, operation, args, limit: 5, max_tokens: 1400 })));
    expect(errors).toEqual([]);
  });
}
