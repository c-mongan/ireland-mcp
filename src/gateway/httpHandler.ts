import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clientKey, RateLimiter } from "./rateLimit.js";

export interface McpHttpOptions {
  createServer: () => McpServer;
  rateLimiter?: RateLimiter;
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "mcp-session-id, retry-after"
};

/**
 * Stateless Streamable HTTP: every POST gets a fresh server and transport, so any
 * Functions instance can answer any request. Responses are plain JSON, not SSE.
 */
export async function handleMcpHttp(request: Request, options: McpHttpOptions): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") {
    return jsonRpcError(405, -32000, "Method not allowed. This server is stateless: send JSON-RPC over POST.", {
      allow: "POST, OPTIONS"
    });
  }

  if (options.rateLimiter) {
    const verdict = options.rateLimiter.check(clientKey(request.headers));
    if (!verdict.allowed) {
      return jsonRpcError(429, -32029, "RATE_LIMITED: too many requests from this address.", {
        "retry-after": String(verdict.retryAfterSeconds)
      });
    }
  }

  const server = options.createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
    const body = response.body ? await response.text() : null;
    return new Response(body, { status: response.status, headers });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...headers }
  });
}
