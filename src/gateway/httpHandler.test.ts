import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { AlwaysOnSampler, BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { z } from "zod";
import { createContext } from "./context.js";
import { envelope } from "./envelope.js";
import { ToolError } from "./errors.js";
import { handleMcpHttp } from "./httpHandler.js";
import { defineTool, type SourceModule } from "./module.js";
import { RateLimiter } from "./rateLimit.js";
import { buildServer } from "./server.js";
import { SECURITY_HEADERS } from "./securityHeaders.js";
import { UnknownToolsetError } from "./toolsets.js";
import { fakeFetch } from "../../test/helpers/fakeFetch.js";

const info = { id: "cso", name: "Demo", licence: "CC BY 4.0", attribution: "Demo", homepage: "https://example.ie" };
const fetch = fakeFetch([{ match: /ws\.cso\.ie/, body: '{"n":1}' }]);
const ctx = createContext({ fetch });
const demo: SourceModule = {
  info,
  summary: "demo",
  tools: [
    defineTool({
      name: "demo_lookup",
      title: "Lookup",
      description: "d",
      inputSchema: { query: z.string(), limit: z.number().optional() },
      handler: async () => {
        const r = await ctx.cachedJson("https://ws.cso.ie/q", 1000);
        return envelope(info, { data: r.value, url: "https://ws.cso.ie/q", cached: r.cached });
      }
    }),
    defineTool({
      name: "demo_down",
      title: "Down",
      description: "d",
      inputSchema: {},
      handler: async () => {
        throw new ToolError("UPSTREAM_DOWN", "nope");
      }
    })
  ]
};
// Typed tools are opt-in since the lean surface; these tests call them directly.
const createServer = () => buildServer({ modules: [demo], context: ctx, toolsets: "all" });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://fn.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      ...headers
    },
    body: JSON.stringify(body)
  });
const SWA = "https://lemon-meadow-03b2b8903.3.azurestaticapps.net";
afterEach(() => vi.restoreAllMocks());

describe("origin validation", () => {
  it("rejects a disallowed Origin with 403 before touching the server", async () => {
    let created = false;
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "https://evil.example" }), {
      createServer: () => {
        created = true;
        return createServer();
      }
    });
    expect(res.status).toBe(403);
    expect(created).toBe(false);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes an allowed browser origin for CORS, including preflight", async () => {
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: SWA }), { createServer });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SWA);
    expect(res.headers.get("vary")).toContain("Origin");
    const preflight = await handleMcpHttp(
      new Request("https://fn/mcp", { method: "OPTIONS", headers: { origin: SWA, "access-control-request-method": "POST" } }),
      { createServer }
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(SWA);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("mcp-protocol-version");
    const blocked = await handleMcpHttp(new Request("https://fn/mcp", { method: "OPTIONS", headers: { origin: "https://evil.example" } }), {
      createServer
    });
    expect(blocked.status).toBe(403);
  });

  it("allows requests without an Origin header (server-to-server clients)", async () => {
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { createServer });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("honours a configured allowlist", async () => {
    const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: SWA }), {
      createServer,
      allowedOrigins: ["https://only.example"]
    });
    expect(res.status).toBe(403);
  });

  it.each(["https://irishopendata.com", "https://www.irishopendata.com", "https://irishopendata.ie", "https://claude.ai", "https://chatgpt.com"])(
    "preserves the existing allowed browser origin %s",
    async (origin) => {
      const res = await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin }), { createServer });
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  );
});

