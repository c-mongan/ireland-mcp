import { test, expect } from "@playwright/test";

const storageKey = "ireland-mcp-theme";

test.beforeEach(async ({ page }) => {
  await page.route("https://mcp.irishopendata.ie/mcp", (route) => route.abort());
  await page.route("https://raw.githubusercontent.com/**/status.json", (route) => route.abort());
});

for (const scheme of ["light", "dark"] as const) {
  test(`initial theme follows ${scheme} system preference and has an accurate accessible toggle`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    const toggle = page.locator("#theme-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", String(scheme === "dark"));
    await expect(toggle).toHaveAccessibleName(`Switch to ${scheme === "dark" ? "light" : "dark"} mode`);
    await toggle.focus();
    await page.keyboard.press("Space");
    const next = scheme === "dark" ? "light" : "dark";
    await expect(page.locator("html")).toHaveAttribute("data-theme", next);
    await expect(toggle).toHaveAttribute("aria-pressed", String(next === "dark"));
    await expect(toggle).toHaveAccessibleName(`Switch to ${scheme} mode`);
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(next);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", next);
  });
}

test("system theme changes are followed only until a user chooses a theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#theme-toggle").click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("saved preference overrides the system while invalid saved values are ignored", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript((key) => {
    localStorage.setItem(key, location.hash === "#invalid" ? "invalid" : "light");
  }, storageKey);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/#invalid");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("blocked localStorage cannot break theming or other page controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage blocked", "SecurityError"); }
    });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("tab", { name: "Claude", exact: true }).click();
  await expect(page.locator("#install-panel")).toContainText("claude mcp add");
  expect(errors).toEqual([]);
});

test("storage quota failures leave the selected theme rendered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Full", "QuotaExceededError"); };
  });
  await page.goto("/");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-pressed", "true");
});

for (const width of [320, 360]) {
  test(`mobile layouts at ${width}px do not overflow in either theme or any installer`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const tabs = page.getByRole("tab");
    for (const theme of ["light", "dark"]) {
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (let index = 0; index < await tabs.count(); index++) {
        await tabs.nth(index).click();
        await expect.poll(() => page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          viewport: innerWidth
        }))).toMatchObject({ page: width, body: width, viewport: width });
      }
      if (theme === "light") await page.locator("#theme-toggle").click();
    }
  });
}
