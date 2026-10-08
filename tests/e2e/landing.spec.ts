import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const endpointPattern = /https:\/\/mcp\.irishopendata\.ie\/mcp/;
const shotsDir = resolve("test-results/ui-shots");
const counts = JSON.parse(readFileSync(resolve("docs/counts.json"), "utf8"));

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
  await expect(page.locator("#top h1")).toBeVisible();
  await expect(page.locator("#stat-ops")).toHaveText(String(counts.default_tools));
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
  expect(payload).toEqual({ name: "ireland", type: "http", url: "https://mcp.irishopendata.ie/mcp" });
  const insiders = await page.getByRole("link", { name: "Install in Insiders" }).getAttribute("href");
  expect(insiders).toMatch(/^vscode-insiders:mcp\/install\?/);
  expect(JSON.parse(decodeURIComponent(insiders!.split("?")[1]))).toEqual(payload);
  await page.getByRole("tab", { name: "Cursor" }).click();
  const cursorHref = await page.getByRole("link", { name: "Install in Cursor" }).getAttribute("href");
  expect(cursorHref).toMatch(/^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=ireland&config=/);
  expect(JSON.parse(Buffer.from(new URL(cursorHref!).searchParams.get("config")!, "base64").toString("utf8"))).toEqual({
    type: "http", url: "https://mcp.irishopendata.ie/mcp"
  });
  await page.getByRole("button", { name: "Copy Config" }).click();
  await expect(page.locator("#copy-status")).toContainText("Copied");
});

test("serves llms.txt, AGENTS.md and server card", async ({ request }) => {
  await expect((await request.get("/llms.txt"))).toBeOK();
  expect(await (await request.get("/llms.txt")).text()).toContain("ireland_catalogue");
  const agents = await request.get("/AGENTS.md");
  await expect(agents).toBeOK();
  const instructions = await agents.text();
  expect(instructions).toContain("claude mcp add --transport http ireland https://mcp.irishopendata.ie/mcp");
  expect(instructions).toContain("copilot mcp add --transport http ireland https://mcp.irishopendata.ie/mcp");
  const card = await request.get("/.well-known/mcp.json");
  await expect(card).toBeOK();
  expect((await card.json()).transports[0].url).toBe("https://mcp.irishopendata.ie/mcp");
  const serverCard = await request.get("/.well-known/mcp/server-card.json");
  await expect(serverCard).toBeOK();
  expect(await serverCard.text()).toContain("https://mcp.irishopendata.ie/mcp");
});

test("playground calls ireland_call against mocked MCP route", async ({ page }) => {
  await page.goto("/#playground");
  await page.getByRole("button", { name: /Run live query/i }).click();
  await expect(page.locator("#pg-output")).toContainText("Population estimates");
  await expect(page.locator("#pg-output")).toContainText('"ok": true');
});

for (const failure of ["TimeoutError", "AbortError", "TypeError"] as const) {
  for (const recover of [true, false]) {
    test(`playground retries ${failure} once and ${recover ? "recovers" : "shows friendly guidance"}`, async ({ page }) => {
      await page.addInitScript(({ failure, recover }) => {
        const originalFetch = window.fetch.bind(window);
        let attempts = 0;
        window.fetch = async (input, init) => {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
          if (body?.params?.name === "ireland_call") {
            attempts++;
            document.documentElement.dataset.queryAttempts = String(attempts);
            if (!recover || attempts === 1) {
              if (failure === "TypeError") throw new TypeError("Failed to fetch");
              throw new DOMException("signal timed out", failure);
            }
          }
          return originalFetch(input, init);
        };
      }, { failure, recover });
      await page.goto("/#playground");
      const run = page.getByRole("button", { name: /Run live query/i });
      await run.click();
      if (recover) {
        await expect(page.locator("#pg-output")).toContainText("Population estimates");
        await expect(page.locator("#pg-output")).not.toHaveClass(/error/);
      } else {
        await expect(page.locator("#pg-output")).toContainText(failure === "TypeError" ? "Could not connect" : "took too long");
        await expect(page.locator("#pg-output")).toContainText("please try again");
        await expect(page.locator("#pg-output")).not.toContainText("signal timed out");
        await expect(page.locator("#pg-status")).toContainText("Query failed");
      }
      await expect(page.locator("html")).toHaveAttribute("data-query-attempts", "2");
      await expect(run).toBeEnabled();
    });
  }
}

