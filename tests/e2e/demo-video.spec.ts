import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

async function isolate(page: Page) {
  await page.route("https://raw.githubusercontent.com/**", (route) => route.fulfill({ json: { status: "ok", sources: [] } }));
  await page.route("https://mcp.irishopendata.ie/mcp", (route) => {
    const request = route.request().postDataJSON();
    const result = request.method === "tools/list" ? { tools: [] } : { structuredContent: { domains: [] } };
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result } });
  });
}

test("demo media is lazy and user controlled, with captions and a dated transcript", async ({ page }) => {
  await isolate(page);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/media/rent-demo")) requests.push(request.url()); });
  await page.goto("/");
  const video = page.locator("#demo-video");
  await expect(page.locator("#demo-dialog")).not.toHaveAttribute("open");
  await expect(video).not.toHaveAttribute("src");
  await expect(video).not.toHaveAttribute("poster");
  await expect(video.locator("track")).not.toHaveAttribute("src");
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Watch the 35-second demo" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(video).toHaveAttribute("src", "media/rent-demo.mp4");
  await expect(video).toHaveAttribute("poster", "media/rent-demo-poster.jpg");
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveAttribute("controls");
  await expect(video).not.toHaveAttribute("autoplay");
  expect(await video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  await expect(video.locator("track")).toHaveAttribute("src", "media/rent-demo.vtt");
  await expect(video.locator("track")).toHaveAttribute("kind", "captions");
  await expect(video.locator("track")).toHaveAttribute("srclang", "en");
  await page.getByText("Read the transcript", { exact: true }).click();
  const transcript = page.locator("#demo-transcript");
  await expect(transcript).toContainText("€1,672.57");
  await expect(transcript).toContainText("2025Q4");
  await expect(transcript).toContainText("historical registered-tenancy statistics");
  await expect(transcript).toContainText("not current asking rents");
  await expect(page.locator("#demo-description")).toContainText("10 October 2026");
  await expect(page.getByRole("link", { name: "View CSO table RIQ02" })).toHaveAttribute("href", "https://data.cso.ie/table/RIQ02");
});

test("native keyboard focus stays in the dialog; Escape and Close pause and restore focus", async ({ page }) => {
  await isolate(page);
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Watch the 35-second demo" });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Close demo" })).toBeFocused();
  await page.locator("#demo-video").evaluate((node: HTMLVideoElement) => {
    const original = node.pause.bind(node);
    node.pause = () => { node.dataset.pauseCalls = String(Number(node.dataset.pauseCalls || 0) + 1); original(); };
  });
  await page.locator("#example-select").evaluate((node: HTMLSelectElement) => node.focus());
  await expect(page.getByRole("button", { name: "Close demo" })).toBeFocused();
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    // Native dialogs allow the browser chrome in the Tab cycle, but keep page controls inert.
    expect(await page.evaluate(() => document.activeElement === document.body || document.getElementById("demo-dialog")?.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("#demo-dialog")).not.toHaveAttribute("open");
  await expect(opener).toBeFocused();
  await expect(page.locator("#demo-video")).toHaveAttribute("data-pause-calls", "1");
  await opener.click();
  await page.getByRole("button", { name: "Close demo" }).click();
  await expect(opener).toBeFocused();
  await expect(page.locator("#demo-video")).toHaveAttribute("data-pause-calls", "2");
});

test("Try it live loads the rent request, closes the recording and does not submit", async ({ page }) => {
  await isolate(page);
  let submitted = 0;
  page.on("request", (request) => { if (request.postData()?.includes('"name":"ireland_call"')) submitted++; });
  await page.goto("/");
  await page.getByRole("button", { name: "Watch the 35-second demo" }).click();
  await page.getByRole("link", { name: "Try it live", exact: true }).click();
  await expect(page.locator("#demo-dialog")).not.toHaveAttribute("open");
  await expect(page.locator("#example-select")).toHaveValue("6");
  await expect(page.locator("#example-select")).toBeFocused();
  expect(JSON.parse(await page.locator("#pg-args").inputValue()).table_code).toBe("RIQ02");
  expect(submitted).toBe(0);
});


