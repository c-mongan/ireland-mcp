import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/analytics-config.json", (route) => route.fulfill({ json: { enabled: false } }));
  await page.route("https://mcp.irishopendata.ie/mcp", (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: { jsonrpc: "2.0", id: request.id, result: { tools: [] } } });
  });
  await page.route("https://raw.githubusercontent.com/**/status.json", (route) => route.abort());
});

test("first-use events require page consent and keep fixed privacy and release properties", async ({ page, context }) => {
  await page.goto("/");
  const requests = await page.evaluate(async () => {
    // @ts-expect-error The browser module is served from the website.
    const { createAnalytics } = await import("/analytics.js");
    const requests: { url: string; credentials: RequestCredentials | undefined; referrerPolicy: ReferrerPolicy | undefined; payload: Record<string, unknown> }[] = [];
    const analytics = createAnalytics({ operations: new Map([["cso", new Set(["cso_search_tables"])]]), fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, credentials: init.credentials, referrerPolicy: init.referrerPolicy, payload: JSON.parse(String(init.body)) });
      return new Response(null);
    } });
    analytics.configure({ enabled: true, token: "test-public-token", host: "https://eu.i.posthog.com", release: "abcdef0123456789" });
    const input = { source: "cso", operation: "cso_search_tables", action: "inspect_raw", query: "private-query", result: "private-result", url: "https://private.example", distinct_id: "private-person", release_commit: "private-release", schema_version: 999, surface: "private-surface", $process_person_profile: true, $geoip_disable: false, $ip: "private-ip" };
    const drain = () => new Promise((resolve) => setTimeout(resolve, 0));
    analytics.capture("ireland_query_started", input);
    analytics.capture("ireland_result_action", input);
    await drain();
    if (requests.length) throw new Error("Events sent before consent");
    analytics.setEnabled(true);
    analytics.capture("ireland_query_started", input);
    await drain();
    for (const action of ["inspect_raw", "open_source", "connect"]) {
      analytics.capture("ireland_result_action", { ...input, action });
      await drain();
    }
    analytics.capture("ireland_result_action", { ...input, action: "private-action" });
    analytics.setEnabled(false);
    analytics.capture("ireland_query_started", input);
    analytics.capture("ireland_result_action", input);
    await drain();
    return requests;
  });
  expect(requests).toHaveLength(4);
  expect(requests.map(({ payload }) => payload.event)).toEqual(["ireland_query_started", "ireland_result_action", "ireland_result_action", "ireland_result_action"]);
  const fixed = { source: "cso", operation: "cso_search_tables", surface: "web", schema_version: 1, release_commit: "abcdef0123456789", $process_person_profile: false, $geoip_disable: true, $ip: "0.0.0.0" };
  expect(requests[0]!.payload.properties).toEqual(fixed);
  for (const [index, action] of ["inspect_raw", "open_source", "connect"].entries()) {
    expect(requests[index + 1]!.payload.properties).toEqual({ ...fixed, action });
    expect(requests[index + 1]!.payload.distinct_id).toBe(requests[0]!.payload.distinct_id);
  }
  for (const request of requests) {
    expect(request).toMatchObject({ url: "https://eu.i.posthog.com/i/v0/e/", credentials: "omit", referrerPolicy: "no-referrer" });
  }
  expect(JSON.stringify(requests)).not.toContain("private");
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

for (const setting of ["doNotTrack", "globalPrivacyControl"] as const) {
  test(`first-use events stop if ${setting} changes after consent`, async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async (property) => {
      // @ts-expect-error The browser module is served from the website.
      const { createAnalytics } = await import("/analytics.js");
      const sent: unknown[] = [];
      const analytics = createAnalytics({ operations: new Map([["cso", new Set(["cso_search_tables"])]]), fetch: async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response(null); } });
      analytics.configure({ enabled: true, token: "test", host: "https://eu.i.posthog.com" });
      const accepted = analytics.setEnabled(true);
      Object.defineProperty(navigator, property, { configurable: true, value: property === "doNotTrack" ? "1" : true });
      analytics.capture("ireland_query_started", { source: "cso", operation: "cso_search_tables" });
      analytics.capture("ireland_result_action", { source: "cso", operation: "cso_search_tables", action: "connect" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { accepted, acceptedAgain: analytics.setEnabled(true), sent };
    }, setting);
    expect(result).toEqual({ accepted: true, acceptedAgain: false, sent: [] });
  });
}
