import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../src/gateway/http.js";
import { ToolError } from "../src/gateway/errors.js";
import { readFileSync } from "node:fs";
import { createContext } from "../src/gateway/context.js";
import { buildServer } from "../src/gateway/server.js";
import { heritageModule } from "../src/sources/heritage/index.js";
import { marineModule } from "../src/sources/marine/index.js";
import { connectClient } from "./helpers/mcpClient.js";
// @ts-expect-error -- ESM policy script
import { assessSmokeResult, exitCode } from "../scripts/live-sanity-policy.mjs";

afterEach(() => vi.useRealTimers());

describe("provider deadlines and diagnostics", () => {
  it.each([403, 200])("aborts discarded HTTP %s responses even when body cancellation stalls", async (status) => {
    let signal: AbortSignal | null | undefined;
    const client = new HttpClient(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), {
        status, headers: { "content-length": "100" }
      });
    });
    await expect(client.text("https://example.ie/", { maxBytes: 10, retries: 0 })).rejects.toMatchObject({ code: "UPSTREAM_DOWN" });
    expect(signal?.aborted).toBe(true);
  });
  const providers = [
    { module: heritageModule, tool: "heritage_monuments_near", args: { lat: 53.3498, lon: -6.2603, radius_m: 1000, limit: 2 },
      body: JSON.stringify({ features: [{ attributes: { SMRS: "DU018-001", COUNTY: "DUBLIN", MONUMENT_CLASS: "Church", LATITUDE: 53.3498, LONGITUDE: -6.2603 } }] }) },
    { module: marineModule, tool: "marine_get_buoys", args: {}, body: readFileSync(new URL("../src/sources/marine/fixtures/buoys.csv", import.meta.url), "utf8") }
  ];
  it.each(providers)("preserves timeout, recovery and strict payload checks through MCP: $tool", async ({ module, tool, args, body }) => {
    for (const typed of [false, true]) {
      for (const outcome of ["persistent", "recovered", "malformed"] as const) {
        vi.useFakeTimers();
        let calls = 0;
        const ctx = createContext({ fetch: async (_url, init) => {
          calls++;
          if (outcome !== "persistent" && calls === 2) return new Response(outcome === "malformed" ? "bad payload" : body);
          return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
        } });
        const client = await connectClient(buildServer({ modules: [module], context: ctx, ...(typed ? { toolsets: module.info.id } : {}) }));
        try {
          const pending = client.callTool(typed ? { name: tool, arguments: args } : { name: "ireland_call", arguments: { source: module.info.id, operation: tool, args } });
          await vi.advanceTimersByTimeAsync(21_000);
          const assessed = assessSmokeResult(await pending, { source: module.info.id, tool, typed, check: (data: { count: number }) => data.count > 0 });
          expect(assessed.status).toBe(outcome === "persistent" ? "DEGRADED" : outcome === "recovered" ? "PASS" : "FAIL");
          expect(exitCode([assessed])).toBe(outcome === "recovered" ? 0 : 1);
          expect(calls).toBe(2);
        } finally { await client.close(); vi.useRealTimers(); }
      }
    }
  });
  it.each(["ArcGIS", "Marine Institute buoys"])("bounds persistent %s timeouts even when fetch ignores abort", async (label) => {
    vi.useFakeTimers();
    let calls = 0;
    const client = new HttpClient(async () => {
      calls++;
      return new Promise<Response>(() => {});
    }, undefined, { random: () => 1 });
    const settled = client.text("https://example.ie/", { label, timeoutMs: 10 }).catch((error: ToolError) => error.toJSON());
    await vi.advanceTimersByTimeAsync(300);
    expect(await Promise.race([settled, Promise.resolve("still pending")])).toMatchObject({
      error: { upstream_failure: { kind: "timeout", attempts: 2, timeout_ms: 10 } }
    });
    expect(calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers on the existing second attempt after a timeout", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = new HttpClient(async (_url, init) => {
      if (++calls === 2) return new Response("recovered");
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    }, undefined, { random: () => 1 });
    const settled = client.text("https://example.ie/", { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(300);
    expect(await settled).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("distinguishes exhausted network errors from timeouts without exposing transport details", async () => {
    const client = new HttpClient(async () => { throw new Error("secret socket details"); }, undefined, { sleep: async () => {} });
    const error = await client.text("https://example.ie/?key=secret").catch((error: ToolError) => error.toJSON());
    expect(error).toMatchObject({ error: { upstream_failure: { kind: "network", attempts: 2 } } });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("identifies transient HTTP exhaustion but not invalid JSON as a transport outage", async () => {
    const client = new HttpClient(async () => new Response("down", { status: 503 }), undefined, { sleep: async () => {} });
    const error = await client.text("https://example.ie/").catch((error: ToolError) => error.toJSON());
    expect(error).toMatchObject({ error: { upstream_failure: { kind: "http", status: 503, attempts: 2 } } });
    const malformed = new HttpClient(async () => new Response("not JSON"));
    const bad = await malformed.json("https://example.ie/").catch((error: ToolError) => error.toJSON());
    expect(bad).not.toHaveProperty("error.upstream_failure");
  });

  it("bounds slow error bodies and uncooperative cancellation without hiding argument regressions", async () => {
    vi.useFakeTimers();
    const client = new HttpClient(async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }), { status: 400 }));
    const settled = client.text("https://example.ie/", { timeoutMs: 10, retries: 0 }).catch((error: ToolError) => error.toJSON());
    await vi.advanceTimersByTimeAsync(20);
    const error = await Promise.race([settled, Promise.resolve("still pending")]);
    expect(error).toMatchObject({ error: { code: "BAD_ARGS" } });
    expect(error).not.toHaveProperty("error.upstream_failure");
  });
});
