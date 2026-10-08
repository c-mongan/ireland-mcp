import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { createContext } from "../gateway/context.js";
import { handleMcpHttp } from "../gateway/httpHandler.js";
import { parseAllowedOrigins } from "../gateway/origin.js";
import { initTelemetry } from "../gateway/otel.js";
import { limitFromEnv, RateLimiter } from "../gateway/rateLimit.js";
import { tableStoreFromEnv } from "../gateway/tableStore.js";
import { consoleSink } from "../gateway/telemetry.js";
import { sharedBudgets } from "../gateway/upstreamBudget.js";
import { toolsetsFromUrl } from "../gateway/toolsets.js";
import { createAppServer } from "../registry.js";

const MAX_BODY_BYTES = 256 * 1024;

// No-op unless APPLICATIONINSIGHTS_CONNECTION_STRING is set; never blocks a request.
void initTelemetry();

const store = tableStoreFromEnv();
const context = createContext({ budgets: sharedBudgets(), ...(store ? { store } : {}) });
const rateLimiter = new RateLimiter(limitFromEnv(process.env.RATE_LIMIT_PER_MINUTE));
const allowedOrigins = parseAllowedOrigins(process.env.MCP_ALLOWED_ORIGINS);

export async function mcpHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const webRequest = new Request(request.url, {
    method: request.method,
    headers: new Headers(Object.fromEntries(request.headers.entries())),
    ...(request.method === "POST" && request.body ? { body: request.body as unknown as BodyInit, duplex: "half" } : {})
  } as RequestInit & { duplex?: string });
  const response = await handleMcpHttp(webRequest, {
    createServer: (req) => createAppServer(context, consoleSink, toolsetsFromUrl(req.url)),
    rateLimiter,
    allowedOrigins,
    maxBodyBytes: MAX_BODY_BYTES
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text()
  };
}

app.http("mcp", {
  route: "mcp",
  methods: ["POST", "GET", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  handler: mcpHandler
});

/** Typed toolset for one source, e.g. /mcp/x/irish-rail. Same handler; the path is read by toolsetsFromUrl. */
app.http("mcpToolset", {
  route: "mcp/x/{source}",
  methods: ["POST", "GET", "DELETE", "OPTIONS"],
  authLevel: "anonymous",
  handler: mcpHandler
});