test("canonical metadata and public social assets are available", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://irishopendata.ie/");
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    await expect(page.locator(selector)).toHaveAttribute("content", "https://irishopendata.ie/social-card.png");
  }
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  for (const path of ["/favicon.svg", "/favicon.ico", "/social-card.png"]) {
    const response = await request.get(path);
    await expect(response).toBeOK();
    expect(response.headers()["content-type"]).toMatch(/image/);
  }
  const image = await (await request.get("/social-card.png")).body();
  expect(image.subarray(1, 4).toString()).toBe("PNG");
  expect(image.readUInt32BE(16)).toBe(1200);
  expect(image.readUInt32BE(20)).toBe(630);
  await expect(page.getByText("Unofficial community project — not affiliated with the Irish Government.", { exact: true })).toBeVisible();
});

test("installer commands and JSON use the documented primary endpoint", async ({ page }) => {
  const endpoint = "https://mcp.irishopendata.ie/mcp";
  await page.goto("/#install");
  await expect(page.locator("#endpoint-line")).toHaveText(endpoint);
  for (const [tab, command] of [
    ["Claude", `claude mcp add --transport http ireland ${endpoint}`],
    ["Copilot CLI", `copilot mcp add --transport http ireland ${endpoint}`]
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(page.locator("#install-panel pre")).toContainText(command);
    await expect(page.getByRole("button", { name: "Copy Config" })).toHaveAttribute("data-copy", command);
  }
  const copilotText = await page.locator("#install-panel pre").innerText();
  expect(JSON.parse(copilotText.slice(copilotText.indexOf("{")))).toEqual({
    mcpServers: { ireland: { type: "http", url: endpoint, tools: ["*"] } }
  });
  await page.getByRole("tab", { name: "ChatGPT", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copy Config" })).toHaveAttribute("data-copy", endpoint);
  await page.getByRole("tab", { name: "Generic JSON" }).click();
  expect(JSON.parse(await page.locator("#install-panel pre").innerText())).toEqual({
    servers: { ireland: { type: "http", url: endpoint } }
  });
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
  expect(JSON.parse(displayed).mcpServers.ireland.httpUrl).toBe("https://mcp.irishopendata.ie/mcp");
  await page.getByRole("tab", { name: "Gemini CLI" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Windsurf" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "tab-windsurf");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Generic JSON" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "VS Code", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Generic JSON" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: "VS Code", exact: true })).toBeFocused();
});

test("playground deep link stays visible after catalogue loads", async ({ page }) => {
  await page.goto("/#playground");
  await expect(page.getByRole("heading", { name: "CSO", exact: true })).toBeVisible();
  await expect(page.locator("#playground-title")).toBeInViewport();
  await page.locator(".query-settings summary").click();
  await page.locator("#pg-args").fill("{broken");
  await page.getByRole("button", { name: /Run live query/i }).click();
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

test("source fallback matches checked-in counts without counting cross as a publisher", async ({ page }) => {
  await page.route(endpointPattern, (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.locator("#live-label")).toHaveText("Using Static Fallback");
  await expect(page.locator("#stat-sources")).toHaveText(String(counts.sources));
  await expect(page.locator("#stat-ops")).toHaveText(String(counts.default_tools));
  await expect(page.locator(".source-card")).toHaveCount(counts.sources + 1);
  const operations = await page.locator(".source-meta span:first-child").allTextContents();
  expect(operations.reduce((sum, text) => sum + Number.parseInt(text, 10), 0)).toBe(counts.operations);
  await expect(page.getByRole("heading", { name: "Ireland MCP combined sources", exact: true })).toBeVisible();
});

test("catalogue tool errors use fallback rather than claiming live success", async ({ page }) => {
  await page.route(endpointPattern, async (route) => {
    const body = route.request().postDataJSON();
    if (body.params?.name === "ireland_catalogue") {
      await route.fulfill({ json: { result: { isError: true, content: [{ type: "text", text: "Provider unavailable" }] } } });
    } else {
      await route.fulfill({ json: { result: { tools: [] } } });
    }
  });
  await page.goto("/");
  await expect(page.locator("#live-label")).toHaveText("Using Static Fallback");
  await expect(page.locator(".source-card")).toHaveCount(counts.sources + 1);
});

test("catalogue source names and summaries are rendered as text", async ({ page }) => {
  await page.route(endpointPattern, async (route) => {
    const body = route.request().postDataJSON();
    if (body.params?.name !== "ireland_catalogue") return route.fallback();
    await route.fulfill({ json: { result: { structuredContent: { domains: [{
      domain: "stats",
      sources: [{ id: "cso", name: "<img src=x onerror=alert(1)>", summary: "<script>alert(1)</script>", operations: ["cso_search_tables"] }]
    }] } } } });
  });
  await page.goto("/");
  await expect(page.locator(".source-card h4")).toHaveText("<img src=x onerror=alert(1)>");
  await expect(page.locator(".source-card p").first()).toHaveText("<script>alert(1)</script>");
  await expect(page.locator(".source-card img, .source-card script")).toHaveCount(0);
});

test("playground preserves arguments and shows RPC errors without automatic retry", async ({ page }) => {
  let received: unknown;
  let attempts = 0;
  await page.route(endpointPattern, async (route) => {
    const body = route.request().postDataJSON();
    if (body.params?.name !== "ireland_call") return route.fallback();
    attempts++;
    received = body.params.arguments;
    await route.fulfill({ status: 429, json: { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "Please retry later." } } });
  });
  await page.goto("/#playground");
  await page.locator(".query-settings summary").click();
  await page.locator("#pg-source").fill(" cso ");
  await page.locator("#pg-operation").fill(" cso_get_data ");
  await page.locator("#pg-args").fill('{"table":"FP001","filters":{"year":["2022"]}}');
  const run = page.getByRole("button", { name: /Run live query/i });
  await run.click();
  await expect(page.locator("#pg-output")).toHaveText("Please retry later.");
  await expect(page.locator("#pg-output")).toHaveClass(/error/);
  await expect(run).toBeEnabled();
  expect(attempts).toBe(1);
  expect(received).toEqual({ source: "cso", operation: "cso_get_data", args: { table: "FP001", filters: { year: ["2022"] } }, limit: 5, max_tokens: 1400 });
});

test("playground retries an interrupted response body with a fresh cold-start deadline", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    let deadline = 0;
    let previousSignal: AbortSignal | null | undefined;
    let attempts = 0;
    AbortSignal.timeout = (milliseconds) => {
      deadline = milliseconds;
      return timeout(milliseconds);
    };
    window.fetch = async (input, init) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      if (body?.params?.name !== "ireland_call") return originalFetch(input, init);
      attempts++;
      document.documentElement.dataset.deadline = String(deadline);
      document.documentElement.dataset.freshDeadline = String(init?.signal !== previousSignal);
      previousSignal = init?.signal;
      if (attempts === 1) {
        return new Response(new ReadableStream({
          start(controller) { controller.error(new TypeError("Network connection lost")); }
        }));
      }
      return originalFetch(input, init);
    };
  });
  await page.goto("/#playground");
  await page.getByRole("button", { name: /Run live query/i }).click();
  await expect(page.locator("#pg-output")).toContainText("Population estimates");
  await expect(page.locator("html")).toHaveAttribute("data-deadline", "30000");
  await expect(page.locator("html")).toHaveAttribute("data-fresh-deadline", "true");
});

test("playground accepts SSE data frames after a keepalive and marks tool errors", async ({ page }) => {
  await page.route(endpointPattern, async (route) => {
    const body = route.request().postDataJSON();
    if (body.params?.name !== "ireland_call") return route.fallback();
    await route.fulfill({
      contentType: "text/event-stream",
      body: `: keepalive\r\n\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\r\n\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "Source unavailable" }] } })}\r\n\r\n`
    });
  });
  await page.goto("/#playground");
  await page.getByRole("button", { name: /Run live query/i }).click();
  await expect(page.locator("#pg-output")).toHaveText("Source unavailable");
  await expect(page.locator("#pg-output")).toHaveClass(/error/);
});

test("clipboard fallback restores focus and does not claim a denied copy succeeded", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new DOMException("Blocked", "NotAllowedError"); } } });
    document.execCommand = (command) => {
      if (command !== "copy") return false;
      const area = document.activeElement as HTMLTextAreaElement;
      document.documentElement.dataset.copied = area.value;
      return true;
    };
  });
  await page.goto("/#install");
  await page.getByRole("tab", { name: "Claude", exact: true }).click();
  const copy = page.getByRole("button", { name: "Copy Config" });
  await copy.click();
  await expect(page.locator("#copy-status")).toHaveText("Copied.");
  expect(await page.locator("html").getAttribute("data-copied")).toBe("claude mcp add --transport http ireland https://mcp.irishopendata.ie/mcp");
  await expect(copy).toBeFocused();
  await expect(page.locator("textarea[readonly]")).toHaveCount(0);
  await page.evaluate(() => { document.execCommand = () => false; });
  await copy.click();
  await expect(page.locator("#copy-status")).toContainText("Copy unavailable.");
  await expect(copy).toBeFocused();
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