test("Try it live leaves a pending request unchanged and focuses the playground heading", async ({ page }) => {
  await isolate(page);
  let finish: () => void = () => {};
  const response = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("https://mcp.irishopendata.ie/mcp", async (route) => {
    const request = route.request().postDataJSON();
    if (request.params?.name !== "ireland_call") return route.fallback();
    await response;
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: { structuredContent: { data: [] } } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Run live query" }).click();
  await expect(page.locator("#example-select")).toBeDisabled();
  await page.getByRole("button", { name: "Watch the 35-second demo" }).click();
  await page.getByRole("link", { name: "Try it live", exact: true }).click();
  await expect(page.locator("#demo-dialog")).not.toHaveAttribute("open");
  await expect(page.locator("#example-select")).toHaveValue("0");
  await expect(page.locator("#playground-title")).toBeFocused();
  finish();
  await expect(page.locator("#example-select")).toBeEnabled();
});

for (const theme of ["dark", "light"]) {
  test(`the demo fits 320px in ${theme} mode and has no accessibility violations`, async ({ page }) => {
    await isolate(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    await page.evaluate((mode) => { document.documentElement.dataset.theme = mode; }, theme);
    await page.getByRole("button", { name: "Watch the 35-second demo" }).click();
    await page.getByText("Read the transcript", { exact: true }).click();
    const size = await page.locator("#demo-dialog").evaluate((node) => ({ width: node.scrollWidth, client: node.clientWidth, right: node.getBoundingClientRect().right, height: node.getBoundingClientRect().height }));
    expect(size.width).toBeLessThanOrEqual(size.client + 1);
    expect(size.right).toBeLessThanOrEqual(320);
    expect(size.height).toBeLessThanOrEqual(670);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const results = await new AxeBuilder({ page }).include("#demo-dialog").analyze();
    expect(results.violations).toEqual([]);
  });
}

test("a missing recording leaves a clear error and the transcript available", async ({ page }) => {
  await isolate(page);
  await page.route("**/media/rent-demo.mp4", (route) => route.abort());
  await page.goto("/");
  await page.getByRole("button", { name: "Watch the 35-second demo" }).click();
  await page.locator("#demo-video").evaluate((node: HTMLVideoElement) => node.play().catch(() => {}));
  await expect(page.locator("#demo-media-status")).toContainText("The video could not load");
  await page.getByText("Read the transcript", { exact: true }).click();
  await expect(page.locator("#demo-transcript p").first()).toBeVisible();
});

test("without JavaScript the inline panel has a native player, transcript and source", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/");
  await page.locator("#demo-fallback").click();
  await expect(page.locator("#demo-dialog")).toBeVisible();
  await expect(page.locator("#demo-open")).toBeHidden();
  await expect(page.locator("#demo-dialog noscript video")).toHaveAttribute("controls");
  await expect(page.getByRole("link", { name: "Open the video", exact: true })).toHaveAttribute("href", "media/rent-demo.mp4");
  await page.locator("#demo-transcript summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#demo-transcript p").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "View CSO table RIQ02" })).toBeVisible();
  await context.close();
});

test("the actual recording plays, has captions, and pauses when the dialog closes", async ({ page }) => {
  for (const file of ["rent-demo.mp4", "rent-demo.vtt", "rent-demo-poster.jpg"]) expect(existsSync(resolve(`web/media/${file}`)), `Missing demo asset: ${file}`).toBe(true);
  await isolate(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Watch the 35-second demo" }).click();
  const video = page.locator("#demo-video");
  await video.evaluate((node: HTMLVideoElement) => node.play());
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(0.2);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.textTracks[0]?.cues?.length || 0)).toBeGreaterThan(0);
  expect(await video.evaluate((node: HTMLVideoElement) => node.error)).toBeNull();
  const metadata = await video.evaluate((node: HTMLVideoElement) => ({ duration: node.duration, width: node.videoWidth, height: node.videoHeight, captions: node.textTracks[0].mode, trackReady: node.querySelector("track")?.readyState }));
  expect(metadata.duration).toBeCloseTo(35, 1);
  expect(metadata.width).toBe(1280);
  expect(metadata.height).toBe(720);
  expect(metadata.captions).toBe("showing");
  expect(metadata.trackReady).toBe(2);
  await page.keyboard.press("Escape");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  const stoppedAt = await video.evaluate((node: HTMLVideoElement) => node.currentTime);
  await page.waitForTimeout(300);
  expect(await video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBe(stoppedAt);
});
