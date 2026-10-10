import { expect, test } from "@playwright/test";

test("pending queries reject duplicate submits and recover after a manual retry", async ({ page }) => {
  const errors: string[] = [];
  const unexpectedExternalRequests: string[] = [];
  const calls: unknown[] = [];
  let releaseFailure = () => {};
  const pendingFailure = new Promise<void>((resolve) => { releaseFailure = resolve; });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") {
      if (url.pathname === "/analytics-config.json") {
        await route.fulfill({ json: { enabled: false } });
      } else {
        await route.continue();
      }
      return;
    }
    if (url.href === "https://raw.githubusercontent.com/c-mongan/ireland-mcp/status/status/status.json") {
      await route.fulfill({ json: { checked_at: new Date().toISOString(), status: "ok", sources: [] } });
      return;
    }
    if (url.href !== "https://mcp.irishopendata.ie/mcp") {
      unexpectedExternalRequests.push(url.href);
      await route.abort();
      return;
    }
    const request = route.request().postDataJSON();
    if (request.method === "tools/list") {
      await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: { tools: [] } } });
      return;
    }
    if (request.params?.name === "ireland_catalogue") {
      await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: {
        structuredContent: { domains: [{ domain: "stats", sources: [{
          id: "cso", name: "CSO", summary: "Sample official statistics", operations: ["cso_search_tables"]
        }] }] }
      } } });
      return;
    }
    if (request.params?.name !== "ireland_call") throw new Error("Unexpected MCP request in local fixture");
    calls.push(request.params.arguments);
    if (calls.length === 1) {
      await pendingFailure;
      await route.fulfill({ status: 503, json: { jsonrpc: "2.0", id: request.id,
        error: { code: -32000, message: "The source is temporarily unavailable." } } });
    } else {
      await route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: {
        structuredContent: { data: { items: [{ id: "sample-population", label: "Sample population table" }] },
          source: "CSO PxStat", licence: "CC BY 4.0", retrieved_at: "2026-01-01T12:00:00Z" }
      } } });
    }
  });

  try {
    await page.goto("/#playground");
    await expect(page.locator("#analytics-toggle")).toBeDisabled();
    const sample = page.locator('[data-example-index="0"]');
    await sample.focus();
    await sample.press("Enter");
    await expect(page.locator("#example-select")).toBeFocused();
    await page.locator(".query-settings summary").click();
    const argumentsInput = page.locator("#pg-args");
    const args = { query: "population", limit: 3 };
    await argumentsInput.fill(JSON.stringify(args));
    const run = page.getByRole("button", { name: /Run live query/i });
    const output = page.locator("#pg-output");
    const status = page.locator("#pg-status");
    await run.click();
    await expect(run).toBeDisabled();
    await expect(status).toHaveText("Running…");
    await expect.poll(() => calls.length).toBe(1);

    await page.locator("#pg-operation").press("Enter");
    // Exercise the handler's re-entry guard as well as the disabled native submit.
    await page.locator("#playground-form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(calls).toHaveLength(1);
    releaseFailure();
    await expect(output).toHaveText("The source is temporarily unavailable.");
    await expect(output).toHaveClass(/error/);
    await expect(status).toHaveText("Query failed. You can try again.");
    await expect(run).toBeEnabled();
    expect(calls).toHaveLength(1);
    await expect(argumentsInput).toHaveValue(JSON.stringify(args));

    await run.click();
    await expect(output).toContainText("Sample population table");
    await expect(output).toContainText('"source": "CSO PxStat"');
    await expect(output).toContainText('"licence": "CC BY 4.0"');
    await expect(output).toContainText('"retrieved_at": "2026-01-01T12:00:00Z"');
    await expect(output).not.toHaveClass(/error/);
    await page.locator("#pg-raw-details summary").click();
    await expect(output).toHaveAccessibleName("Live response");
    await expect(status).toHaveText(/^Response received · \d[\d,]* ms$/);
    await expect(run).toBeEnabled();
    const expectedCall = { source: "cso", operation: "cso_search_tables", args, limit: 5, max_tokens: 1400 };
    expect(calls).toEqual([expectedCall, expectedCall]);
    expect(unexpectedExternalRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    releaseFailure();
  }
});
