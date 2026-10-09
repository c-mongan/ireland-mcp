import { expect, test } from "@playwright/test";

const sections = ["hero", "installer", "directory", "playground-idle", "playground-loading", "playground-success", "playground-empty", "playground-error"];

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
      await expect(frame.locator("body > section")).toBeVisible();
      if (section === "installer") {
        await expect(frame.getByRole("tab", { selected: true })).toHaveText("Copilot CLI");
        await expect(frame.locator("#install-panel")).toContainText("copilot mcp add");
        await expect(frame.locator("#install-panel")).toContainText("https://mcp.irishopendata.ie/mcp");
      }
      if (section === "directory") {
        await expect(frame.locator(".source-card")).toHaveCount(3);
        await expect(frame.locator(".source-card h4").first()).toHaveCSS("font-size", "21.6px");
      }
      if (section.startsWith("playground")) {
        await expect(frame.locator("#pg-output")).not.toBeEmpty();
        await expect(frame.locator("#pg-source")).toHaveValue("cso");
        await expect(frame.locator("#pg-args")).toHaveValue(/population/);
        await expect(frame.getByRole("button")).toBeDisabled();
        if (section === "playground-error") await expect(frame.locator("#pg-output")).toHaveClass(/error/);
        if (section === "playground-success") await expect(frame.locator("#pg-output")).toContainText("Sample population table");
      }
      await page.setViewportSize({ width: 360, height: 900 });
      await expect.poll(() => frame.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).toBe(true);
      await expect.poll(() => frame.locator("body").evaluate((body) => body.scrollHeight <= body.ownerDocument.documentElement.clientHeight)).toBe(true);
      expect(externalRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