describe("HTTP security headers", () => {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const expectSecurity = (res: Response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(res.headers.get("vary")).toContain("Origin");
  };

  it.each([
    ["success", () => post(body, { origin: SWA }), 200],
    ["notification", () => post({ jsonrpc: "2.0", method: "notifications/initialized" }, { origin: SWA }), 202],
    ["preflight", () => new Request("https://fn/mcp", { method: "OPTIONS", headers: { origin: SWA } }), 204],
    ["method error", () => new Request("https://fn/mcp", { headers: { origin: SWA } }), 405],
    ["declared body limit", () => post(body, { origin: SWA, "content-length": "1000001" }), 413],
    ["actual body limit", () => post("x".repeat(1_000_001), { origin: SWA }), 413],
    ["batch limit", () => post(Array.from({ length: 21 }, () => body), { origin: SWA }), 400],
    ["transport error", () => post(body, { origin: SWA, accept: "text/plain" }), 406]
  ])("adds headers to %s without changing CORS", async (_name, request, status) => {
    const res = await handleMcpHttp(request(), { createServer });
    expect(res.status).toBe(status);
    expectSecurity(res);
    expect(res.headers.get("access-control-allow-origin")).toBe(SWA);
  });

  it.each(["POST", "OPTIONS"])("adds headers to denied %s requests without granting CORS", async (method) => {
    const res = await handleMcpHttp(new Request("https://fn/mcp", { method, headers: { origin: "https://evil.example" } }), { createServer });
    expect(res.status).toBe(403);
    expectSecurity(res);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("preserves rate-limit status and retry-after", async () => {
    const rateLimiter = new RateLimiter(1);
    const options = { createServer, rateLimiter };
    await handleMcpHttp(post(body, { origin: SWA }), options);
    const limited = await handleMcpHttp(post(body, { origin: SWA }), options);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("access-control-allow-origin")).toBe(SWA);
    expectSecurity(limited);
  });

  it("covers toolset errors and unexpected failures without exposing internals", async () => {
    for (const error of [new UnknownToolsetError("Unknown toolset."), new Error("private internal detail")]) {
      const res = await handleMcpHttp(post(body, { origin: SWA }), { createServer: () => { throw error; } });
      expect(res.status).toBe(error instanceof UnknownToolsetError ? 400 : 500);
      expectSecurity(res);
      expect(res.headers.get("access-control-allow-origin")).toBe(SWA);
      expect(await res.text()).not.toContain("private internal detail");
    }
  });

  it("covers transport failures with a sanitized 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleMcpHttp(post(body, { origin: SWA }), {
      createServer: () => {
        const server = createServer();
        server.connect = async () => { throw new Error("private transport detail"); };
        return server;
      }
    });
    expect(res.status).toBe(500);
    expectSecurity(res);
    expect(res.headers.get("access-control-allow-origin")).toBe(SWA);
    expect(await res.text()).not.toContain("private transport detail");
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "handler_error", handler: "handleMcpHttp", errorType: "Error" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private transport detail");
  });
});

describe("request body limits", () => {
  it("stops reading an oversized chunked body before creating a server", async () => {
    let pulls = 0;
    let cancelled = false;
    let created = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 100) controller.enqueue(new Uint8Array(64_000));
        else controller.close();
      },
      cancel() { cancelled = true; }
    });
    const request = new Request("https://fn.example/mcp", {
      method: "POST", body, duplex: "half"
    } as RequestInit & { duplex: string });
    const response = await handleMcpHttp(request, { createServer: () => {
      created = true;
      return createServer();
    } });
    expect(response.status).toBe(413);
    expect(created).toBe(false);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(20);
  });

  it("bounds encoded bytes, including multibyte text without Content-Length", async () => {
    const request = new Request("https://fn.example/mcp", { method: "POST", body: "€".repeat(400_000) });
    const response = await handleMcpHttp(request, { createServer });
    expect(response.status).toBe(413);
  });
});

