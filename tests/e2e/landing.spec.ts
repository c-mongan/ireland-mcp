import { mkdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const endpointPattern = /https:\/\/func-ireland-mcp-aofsjpwgy4hva\.azurewebsites\.net\/mcp/;
const shotsDir = "/Users/conormongan/.copilot/session-state/f860f69b-9d56-4f8a-824c-31bc2e718473/files/ui-shots";

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
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ checked_at: "2026-10-05T20:00:00Z", status: "ok", sources: [{ source: "cso", status: "up", latencyMs: 20 }] }) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockNetwork(page);
});

test("renders hero, live stats, source directory and passes axe", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Every Irish public dataset/i })).toBeVisible();
  await expect(page.getByText("≈1.4k default surface")).toBeVisible();
  await expect(page.locator("#stat-sources")).toHaveText("1");
  await expect(page.getByRole("heading", { name: "CSO" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("install copy works and deeplinks use current formats", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#install");
  const href = await page.getByRole("link", { name: "Install in VS Code" }).getAttribute("href");
  expect(href).toMatch(/^vscode:\/\/mcp\/install\?/);
  const payload = JSON.parse(decodeURIComponent(href!.split("?")[1]));
  expect(payload).toEqual({ name: "ireland", type: "http", url: "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp" });
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

test("reduced motion pauses decorative motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#text-rain")).toBeHidden();
  await expect(page.locator(".video-background")).toBeHidden();
  const paused = await page.locator("#hero-video").evaluate((video) => (video as HTMLVideoElement).paused);
  expect(paused).toBe(true);
});

test("captures desktop and mobile screenshots", async ({ page, browser }) => {
  mkdirSync(shotsDir, { recursive: true });
  await page.goto("/");
  await page.screenshot({ path: `${shotsDir}/desktop.png`, fullPage: true });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mockNetwork(mobile);
  await mobile.goto("/");
  await mobile.screenshot({ path: `${shotsDir}/mobile.png`, fullPage: true });
  await mobile.close();
});
