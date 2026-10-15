import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { context, trace } from "@opentelemetry/api";
import { z } from "zod";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { createDatadogRuntime, datadogConfig } from "./datadog.js";
import { createContext } from "./context.js";
import { handleMcpHttp } from "./httpHandler.js";
import { defineTool } from "./module.js";
import { buildServer } from "./server.js";
import { consoleSink } from "./telemetry.js";

describe("Datadog export", () => {
  afterEach(() => { trace.disable(); context.disable(); vi.restoreAllMocks(); });

  it("requires explicit opt-in and an API key", () => {
    expect(datadogConfig({ DD_API_KEY: "test-secret" })).toBeUndefined();
    expect(datadogConfig({ IRELAND_MCP_DATADOG: "on" })).toBeUndefined();
    const config = datadogConfig({ IRELAND_MCP_DATADOG: "on", DD_API_KEY: "test-secret" })!;
    expect(config.endpoint).toBe("https://otlp.datadoghq.com");
    expect(config.headers["dd-api-key"]).toBe("test-secret");
    expect(JSON.stringify(config.resourceAttributes)).not.toContain("test-secret");
  });

  it("rejects untrusted export targets before attaching the key", () => {
    for (const endpoint of ["https://collector.example", "http://127.0.0.1:4318/?token=x", "http://user:pass@localhost:4318"])
      expect(() => datadogConfig({ IRELAND_MCP_DATADOG: "on", DD_API_KEY: "test-secret", IRELAND_MCP_DATADOG_OTLP_ENDPOINT: endpoint })).toThrow();
  });

  it("exports a nested failed request and a correlated error through real OTLP HTTP", async () => {
    const received: Array<{ path: string; key: string | undefined; body: Record<string, unknown> }> = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received.push({ path: req.url!, key: req.headers["dd-api-key"] as string, body: JSON.parse(Buffer.concat(chunks).toString()) });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const runtime = await createDatadogRuntime({ IRELAND_MCP_DATADOG: "on", DD_API_KEY: "test-secret", DD_ENV: "test", IRELAND_MCP_DATADOG_OTLP_ENDPOINT: `http://127.0.0.1:${address.port}` });
    const provider = new NodeTracerProvider({ spanProcessors: [runtime!.spanProcessor], resource: runtime!.resource });
    provider.register();
    try {
      trace.getTracer("azure-sdk-fixture").startSpan("normal cache miss", { attributes: { "url.full": "https://private-cache.invalid/secret-row-key" } }).end();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const ctx = createContext({ fetch: async () => new Response("private upstream body", { status: 503 }) });
      const response = await handleMcpHttp(new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "demo_lookup", arguments: { query: "private caller question" } } })
      }), { createServer: () => buildServer({
        modules: [{ info: { id: "cso", name: "Demo", licence: "test", attribution: "test", homepage: "https://example.ie" }, summary: "fixture", tools: [defineTool({ name: "demo_lookup", title: "Demo", description: "fixture", inputSchema: { query: z.string() }, handler: async () => ctx.cachedJson("https://ws.cso.ie/test?secret=test-secret", 1, { retries: 0 }) })] }],
        context: ctx, toolsets: "all", telemetry: consoleSink
      }) });
      expect((await response.json()).result.isError).toBe(true);
      await runtime!.forceFlush();
      const traces = received.find((r) => r.path === "/v1/traces")!;
      const logs = received.find((r) => r.path === "/v1/logs")!;
      expect(traces.key).toBe("test-secret");
      expect(logs.key).toBe("test-secret");
      const spans = (traces.body.resourceSpans as Array<{ scopeSpans: Array<{ spans: Array<{ name: string; traceId: string; spanId: string; parentSpanId?: string }> }> }>).flatMap((r) => r.scopeSpans.flatMap((s) => s.spans));
      const root = spans.find((s) => s.name === "tools/call demo_lookup")!;
      const child = spans.find((s) => s.name === "upstream cso")!;
      expect(child.traceId).toBe(root.traceId);
      expect(child.parentSpanId).toBe(root.spanId);
      expect(JSON.stringify(logs.body)).toContain(child.traceId);
      expect(JSON.stringify(logs.body)).toContain(root.spanId);
      expect(JSON.stringify(received.map((r) => r.body))).not.toContain("test-secret");
      expect(JSON.stringify(received.map((r) => r.body))).not.toContain("private caller question");
      expect(JSON.stringify(received.map((r) => r.body))).not.toContain("private upstream body");
      expect(JSON.stringify(traces.body)).toContain("exception.stacktrace");
      expect(spans.some((span) => span.name === "normal cache miss")).toBe(false);
      expect(JSON.stringify(traces.body)).not.toContain("private-cache.invalid");
    } finally {
      await provider.shutdown();
      await runtime!.shutdown();
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
    }
  });
});
