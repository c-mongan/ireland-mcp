import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { createContext } from "../gateway/context.js";
import { handleMcpHttp, mcpResponseHeaders } from "../gateway/httpHandler.js";
import { isOriginAllowed, parseAllowedOrigins } from "../gateway/origin.js";
import { initTelemetry } from "../gateway/otel.js";
import { limitFromEnv, RateLimiter } from "../gateway/rateLimit.js";
import { tableStoreFromEnv } from "../gateway/tableStore.js";
import { consoleSink, reportHandlerError } from "../gateway/telemetry.js";
import { sharedBudgets } from "../gateway/upstreamBudget.js";
import { toolsetsFromUrl } from "../gateway/toolsets.js";
import { createAppServer } from "../registry.js";
import { siteAliasRedirect } from "./redirect.js";

const MAX_BODY_BYTES = 256 * 1024;

// No-op unless APPLICATIONINSIGHTS_CONNECTION_STRING is set; never blocks a request.
void initTelemetry();

const store = tableStoreFromEnv();
const context = createContext({ budgets: sharedBudgets(), ...(store ? { store } : {}) });
const rateLimiter = new RateLimiter(limitFromEnv(process.env.RATE_LIMIT_PER_MINUTE));
const allowedOrigins = parseAllowedOrigins(process.env.MCP_ALLOWED_ORIGINS);

export async function mcpHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const redirect = siteAliasRedirect(request);
  if (redirect) return redirect;
  const origin = request.headers.get("origin");
  const headers = mcpResponseHeaders(origin, allowedOrigins);
  try {
    return await handleRequest(request, origin, headers);
  } catch (error) {
    reportHandlerError("mcpHandler", error);
    return {
      status: 500,
      headers,
      jsonBody: { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null }
    };
  }
}

async function handleRequest(request: HttpRequest, origin: string | null, headers: Record<string, string>): Promise<HttpResponseInit> {
  // Reject untrusted browser origins before reading bodies or applying the Function-level size guard.
  if (origin !== null && !isOriginAllowed(origin, allowedOrigins)) {
    return {
      status: 403,
      headers,
      jsonBody: { jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed." }, id: null }
    };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { status: 413, headers, jsonBody: { error: "Request body too large." } };
  const body = request.method === "POST" ? await request.text() : undefined;
  // Count bytes, not UTF-16 characters, so undeclared multibyte bodies cannot exceed the limit.
  if (body && Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return { status: 413, headers, jsonBody: { error: "Request body too large." } };

  const webRequest = new Request(request.url, {
    method: request.method,
    headers: new Headers(Object.fromEntries(request.headers.entries())),
    ...(body !== undefined ? { body } : {})
  });
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
