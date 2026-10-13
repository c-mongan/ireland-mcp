import { test, expect } from "@playwright/test";

test("cube rotates automatically at calm speed, pauses cleanly, and supports pointer drag", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#ireland-cube");
  const pixels = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  await expect(canvas).toBeVisible();
  const pauseButton = page.getByRole("button", { name: "Pause cube" });
  await expect(pauseButton).toBeVisible();
  await expect(pauseButton).toHaveText("Ⅱ");
  await expect(pauseButton).toHaveAttribute("title", "Pause cube");
  const before = await pixels();
  await expect.poll(pixels).not.toBe(before);
  await pauseButton.click();
  const pausedButton = page.getByRole("button", { name: "Rotate cube" });
  await expect(pausedButton).toBeVisible();
  const paused = await pixels();
  await page.waitForTimeout(150);
  expect(await pixels()).toBe(paused);
  // Test pointer drag while paused
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2);
    await page.mouse.up();
    const dragged = await pixels();
    expect(dragged).not.toBe(paused);
  }
  await page.locator('.hero-actions .primary').click();
  await expect(page.getByRole("button", { name: "Run live query" })).toBeInViewport();
});

test("reduced motion uses discrete rotation instead of animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Rotate cube" });
  await expect(button).toBeVisible();
  const canvas = page.locator("#ireland-cube");
  const pixels = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  const before = await pixels();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  const still = await pixels();
  expect(still).not.toBe(before);
  await page.waitForTimeout(150);
  expect(await pixels()).toBe(still);
});

test("cube keyboard rotation pauses motion and offscreen animation stops", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#ireland-cube");
  const pixels = () => canvas.evaluate(el => (el as HTMLCanvasElement).toDataURL());
  await page.getByRole("button", { name: "Pause cube" }).waitFor();
  await canvas.focus();
  await canvas.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Rotate cube" })).toBeVisible();
  const before = await pixels();
  await canvas.press("ArrowLeft");
  expect(await pixels()).not.toBe(before);
  await page.getByRole("button", { name: "Rotate cube" }).click();
  await page.locator("#install").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const offscreen = await pixels();
  await page.waitForTimeout(150);
  expect(await pixels()).toBe(offscreen);
});

test("video thumbnail opens from keyboard and restores focus", async ({ page }) => {
  await page.goto("/");
  const preview = page.getByRole("link", { name: "Play demo video", exact: true });
  await preview.focus();
  await preview.press("Enter");
  await expect(page.locator("#demo-dialog")).toBeVisible();
  await expect(page.locator("#demo-video")).toHaveAttribute("src", "media/chatgpt-demo.mp4");
  await page.getByRole("button", { name: "Close demo", exact: true }).click();
  await expect(preview).toBeFocused();
});
