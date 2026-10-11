import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test', testMatch: 'browser.spec.mjs', fullyParallel: true, timeout: 30000, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  webServer: { command: 'node test/browser-server.mjs', url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 30000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
