import { test, expect } from "@playwright/test";

test("cube completes a full turn in 18 seconds and visits distinct quarter turns", async ({ page }) => {
  const startTime = new Date("2026-10-13T12:00:00Z");
  await page.clock.install({ time: startTime });
  await page.goto("/");
  await expect(page.locator("#ireland-cube")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause cube" })).toBeVisible();
  await page.clock.pauseAt(new Date(startTime.getTime() + 10000));
  // Align with the 25fps draw cadence before comparing the rendered artwork.
  await page.clock.runFor(144);
  const pixels = () => page.locator("#ireland-cube").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const sample = document.createElement("canvas");
    sample.width = 90;
    sample.height = 54;
    const context = sample.getContext("2d")!;
    context.drawImage(canvas, 0, 0, 90, 54);
    return Array.from(context.getImageData(0, 0, 90, 54).data);
  });
  const difference = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length;
  const initial = await pixels();
  const quarters: number[][] = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    await page.clock.runFor(4500);
    quarters.push(await pixels());
  }
  for (const quarter of quarters.slice(0, 3)) expect(difference(initial, quarter)).toBeGreaterThan(4);
  // Allow subpixel rasterization and one frame of phase error, not a partial turn.
  expect(difference(initial, quarters[3])).toBeLessThan(2);
});
