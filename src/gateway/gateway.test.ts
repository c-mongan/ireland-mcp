import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TieredCache, type CacheEntry, type PersistentStore } from "./cache.js";
import { createContext } from "./context.js";
import { bound, envelope, MAX_LIMIT } from "./envelope.js";
import { ToolError, toToolError } from "./errors.js";
import { HttpClient } from "./http.js";
import { handleMcpHttp } from "./httpHandler.js";
import { defineTool, type SourceModule } from "./module.js";
import { clientKey, limitFromEnv, RateLimiter } from "./rateLimit.js";
import { buildServer, runTool } from "./server.js";
import { fakeFetch, parseToolText } from "../../test/helpers/fakeFetch.js";

const info = { id: "demo", name: "Demo Source", licence: "CC BY 4.0", attribution: "Demo", homepage: "https://example.ie" };

describe("envelope", () => {
  it("builds the evidence envelope with defaults", () => {
    const at = new Date("2026-10-05T00:00:00Z");
    expect(envelope(info, { data: [1], url: "https://example.ie/x", retrievedAt: at })).toEqual({
      data: [1],
      source: "Demo Source",
      url: "https://example.ie/x",
      licence: "CC BY 4.0",
      attribution: "Demo",
      retrieved_at: "2026-10-05T00:00:00.000Z",
      cached: false,
      truncated: false
    });
  });

  it("marks stale results", () => {
    expect(envelope(info, { data: 1, url: "u", stale: true, cached: true }).stale).toBe(true);
  });

  it("bounds results to the default and maximum limits", () => {
    const items = Array.from({ length: 600 }, (_, i) => i);
    expect(bound(items, undefined).items).toHaveLength(50);
    expect(bound(items, 10_000).items).toHaveLength(MAX_LIMIT);
    expect(bound(items, 0).items).toHaveLength(1);
    expect(bound([1, 2], 5)).toEqual({ items: [1, 2], truncated: false });
  });
});

describe("errors", () => {
  it("serialises without stack traces", () => {
    const json = JSON.stringify(new ToolError("NOT_FOUND", "nope").toJSON());
    expect(json).not.toContain("at ");
    expect(JSON.parse(json).error.code).toBe("NOT_FOUND");
  });

  it("maps unknown errors to UPSTREAM_DOWN and zod errors to BAD_ARGS", () => {
    expect(toToolError(new Error("secret internals")).message).not.toContain("secret");
    const zodError = z.object({ a: z.string() }).safeParse({}).error;
    expect(toToolError(zodError).code).toBe("BAD_ARGS");
    expect(new ToolError("RATE_LIMITED", "x", { retryAfterSeconds: 5 }).toJSON().error.retry_after_seconds).toBe(5);
  });
});

