import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { createContext } from "../gateway/context.js";
import { handleMcpHttp } from "../gateway/httpHandler.js";
import { limitFromEnv, RateLimiter } from "../gateway/rateLimit.js";
import { tableStoreFromEnv } from "../gateway/tableStore.js";
import { consoleSink } from "../gateway/telemetry.js";
import { createAppServer } from "../registry.js";

const MAX_BODY_BYTES = 256 * 1024;

const store = tableStoreFromEnv();
const context = createContext(store ? { store } : {});
const rateLimiter = new RateLimiter(limitFromEnv(process.env.RATE_LIMIT_PER_MINUTE));

export async function mcpHandler(request: HttpRequest): Promise<HttpResponseInit> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return { status: 413, jsonBody: { error: "Request body too large." } };
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && body.length > MAX_BODY_BYTES) return { status: 413, jsonBody: { error: "Request body too large." } };

  const webRequest = new Request(request.url, {
    method: request.method,
    headers: new Headers(Object.fromEntries(request.headers.entries())),
    ...(body !== undefined ? { body } : {})
  });
  const response = await handleMcpHttp(webRequest, {
    createServer: () => createAppServer(context, consoleSink),
    rateLimiter
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
