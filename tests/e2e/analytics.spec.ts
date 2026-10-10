import { test, expect, type Page } from "@playwright/test";

const ingestion = "https://eu.i.posthog.com/i/v0/e/";
async function fixtures(page: Page, enabled = true) {
  const captures: Record<string, unknown>[] = [];
  await page.route("**/analytics-config.json", (route) => route.fulfill({ json: { enabled, token: "test-public-token", host: "https://eu.i.posthog.com", release: "abcdef0123456789" } }));
  await page.route(ingestion, (route) => {
    captures.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { status: 1 } });
  });
  await page.route("https://mcp.irishopendata.ie/mcp", (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: {
      jsonrpc: "2.0", id: request.id,
      result: request.method === "tools/list" ? { tools: [] } : { structuredContent: { rows: [{ detail: "private-result" }] } }
    } });
  });
  await page.route("https://raw.githubusercontent.com/**/status.json", (route) => route.abort());
  return captures;
}

async function optIn(page: Page) {
  await expect(page.locator("#analytics-toggle")).toBeEnabled();
  await page.locator("#analytics-toggle").click();
  await expect(page.locator("#analytics-toggle")).toHaveAttribute("aria-pressed", "true");
}

test("metrics control stays disabled while configuration is loading and works when ready", async ({ page }) => {
  const captures = await fixtures(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/analytics-config.json", async (route) => {
    await delayed;
    await route.fulfill({ json: { enabled: true, token: "test-public-token", host: "https://eu.i.posthog.com" } });
  });
  const requested = page.waitForRequest("**/analytics-config.json");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await requested;
  const toggle = page.locator("#analytics-toggle");
  try {
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveText("Loading usage metrics…");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.evaluate((button: HTMLButtonElement) => button.click());
    await page.locator("#theme-toggle").click();
    expect(captures).toEqual([]);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  } finally {
    release();
  }
  await optIn(page);
  await page.locator("#theme-toggle").click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]!.event).toBe("ireland_theme_changed");
});

test("usage capture stays off until opt-in and stops after opt-out", async ({ page, context }) => {
  const captures = await fixtures(page);
  await page.goto("/");
  await page.locator("#theme-toggle").click();
  await page.getByRole("tab", { name: "Claude", exact: true }).click();
  expect(captures).toEqual([]);
  await optIn(page);
  await page.locator("#theme-toggle").click();
  await expect.poll(() => captures.length).toBe(1);
  expect(captures[0]).toMatchObject({ event: "ireland_theme_changed", properties: { surface: "web", schema_version: 1, release_commit: "abcdef0123456789", $process_person_profile: false, $geoip_disable: true, $ip: "0.0.0.0" } });
  const identity = captures[0]!.distinct_id;
  await page.getByRole("tab", { name: "Cursor", exact: true }).click();
  await expect.poll(() => captures.length).toBe(2);
  expect(captures[1]!.distinct_id).toBe(identity);
  await page.locator("#analytics-toggle").click();
  await page.locator("#theme-toggle").click();
  expect(captures).toHaveLength(2);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["ireland-mcp-theme"]);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  await page.reload();
  await expect(page.locator("#analytics-toggle")).toHaveAttribute("aria-pressed", "false");
  await optIn(page);
  await page.locator("#theme-toggle").click();
  await expect.poll(() => captures.length).toBe(3);
  expect(captures[2]!.distinct_id).not.toBe(identity);
});

for (const setting of ["doNotTrack", "globalPrivacyControl"] as const) {
  test(`browser ${setting} overrides available metrics configuration`, async ({ page }) => {
    const captures = await fixtures(page);
    await page.addInitScript((property) => Object.defineProperty(navigator, property, { configurable: true, value: property === "doNotTrack" ? "1" : true }), setting);
    await page.goto("/");
    await expect(page.locator("#analytics-toggle")).toBeDisabled();
    await expect(page.locator("#analytics-toggle")).toHaveText("Usage metrics blocked by privacy settings");
    await page.locator("#theme-toggle").click();
    expect(captures).toEqual([]);
  });
}

test("query event cannot include user text, unknown labels, response data or URL", async ({ page }) => {
  const captures = await fixtures(page);
  await page.goto("/#playground");
  await optIn(page);
  await page.locator(".query-settings summary").click();
  await page.locator("#pg-source").fill("private@email.example");
  await page.locator("#pg-operation").fill("https://private.example/secret");
  await page.locator("#pg-args").fill('{"query":"private-query", "token":"private-secret"}');
  await page.getByRole("button", { name: /Run live query/i }).click();
  await expect(page.locator("#pg-output")).toContainText("private-result");
  await expect.poll(() => captures.length).toBe(1);
  const body = captures[0]!;
  expect(body).toMatchObject({ event: "ireland_query_completed", properties: { source: "_OTHER", operation: "_OTHER", outcome: "ok" } });
  expect(JSON.stringify(body)).not.toContain("private");
  expect(Object.keys(body.properties as object).sort()).toEqual(["$geoip_disable", "$ip", "$process_person_profile", "duration_ms", "operation", "outcome", "release_commit", "schema_version", "source", "surface"].sort());
});

test("analytics network rejection does not break UI or leak an exception", async ({ page }) => {
  await fixtures(page);
  await page.route(ingestion, (route) => route.abort());
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await optIn(page);
  await page.locator("#theme-toggle").click();
  await page.getByRole("tab", { name: "Claude", exact: true }).click();
  await expect(page.locator("#install-panel")).toContainText("claude mcp add");
  await page.getByRole("button", { name: /Run live query/i }).click();
  await expect(page.locator("#pg-output")).toContainText("private-result");
  expect(errors).toEqual([]);
});

test("disabled deployment configuration permits UI but prevents metrics opt-in", async ({ page }) => {
  const captures = await fixtures(page, false);
  await page.goto("/");
  await expect(page.locator("#analytics-toggle")).toBeDisabled();
  await expect(page.locator("#analytics-toggle")).toHaveText("Usage metrics unavailable");
  await page.locator("#theme-toggle").click();
  expect(captures).toEqual([]);
});

test("capture is bounded, ignores arbitrary events, and permits only known scalar fields", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error The browser module is served from the website, not this TypeScript test.
    const { createAnalytics } = await import("/analytics.js");
    const payloads: unknown[] = [];
    const analytics = createAnalytics({ operations: new Map([["cso", new Set(["cso_search_tables"])]]), fetch: async (_url: string, init: RequestInit) => {
      payloads.push(JSON.parse(String(init.body)));
      return new Response(null);
    } });
    analytics.configure({ enabled: true, token: "test", host: "https://eu.i.posthog.com", release: "private-token" });
    analytics.setEnabled(true);
    analytics.capture("arbitrary-private-event", { private: "private" });
    for (let index = 0; index < 40; index++) {
      analytics.capture("ireland_query_completed", { source: "cso", operation: "cso_search_tables", outcome: "error", duration_ms: Infinity, args: "private", result: "private", error: "private" });
      // Permit completed sends to leave the two-request concurrency bound.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    analytics.capture("ireland_theme_changed", { theme: "private" });
    return payloads;
  });
  expect(result).toHaveLength(30);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(result[0]).not.toHaveProperty("properties.release_commit");
  expect(result[0]).toMatchObject({ properties: { source: "cso", operation: "cso_search_tables", outcome: "error", duration_ms: 0 } });
});