describe("rate-limit keys", () => {
  it("are hashed so the client address is never stored", async () => {
    const keys: string[] = [];
    class Spy extends RateLimiter {
      override check(key: string, cost?: number) {
        keys.push(key);
        return super.check(key, cost);
      }
    }
    await handleMcpHttp(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { "x-forwarded-for": "198.51.100.23" }), {
      createServer,
      rateLimiter: new Spy(10)
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("198.51.100");
  });
});

describe("OpenTelemetry", () => {
  const spans = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
  const contextManager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
    trace.setGlobalTracerProvider(new BasicTracerProvider({ sampler: new AlwaysOnSampler(), spanProcessors: [new SimpleSpanProcessor(spans)] }));
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  });
  afterAll(() => {
    trace.disable();
    metrics.disable();
    context.disable();
  });
  beforeEach(() => spans.reset());

  const call = (id: number, name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) =>
    handleMcpHttp(post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, headers), { createServer });

  it("names tool spans '{mcp.method.name} {gen_ai.tool.name}' and records argument names, never values", async () => {
    await call(1, "demo_lookup", { query: "very private question", limit: 3 }, { "x-forwarded-for": "198.51.100.23" });
    const server = spans.getFinishedSpans().find((s) => s.name === "tools/call demo_lookup");
    expect(server).toBeDefined();
    expect(server!.attributes).toMatchObject({
      "mcp.method.name": "tools/call",
      "gen_ai.tool.name": "demo_lookup",
      "gen_ai.operation.name": "execute_tool",
      "mcp.protocol.version": "2025-11-25",
      "ireland_mcp.tool.argument_names": ["limit", "query"]
    });
    expect(server!.attributes["error.type"]).toBeUndefined();
    const everything = JSON.stringify(spans.getFinishedSpans().map((s) => s.attributes));
    expect(everything).not.toContain("very private question");
    expect(everything).not.toContain("198.51.100");
  });

  it("adds per-source upstream spans with cache flags under the tool span", async () => {
    await call(2, "demo_lookup", { query: "x" });
    const finished = spans.getFinishedSpans();
    const server = finished.find((s) => s.name === "tools/call demo_lookup")!;
    const upstream = finished.find((s) => s.name === "upstream cso")!;
    expect(upstream.attributes).toMatchObject({ "ireland_mcp.source.id": "cso", "ireland_mcp.cache.hit": true, "ireland_mcp.cache.stale": false });
    expect(upstream.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
  });

  it("records an HTTP client span for cache misses without the URL query", async () => {
    await call(3, "demo_lookup", { query: "x" });
    await ctx.cachedJson("https://ws.cso.ie/q?secret=1", 1000);
    const client = spans.getFinishedSpans().find((s) => s.name === "GET" && s.attributes["server.address"] === "ws.cso.ie");
    expect(client?.attributes).toMatchObject({ "ireland_mcp.source.id": "cso", "http.request.method": "GET" });
    expect(JSON.stringify(client?.attributes)).not.toContain("secret");
  });

  it("sets error.type on tool errors and JSON-RPC errors, and records the session id when present", async () => {
    await call(4, "demo_down", {}, { "mcp-session-id": "sess-1" });
    const failed = spans.getFinishedSpans().find((s) => s.name === "tools/call demo_down")!;
    expect(failed.attributes).toMatchObject({ "error.type": "tool_error", "ireland_mcp.error.code": "UPSTREAM_DOWN", "mcp.session.id": "sess-1" });
    await handleMcpHttp(post({ jsonrpc: "2.0", id: 5, method: "nope/unknown" }), { createServer });
    const unknown = spans.getFinishedSpans().find((s) => s.attributes["mcp.method.name"] === "_OTHER")!;
    expect(unknown.attributes["error.type"]).toBe("-32601");
  });

  it("records the client name and version from initialize", async () => {
    await handleMcpHttp(
      post({ jsonrpc: "2.0", id: 6, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "inspector", version: "0.17" } } }),
      { createServer }
    );
    const init = spans.getFinishedSpans().find((s) => s.name === "initialize")!;
    expect(init.attributes).toMatchObject({ "ireland_mcp.client.name": "inspector", "ireland_mcp.client.version": "0.17" });
  });

  it("records the mcp.server.operation.duration histogram", async () => {
    await call(7, "demo_lookup", { query: "x" });
    await reader.forceFlush();
    const names = metricExporter
      .getMetrics()
      .flatMap((m) => m.scopeMetrics.flatMap((s) => s.metrics.map((x) => x.descriptor.name)));
    expect(names).toContain("mcp.server.operation.duration");
  });
});
