import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AxeResults } from "axe-core";
import { expect, test } from "@playwright/test";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const sections = ["hero", "installer", "directory", "playground-idle", "playground-loading", "playground-success", "playground-empty", "playground-error", "playground-truncated", "status-healthy", "status-degraded", "status-stale", "status-loading", "status-unreachable"];

for (const section of sections) {
  for (const theme of ["dark", "light"]) {
    test(`${section} in ${theme}`, async ({ page }) => {
      const externalRequests: string[] = [];
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "127.0.0.1") {
          externalRequests.push(url.href);
          await route.abort();
        } else {
          await route.continue();
        }
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/iframe.html?id=ireland-mcp-sections--${section}-${theme}&viewMode=story`);
      const frame = page.frameLocator('iframe[title="Ireland MCP section preview"]');
      await expect(frame.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(frame.locator("html")).toHaveCSS("background-color", theme === "dark" ? "rgb(12, 23, 18)" : "rgb(244, 248, 245)");
      await expect(frame.locator("body > [role=note]")).toContainText("Storybook fixture");
      await expect(frame.locator("main > section")).toBeVisible();
      if (section === "installer") {
        await expect(frame.getByRole("tab", { selected: true })).toHaveText("Copilot CLI");
        await expect(frame.locator("#install-panel")).toContainText("copilot mcp add");
        await expect(frame.locator("#install-panel")).toContainText("https://mcp.irishopendata.ie/mcp");
      }
      if (section === "directory") {
        const subjects = frame.getByRole("navigation", { name: "Source subjects" });
        await expect(subjects.locator("a")).toHaveCount(1);
        await expect(subjects.locator("a")).toHaveText("Statistics");
        await expect(subjects.locator("a")).toBeVisible();
        await expect(frame.locator("#domain-stats")).toHaveText("Statistics");
        await expect(frame.locator(".source-card")).toHaveCount(3);
        await expect(frame.locator(".source-card h4").first()).toBeVisible();
      }
      if (section.startsWith("playground")) {
        await expect(frame.locator(".request-heading h3")).toHaveText("Try a live request");
        await expect(frame.locator("#response-title")).toHaveText("Sample response");
        await expect(frame.locator("#pg-output")).toHaveAccessibleName("Sample response");
        await expect(frame.locator("#pg-output")).not.toBeEmpty();
        await expect(frame.locator("#pg-source")).toHaveValue("cso");
        await expect(frame.locator("#pg-args")).toHaveValue(/population/);
        await expect(frame.locator("button:not(:disabled)")).toHaveCount(0);
        if (section === "playground-error") await expect(frame.locator("#pg-output")).toHaveClass(/error/);
        if (section === "playground-success") await expect(frame.locator("#pg-output")).toContainText("Sample population table");
      }
      if (section === "playground-truncated") {
        await expect(frame.locator("#pg-output")).toContainText('"truncated": true');
        const output = frame.locator("#pg-output");
        await output.focus();
        await expect(output).toBeFocused();
        await output.press("End");
        await expect.poll(() => output.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      }
      if (section === "status-stale") await expect(frame.locator(".status-bad")).toHaveText("Status check is out of date");
      if (section === "status-degraded") {
        await expect(frame.locator(".status-sources")).toContainText("Provider refused access (HTTP 403)");
        await expect(frame.locator(".status-sources")).toContainText("setup needed");
      }
      if (section === "status-unreachable") await expect(frame.locator("#status-card")).toContainText("Status feed unavailable");
      await expect(frame.locator("video, script")).toHaveCount(0);
      // Axe needs timers, which the production preview sandbox blocks. Scan an exact
      // test-only document copy while retaining the original sandbox for UI checks.
      await expect(page.locator('iframe[title="Ireland MCP section preview"]')).toHaveAttribute("sandbox", "allow-same-origin");
      await page.evaluate(() => {
        const preview = document.querySelector<HTMLIFrameElement>('iframe[title="Ireland MCP section preview"]');
        if (!preview) throw new Error("Storybook preview frame did not load");
        const scan = document.createElement("iframe");
        scan.name = "accessibility-scan";
        scan.title = "Accessibility test copy";
        scan.style.cssText = preview.style.cssText;
        scan.srcdoc = preview.srcdoc;
        preview.after(scan);
      });
      await expect(page.frameLocator('iframe[name="accessibility-scan"]').locator("main")).toBeVisible();
      const scanFrame = page.frame({ name: "accessibility-scan" });
      if (!scanFrame) throw new Error("Accessibility test frame did not load");
      await scanFrame.evaluate(axeSource);
      const accessibility = await scanFrame.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        return axe.run("main", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      });
      expect(accessibility.violations).toEqual([]);
      await page.locator('iframe[name="accessibility-scan"]').evaluate((node) => node.remove());
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(frame.locator("html")).toHaveCSS("scroll-behavior", "auto");
      await page.setViewportSize({ width: 360, height: 900 });
      await expect.poll(() => frame.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
      await expect.poll(() => frame.locator("body").evaluate((body) => body.scrollHeight <= body.ownerDocument.documentElement.clientHeight)).toBe(true);
      expect(externalRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

for (const theme of ["dark", "light"]) {
  test(`query settings opens and closes from the keyboard in ${theme}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=ireland-mcp-sections--playground-success-${theme}&viewMode=story`);
    const frame = page.frameLocator('iframe[title="Ireland MCP section preview"]');
    const summary = frame.locator(".query-settings summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(frame.locator("#pg-source")).toBeVisible();
    await summary.press("Space");
    await expect(frame.locator("#pg-source")).toBeHidden();
    await summary.press("Tab");
    await expect(frame.locator("#pg-output")).toBeFocused();
    await expect(frame.locator("#pg-output")).toHaveCSS("outline-style", "solid");
  });
}
