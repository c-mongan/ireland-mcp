import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { createService } from "../../packages/irish-legal-mcp/src/service.mjs";
import { createWebHandler } from "../../packages/irish-legal-mcp/src/server.mjs";
import { legalRepositoryFromEnv, legalGeneratorFromEnv } from "../sources/irish-legal/backend.js";

const webHandlers = new Map<string, ReturnType<typeof createWebHandler>>();
export async function legalChatHandler(request: HttpRequest): Promise<HttpResponseInit> {
  if (process.env.LEGAL_ENABLED !== "true") return { status: 404, jsonBody: { error: "Legal corpus is not enabled." } };
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/legal\/?/, "/");
  const headers = new Headers(Object.fromEntries(request.headers.entries()));
  const declared = Number(headers.get("content-length") ?? 0);
  if (declared > 32 * 1024) return { status: 413, jsonBody: { error: "Request body too large." } };
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && Buffer.byteLength(body) > 32 * 1024) return { status: 413, jsonBody: { error: "Request body too large." } };
  const configuredOrigins = (process.env.LEGAL_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const origins = configuredOrigins.length ? configuredOrigins : process.env.WEBSITE_HOSTNAME ? [`https://${process.env.WEBSITE_HOSTNAME}`] : [url.origin];
  if (!origins.includes(url.origin)) return { status: 403, jsonBody: { error: "Host not allowed." } };
  let webHandler = webHandlers.get(url.origin);
  if (!webHandler) {
    webHandler = createWebHandler(createService(legalRepositoryFromEnv()), { allowedOrigins: origins,
      bearerToken: process.env.LEGAL_BEARER_TOKEN, generate: legalGeneratorFromEnv() });
    webHandlers.set(url.origin, webHandler);
  }
  const result = await webHandler(new Request(new URL(route + url.search, url.origin), { method: request.method, headers, ...(body !== undefined ? { body } : {}) }),
    // Aggregate budget per worker and host. Public client headers are not trusted identities.
    { clientAddress: "azure-worker" });
  let text = await result.text();
  if (route === "/" && result.headers.get("content-type")?.startsWith("text/html")) text = text.replaceAll('href="/styles.css"', 'href="/legal/styles.css"').replaceAll('src="/app.mjs"', 'src="/legal/app.mjs"').replaceAll('href="/"', 'href="/legal"');
  return { status: result.status, headers: Object.fromEntries(result.headers), body: text };
}
app.http("legalUi", { route: "legal", methods: ["GET"], authLevel: "anonymous", handler: legalChatHandler });
app.http("legalAssets", { route: "legal/{asset}", methods: ["GET"], authLevel: "anonymous", handler: legalChatHandler });
app.http("legalApi", { route: "legal/api/{operation}", methods: ["GET", "POST"], authLevel: "anonymous", handler: legalChatHandler });
