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
