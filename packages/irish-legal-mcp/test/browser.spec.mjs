/* global Element, window */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('citizen question displays quoted evidence, source dates and attribution', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('4 indexed documents');
  await page.getByRole('button', { name: 'Annual leave', exact: true }).click();
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#answer-kind')).toHaveText('Source excerpts');
  await expect(page.locator('#citations blockquote').first()).toContainText('paid annual leave');
  await expect(page.locator('#citations')).toContainText('CC BY 4.0');
  await expect(page.locator('#citations')).toContainText('Publisher update: 2025-08-14');
  await expect(page.getByRole('status')).toContainText('Current law has not been fully verified');
  expect(await page.locator('#citations a').first().getAttribute('href')).toMatch(/^https:\/\/www\.citizensinformation\.ie\//);
  expect(errors).toEqual([]);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter(item => ['critical','serious'].includes(item.impact))).toEqual([]);
});

test('legal research displays exact Act section and retained legal warning', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Legal research', { exact: true }).check();
  await page.getByLabel('Your question').fill('annual leave');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#citations')).toContainText('section 19');
  await expect(page.locator('#citations')).toContainText('Subject to the conditions in this section');
  await expect(page.locator('#warnings')).toContainText('amendments and commencement');
});

test('a historical query with no compatible source version explains the evidence gap', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your question').fill('annual leave');
  await page.getByLabel('Historical source date').fill('2024-01-01');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#citations .citation')).toHaveCount(0);
  await expect(page.locator('#answer')).toContainText('cannot answer');
  await expect(page.locator('#warnings')).toContainText('compatible');
});

test('pending chat freezes every question control and hides the previous answer', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your question').fill('annual leave');
  await page.getByLabel('Historical source date').fill('2025-08-14');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#results')).toBeVisible();

  let release;
  const pendingResponse = new Promise(resolve => { release = resolve; });
  let submitted;
  await page.route('**/api/chat', async route => {
    submitted = route.request().postDataJSON();
    await pendingResponse;
    await route.fulfill({ json: { answer: 'Replacement evidence', generation: 'extractive', warnings: [], citations: [], supporting_quotes: [] } });
  });
  await page.getByRole('button', { name: 'Find evidence' }).click();
  try {
    await expect.poll(() => submitted).toEqual({ question: 'annual leave', mode: 'citizen', as_of: '2025-08-14' });
    const controls = page.locator('#chat-form input, #chat-form textarea, #chat-form button, [data-question]');
    for (const control of await controls.all()) await expect(control).toBeDisabled();
    await expect(page.locator('#results')).toBeHidden();
    await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'true');
  } finally { release(); }
  await expect(page.locator('#answer')).toHaveText('Replacement evidence');
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  for (const control of await page.locator('#chat-form input, #chat-form textarea, #chat-form button, [data-question]').all()) await expect(control).toBeEnabled();
});

test('editing the question, mode, date or example hides evidence for the previous inputs', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your question').fill('annual leave');
  const edits = [
    () => page.getByLabel('Your question').fill('working time'),
    () => page.getByLabel('Legal research', { exact: true }).check(),
    () => page.getByLabel('Historical source date').fill('2024-01-01'),
    () => page.getByRole('button', { name: 'Annual leave', exact: true }).click()
  ];
  for (const edit of edits) {
    await page.getByRole('button', { name: 'Find evidence' }).click();
    await expect(page.locator('#results')).toBeVisible();
    await edit();
    await expect(page.locator('#results')).toBeHidden();
  }
});

test('failed chat hides prior evidence and allows a retry', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your question').fill('annual leave');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#results')).toBeVisible();
  await page.route('**/api/chat', route => route.fulfill({ status: 500, json: { error: 'Unable to retrieve evidence.' } }));
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.getByRole('status')).toHaveText('Unable to retrieve evidence.');
  await expect(page.locator('#results')).toBeHidden();
  for (const control of await page.locator('#chat-form input, #chat-form textarea, #chat-form button, [data-question]').all()) await expect(control).toBeEnabled();
  await page.unroute('**/api/chat');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#results')).toBeVisible();
});

for (const reducedMotion of ['reduce', 'no-preference']) test(`result scrolling respects motion preference: ${reducedMotion}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    Element.prototype.scrollIntoView = function(options) { window.resultScroll = options; };
  });
  await page.goto('/');
  await page.getByLabel('Your question').fill('annual leave');
  await page.getByRole('button', { name: 'Find evidence' }).click();
  await expect(page.locator('#results')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.resultScroll)).toEqual({ behavior: reducedMotion === 'reduce' ? 'auto' : 'smooth', block: 'start' });
});
