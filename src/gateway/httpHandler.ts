import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { endMcpOperations, startMcpOperations, withOperationContext } from "./mcpTelemetry.js";
import { DEFAULT_ALLOWED_ORIGINS, isOriginAllowed } from "./origin.js";
import { hashedClientKey } from "./privacy.js";
import type { RateLimiter } from "./rateLimit.js";
import { UnknownToolsetError } from "./toolsets.js";

export interface McpHttpOptions {
  /** Builds a fresh server per request; receives the request so it can read `?toolsets=` or `/mcp/x/{source}`. */
  createServer: (request: Request) => McpServer;
  rateLimiter?: RateLimiter;
  /** Browser origins allowed to call the endpoint. Defaults to DEFAULT_ALLOWED_ORIGINS. */
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
}

const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH = 20;

/** Every message in a JSON-RPC batch is charged against the rate limit. Invalid JSON costs 1. */
function countMessages(bodyText: string): number {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    return Array.isArray(parsed) ? Math.max(1, parsed.length) : 1;
  } catch {
    return 1;
  }
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id, retry-after",
  "access-control-max-age": "600"
};

/** Allowed browser origins are echoed (with Vary) rather than answered with "*". */
function corsFor(origin: string | null): Record<string, string> {
  return origin ? { ...CORS_HEADERS, "access-control-allow-origin": origin, vary: "Origin" } : CORS_HEADERS;
}

/**
 * Stateless Streamable HTTP: every POST gets a fresh server and transport, so any
 * Functions instance can answer any request. Responses are plain JSON, not SSE.
 */
export async function handleMcpHttp(request: Request, options: McpHttpOptions): Promise<Response> {
  // MCP 2025-11-25: validate Origin when present. Absent Origin means a non-browser client.
  const origin = request.headers.get("origin");
  if (origin !== null && !isOriginAllowed(origin, options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS)) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed." }, id: null }), {
      status: 403,
      headers: { "content-type": "application/json", vary: "Origin" }
    });
  }
  const cors = corsFor(origin);
  const jsonRpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
    errorResponse(status, code, message, { ...cors, ...headers });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    return jsonRpcError(405, -32000, "Method not allowed. This server is stateless: send JSON-RPC over POST.", {
      allow: "POST, OPTIONS"
    });
  }

  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  if (Number(request.headers.get("content-length") ?? 0) > maxBodyBytes) {
    return jsonRpcError(413, -32600, "Request body too large.");
  }
  const bodyText = await readRequestBody(request, maxBodyBytes);
  if (bodyText === null) return jsonRpcError(413, -32600, "Request body too large.");
  const messageCount = countMessages(bodyText);
  if (messageCount > MAX_BATCH) {
    return jsonRpcError(400, -32600, `Batches are limited to ${MAX_BATCH} messages.`);
  }

  if (options.rateLimiter) {
    // The limiter only ever sees a salted hash of the address; see PRIVACY.md.
    const verdict = options.rateLimiter.check(hashedClientKey(request.headers), messageCount);
    if (!verdict.allowed) {
      return jsonRpcError(429, -32029, "RATE_LIMITED: too many requests from this address.", {
        "retry-after": String(verdict.retryAfterSeconds)
      });
    }
  }

  let server: McpServer;
  try {
    server = options.createServer(request);
  } catch (error) {
    if (error instanceof UnknownToolsetError) return jsonRpcError(400, -32602, error.message);
    throw error;
  }

  const operations = startMcpOperations(bodyText, request.headers);
  let status = 500;
  let body: string | null = null;
  try {
    const response = await withOperationContext(operations, () => serve(server, request, bodyText, cors));
    status = response.status;
    body = response.body;
    return new Response(body, { status, headers: response.headers });
  } finally {
    endMcpOperations(operations, status, body);
  }
}

async function serve(
  server: McpServer,
  request: Request,
  bodyText: string,
  cors: Record<string, string>
): Promise<{ status: number; headers: Headers; body: string | null }> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(
      new Request(request.url, { method: "POST", headers: request.headers, body: bodyText })
    );
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    const body = response.body ? await response.text() : null;
    return { status: response.status, headers, body };
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

function errorResponse(status: number, code: number, message: string, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

/** Bound incoming bytes before decoding or assembling the complete body. */
async function readRequestBody(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return text + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > maxBytes) {
        // Do not wait for a remote peer to acknowledge cancellation.
        void reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
