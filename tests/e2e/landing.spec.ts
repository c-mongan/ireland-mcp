import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const endpointPattern = /https:\/\/mcp\.irishopendata\.com\/mcp/;
const shotsDir = resolve("test-results/ui-shots");

async function mockNetwork(page: Page) {
  await page.route(endpointPattern, async (route) => {
    const body = route.request().postDataJSON() as { method: string; params?: { name?: string } };
    if (body.method === "tools/list") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: ["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about", "search", "fetch", "nearby"].map((name) => ({ name, description: `${name} description` })) } }) });
      return;
    }
    if (body.params?.name === "ireland_catalogue") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 2, result: { structuredContent: { domains: [{ domain: "stats", sources: [{ id: "cso", name: "CSO", summary: "Official statistics", operations: ["cso_search_tables", "cso_get_data"] }] }] } } }) });
      return;
    }
    if (body.params?.name === "ireland_call") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 3, result: { structuredContent: { ok: true, rows: [{ title: "Population estimates" }], source: "cso" } } }) });
      return;
    }
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "unexpected" }) });
  });
  await page.route("https://raw.githubusercontent.com/c-mongan/ireland-mcp/status/status/status.json", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ checked_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), status: "ok", sources: [{ source: "cso", status: "up", latencyMs: 20 }] }) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
});

test("renders hero, live stats, source directory and passes axe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Irish public data, ready to query/i })).toBeVisible();
  await expect(page.getByText("Seven tools to get started")).toBeVisible();
  await expect(page.locator("#stat-sources")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "CSO" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("install copy works and deeplinks use current formats", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#install");
  const href = await page.getByRole("link", { name: "Install in VS Code" }).getAttribute("href");
  expect(href).toMatch(/^vscode:mcp\/install\?/);
  const payload = JSON.parse(decodeURIComponent(href!.split("?")[1]));
  expect(payload).toEqual({ name: "ireland", type: "http", url: "https://mcp.irishopendata.com/mcp" });
  await page.getByRole("tab", { name: "Cursor" }).click();
  const cursorHref = await page.getByRole("link", { name: "Install in Cursor" }).getAttribute("href");
  expect(cursorHref).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=ireland&config=/);
  await page.getByRole("button", { name: "Copy Config" }).click();
  await expect(page.locator("#copy-status")).toContainText("Copied");
});

test("serves llms.txt, AGENTS.md and server card", async ({ request }) => {
  await expect((await request.get("/llms.txt"))).toBeOK();
  expect(await (await request.get("/llms.txt")).text()).toContain("ireland_catalogue");
  const agents = await request.get("/AGENTS.md");
  await expect(agents).toBeOK();
  expect(await agents.text()).toContain("claude mcp add --transport http ireland");
  const card = await request.get("/.well-known/mcp.json");
  await expect(card).toBeOK();
  expect((await card.json()).transports[0].url).toContain("/mcp");
  await expect((await request.get("/.well-known/mcp/server-card.json"))).toBeOK();
});

test("playground calls ireland_call against mocked MCP route", async ({ page }) => {
  await page.goto("/#playground");
  await page.getByRole("button", { name: "Run Live Query" }).click();
  await expect(page.locator("#pg-output")).toContainText("Population estimates");
  await expect(page.locator("#pg-output")).toContainText('"ok": true');
});

test("video respects reduced motion and has a working pause control", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#hero-video")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play video" })).not.toHaveAttribute("aria-pressed");
  expect(await page.locator("#hero-video").evaluate((el) => (el as HTMLVideoElement).paused)).toBe(true);
  await page.getByRole("button", { name: "Play video" }).click();
  await expect(page.getByRole("button", { name: "Pause video" })).toBeVisible();
  await page.getByRole("button", { name: "Pause video" }).click();
  expect(await page.locator("#hero-video").evaluate((el) => (el as HTMLVideoElement).paused)).toBe(true);
});

test("Gemini copies its displayed configuration and tabs support arrow keys", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#install");
  await page.getByRole("tab", { name: "Gemini CLI" }).click();
  const displayed = await page.locator("#install-panel pre").innerText();
  await page.getByRole("button", { name: "Copy Config" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
  expect(JSON.parse(displayed).mcpServers.ireland.httpUrl).toContain("/mcp");
  await page.getByRole("tab", { name: "Gemini CLI" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Windsurf" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-windsurf");
});

test("playground deep link stays visible after catalogue loads", async ({ page }) => {
  await page.goto("/#playground");
  await expect(page.getByRole("heading", { name: "CSO", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Try a query", exact: true })).toBeInViewport();
  await page.locator(".query-settings summary").click();
  await page.locator("#pg-args").fill("{broken");
  await page.getByRole("button", { name: "Run Live Query" }).click();
  await expect(page.locator("#pg-output")).toHaveText("Arguments must be valid JSON.");
});

test("captures desktop and mobile screenshots", async ({ page, browser }) => {
  mkdirSync(shotsDir, { recursive: true });
  await page.goto("/");
  await page.screenshot({ path: `${shotsDir}/desktop.png`, fullPage: true });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobile = await mobileContext.newPage();
  await mockNetwork(mobile);
  await mobile.goto("/");
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page: mobile }).analyze();
  expect(axe.violations).toEqual([]);
  await mobile.screenshot({ path: `${shotsDir}/mobile.png`, fullPage: true });
  await mobileContext.close();
});

test("old status reports are not presented as current health", async ({ page }) => {
  await page.goto("/#status");
  await expect(page.locator("#status-card")).toContainText("Status check is out of date");
});

test("status explains source failures and missing setup separately", async ({ page }) => {
  await page.route("https://raw.githubusercontent.com/c-mongan/ireland-mcp/status/status/status.json", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      checked_at: new Date().toISOString(), status: "degraded", sources: [
        { source: "met-eireann", status: "up", latencyMs: 70 },
        { source: "kohesio", status: "down", httpStatus: 403, error: "HTTP 403", latencyMs: 100 },
        { source: "nta", status: "skipped", error: "NTA_API_KEY not set", latencyMs: 0 }
      ]
    }) });
  });
  await page.goto("/#status");
  const card = page.locator("#status-card");
  await expect(card).toContainText("1 source unavailable");
  await expect(card).toContainText("kohesio: unavailable · Provider refused access (HTTP 403)");
  await expect(card).toContainText("nta: setup needed · NTA_API_KEY not set");
  await expect(card).toContainText("1 healthy · 1 unavailable · 1 needs setup");
});


test("a fresh failed health request is shown as a failure, not an old report", async ({ page }) => {
  await page.route("https://raw.githubusercontent.com/c-mongan/ireland-mcp/status/status/status.json", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      status: "unreachable", fetched_at: new Date().toISOString(), error: "HTTP 503"
    }) });
  });
  await page.goto("/#status");
  await expect(page.locator("#status-card")).toContainText("Service health check failed");
  await expect(page.locator("#status-card")).toContainText("HTTP 503");
  await expect(page.locator("#status-card")).not.toContainText("out of date");
});