describe("TieredCache", () => {
  it("bounds memory by estimated size and skips oversized entries", async () => {
    const cache = new TieredCache({ maxBytes: 100, maxEntryBytes: 50 });
    let loads = 0;
    const big = async () => (loads += 1, "x".repeat(80));
    await cache.getOrLoad("big", 60_000, big);
    expect((await cache.getOrLoad("big", 60_000, big)).cached).toBe(false);
    expect(loads).toBe(2);
    await cache.getOrLoad("a", 60_000, async () => "y".repeat(40));
    await cache.getOrLoad("b", 60_000, async () => "y".repeat(40));
    await cache.getOrLoad("c", 60_000, async () => "y".repeat(40));
    expect((await cache.getOrLoad("a", 60_000, async () => "reloaded")).value).toBe("reloaded");
  });

  it("serves fresh hits, then stale data when the loader fails", async () => {
    let now = 0;
    const cache = new TieredCache({ now: () => now });
    const first = await cache.getOrLoad("k", 1000, async () => "v1");
    expect(first).toEqual({ value: "v1", cached: false, stale: false });
    expect(await cache.getOrLoad("k", 1000, async () => "v2")).toEqual({ value: "v1", cached: true, stale: false });
    now = 5000;
    const stale = await cache.getOrLoad("k", 1000, async () => {
      throw new ToolError("UPSTREAM_DOWN", "down");
    });
    expect(stale).toEqual({ value: "v1", cached: true, stale: true });
  });

  it("rethrows when nothing is cached", async () => {
    const cache = new TieredCache();
    await expect(cache.getOrLoad("k", 1, async () => Promise.reject(new ToolError("NOT_FOUND", "x")))).rejects.toThrow(
      "x"
    );
  });

  it("collapses concurrent loads into one upstream call (single flight)", async () => {
    const cache = new TieredCache();
    const loader = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 42;
    });
    const results = await Promise.all([1, 2, 3].map(() => cache.getOrLoad("k", 60_000, loader)));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.value)).toEqual([42, 42, 42]);
  });

  it("reads through and writes to the persistent store", async () => {
    const data = new Map<string, CacheEntry>([["p", { value: "persisted", expiresAt: 10_000, storedAt: 0 }]]);
    const store: PersistentStore = {
      get: async (key) => data.get(key),
      set: async (key, entry) => void data.set(key, entry)
    };
    const cache = new TieredCache({ store, now: () => 1 });
    expect((await cache.getOrLoad("p", 1, async () => "fresh")).value).toBe("persisted");
    await cache.getOrLoad("new", 1, async () => "n");
    expect(data.get("new")?.value).toBe("n");
  });

  it("ignores persistent store failures", async () => {
    const store: PersistentStore = {
      get: async () => Promise.reject(new Error("down")),
      set: async () => Promise.reject(new Error("down"))
    };
    const cache = new TieredCache({ store });
    expect((await cache.getOrLoad("k", 1, async () => 1)).value).toBe(1);
  });
});

describe("HttpClient", () => {
  it("parses JSON and sends a user agent", async () => {
    const fetch = fakeFetch([{ match: /ok/, body: '{"a":1}' }]);
    expect(await new HttpClient(fetch).json("https://x.ie/ok")).toEqual({ a: 1 });
    expect(String((fetch.calls[0]?.init?.headers as Record<string, string>)["user-agent"])).toContain("ireland-mcp");
  });

  it.each([
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [400, "BAD_ARGS"],
    [503, "UPSTREAM_DOWN"]
  ])("maps HTTP %i to %s", async (status, code) => {
    const fetch = fakeFetch([{ match: /./, status, body: "x", headers: { "retry-after": "7" } }]);
    await expect(new HttpClient(fetch).text("https://x.ie/")).rejects.toMatchObject({ code });
  });

  it("retries once on upstream failure", async () => {
    let calls = 0;
    const client = new HttpClient(async () => {
      calls += 1;
      return calls === 1 ? new Response("", { status: 502 }) : new Response("ok");
    });
    expect(await client.text("https://x.ie/")).toBe("ok");
    expect(calls).toBe(2);
  });

  it("maps network errors and oversized bodies to UPSTREAM_DOWN", async () => {
    const failing = new HttpClient(async () => Promise.reject(new Error("ECONNRESET")));
    await expect(failing.text("https://x.ie/", { retries: 0 })).rejects.toMatchObject({ code: "UPSTREAM_DOWN" });
    const big = new HttpClient(async () => new Response("x".repeat(100)));
    await expect(big.text("https://x.ie/", { maxBytes: 10, retries: 0 })).rejects.toMatchObject({
      code: "UPSTREAM_DOWN"
    });
    const declared = new HttpClient(async () => new Response("x", { headers: { "content-length": "999" } }));
    await expect(declared.text("https://x.ie/", { maxBytes: 10, retries: 0 })).rejects.toThrow("bound");
  });

  it("stops streaming chunked oversized bodies without content-length and does not retry", async () => {
    let calls = 0;
    let pulled = 0;
    let cancelled = false;
    const client = new HttpClient(async () => {
      calls += 1;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(4));
        },
        cancel() {
          cancelled = true;
        }
      });
      return new Response(stream);
    });
    await expect(client.bytes("https://x.ie/", { maxBytes: 10 })).rejects.toThrow("bound");
    expect(calls).toBe(1);
    expect(pulled).toBeLessThan(10);
    expect(cancelled).toBe(true);
  });

  it("applies the timeout while reading a slow body and wraps body errors", async () => {
    const slow = new HttpClient(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1));
        }
      });
      return new Response(stream);
    });
    await expect(slow.text("https://x.ie/", { timeoutMs: 20, retries: 0 })).rejects.toMatchObject({
      code: "UPSTREAM_DOWN",
      message: expect.stringContaining("did not respond")
    });
    const broken = new HttpClient(async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("socket hang up"));
        }
      });
      return new Response(stream);
    });
    await expect(broken.text("https://x.ie/", { retries: 0 })).rejects.toMatchObject({ code: "UPSTREAM_DOWN" });
  });

  it("rejects invalid JSON", async () => {
    const client = new HttpClient(async () => new Response("<html>"));
    await expect(client.json("https://x.ie/")).rejects.toThrow("not valid JSON");
  });

  it("times out slow upstreams", async () => {
    const client = new HttpClient(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );
    await expect(client.text("https://x.ie/", { timeoutMs: 5, retries: 0 })).rejects.toThrow("did not respond");
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window then blocks with retry-after", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    const blocked = limiter.check("a");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(limiter.check("b").allowed).toBe(true);
    now = 60_000;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("derives the client key from forwarding headers", () => {
    // Only the right-most hop is appended by Azure's front end; earlier entries are client-supplied.
    expect(clientKey(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4:5678" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
    expect(clientKey(new Headers({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(new Headers())).toBe("unknown");
    expect(limitFromEnv(undefined)).toBe(60);
    expect(limitFromEnv("120")).toBe(120);
    expect(limitFromEnv("lots")).toBe(60);
    expect(limitFromEnv("0")).toBe(60);
  });
});

const echoTool = defineTool({
  name: "demo_echo",
  title: "Echo",
  description: "Echoes",
  inputSchema: { text: z.string() },
  handler: async ({ text }) => envelope(info, { data: text, url: "https://example.ie" })
});
const failTool = defineTool({
  name: "demo_fail",
  title: "Fail",
  description: "Fails",
  inputSchema: {},
  handler: async () => {
    throw new ToolError("NOT_FOUND", "missing");
  }
});
const demoModule: SourceModule = { info, summary: "demo", tools: [echoTool, failTool] };

describe("server", () => {
  it("returns envelopes and typed errors, emitting telemetry", async () => {
    const events: unknown[] = [];
    const ctx = createContext({ fetch: fakeFetch([]) });
    const ok = await runTool(echoTool, "demo", { text: "hi" }, ctx, (e) => events.push(e));
    expect(parseToolText<{ data: string }>(ok).data).toBe("hi");
    const err = await runTool(failTool, "demo", {}, ctx, (e) => events.push(e));
    expect(err.isError).toBe(true);
    expect(parseToolText<{ error: { code: string } }>(err).error.code).toBe("NOT_FOUND");
    expect(events).toHaveLength(2);
  });

  it("rejects duplicate tool names", () => {
    const ctx = createContext({ fetch: fakeFetch([]) });
    expect(() => buildServer({ modules: [demoModule, demoModule], context: ctx })).toThrow("Duplicate");
  });
});

describe("handleMcpHttp", () => {
  const ctx = createContext({ fetch: fakeFetch([]) });
  const createServer = () => buildServer({ modules: [demoModule], context: ctx, toolsets: "demo" });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("https://fn.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body)
    });

  it("initialises, lists tools with read-only annotations and calls a tool", async () => {
    const init = await handleMcpHttp(
      post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }
      }),
      { createServer }
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("access-control-allow-origin")).toBe("*");
    expect((await init.json()).result.serverInfo.name).toBe("ireland-mcp");

    const list = await handleMcpHttp(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-protocol-version": "2025-06-18" }), {
      createServer
    });
    const tools = (await list.json()).result.tools as Array<{ name: string; annotations: Record<string, boolean> }>;
    expect(tools.map((t) => t.name)).toEqual(["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about", "demo_echo", "demo_fail"]);
    expect(tools.every((t) => t.annotations.readOnlyHint && t.annotations.openWorldHint)).toBe(true);

    const call = await handleMcpHttp(
      post(
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo_echo", arguments: { text: "dia duit" } } },
        { "mcp-protocol-version": "2025-06-18" }
      ),
      { createServer }
    );
    const payload = await call.json();
    expect(JSON.parse(payload.result.content[0].text).data).toBe("dia duit");
  });

  it("rate limits per client address", async () => {
    const rateLimiter = new RateLimiter(1);
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    await handleMcpHttp(post(body, { "x-forwarded-for": "9.9.9.9" }), { createServer, rateLimiter });
    const limited = await handleMcpHttp(post(body, { "x-forwarded-for": "9.9.9.9" }), { createServer, rateLimiter });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("charges every message in a JSON-RPC batch against the limit", async () => {
    const rateLimiter = new RateLimiter(2);
    const one = { jsonrpc: "2.0", method: "tools/list" };
    const batch = [1, 2, 3].map((id) => ({ ...one, id }));
    const limited = await handleMcpHttp(post(batch, { "x-forwarded-for": "8.8.8.8" }), { createServer, rateLimiter });
    expect(limited.status).toBe(429);
    const ok = await handleMcpHttp(post({ ...one, id: 4 }, { "x-forwarded-for": "7.7.7.7" }), { createServer, rateLimiter });
    expect(ok.status).toBe(200);
    const huge = Array.from({ length: 21 }, (_, id) => ({ ...one, id }));
    expect((await handleMcpHttp(post(huge), { createServer })).status).toBe(400);
    const padded = post({ ...one, id: 9, params: { pad: "x".repeat(1_000_001) } });
    expect((await handleMcpHttp(padded, { createServer })).status).toBe(413);
  });

  it("answers CORS preflight and rejects GET", async () => {
    expect((await handleMcpHttp(new Request("https://fn/mcp", { method: "OPTIONS" }), { createServer })).status).toBe(204);
    expect((await handleMcpHttp(new Request("https://fn/mcp"), { createServer })).status).toBe(405);
  });
});

describe("createContext", () => {
  it("never caches responses rejected by validate, and falls back to the last good copy", async () => {
    let now = 0;
    let body = '{"ok":true}';
    const fetch = fakeFetch([{ match: () => true, body: "" }]);
    const fetchImpl = Object.assign(async (url: string, init?: RequestInit) => {
      await fetch(url, init);
      return new Response(body);
    }, { calls: fetch.calls });
    const ctx = createContext({ fetch: fetchImpl, now: () => new Date(now) });
    const validate = (v: { ok?: boolean }) => {
      if (!v.ok) throw new ToolError("UPSTREAM_DOWN", "upstream error body");
    };
    expect((await ctx.cachedJson("https://x.ie/v", 1000, { validate })).value).toEqual({ ok: true });
    now = 5000;
    body = '{"error":"busy"}';
    expect(await ctx.cachedJson("https://x.ie/v", 1000, { validate })).toMatchObject({ value: { ok: true }, stale: true });
    await expect(ctx.cachedJson("https://x.ie/other", 1000, { validate })).rejects.toThrow("upstream error body");
    await expect(ctx.cachedJson("https://x.ie/other", 1000, { validate })).rejects.toThrow("upstream error body");
    expect(fetch.calls.filter((c) => c.url.endsWith("other"))).toHaveLength(2);
  });

  it("caches JSON and text by URL", async () => {
    const fetch = fakeFetch([
      { match: /json/, body: '{"n":1}' },
      { match: /text/, body: "hello" }
    ]);
    const ctx = createContext({ fetch });
    await ctx.cachedJson("https://x.ie/json", 1000);
    const again = await ctx.cachedJson<{ n: number }>("https://x.ie/json", 1000);
    expect(again).toEqual({ value: { n: 1 }, cached: true, stale: false });
    expect((await ctx.cachedText("https://x.ie/text", 1000)).value).toBe("hello");
    expect(fetch.calls).toHaveLength(2);
  });
});
