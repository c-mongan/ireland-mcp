import { app, type HttpResponseInit } from "@azure/functions";
import { SERVER_NAME, SERVER_VERSION } from "../gateway/server.js";
import { SECURITY_HEADERS } from "../gateway/securityHeaders.js";
import { reportHandlerError } from "../gateway/telemetry.js";
import { sourceModules } from "../registry.js";
import { siteAliasRedirect } from "./redirect.js";

interface HealthRequest {
  query?: URLSearchParams;
  method?: string;
  url?: string;
  headers?: { get(name: string): string | null };
}

/** Plain liveness by default. `?deep=1` probes every upstream (cached 60s, see deepHealth.ts). */
export async function healthHandler(request?: HealthRequest): Promise<HttpResponseInit> {
  const redirect = siteAliasRedirect(request);
  if (redirect) return redirect;
  const response = await healthResponse(request);
  return request?.method === "HEAD" ? { status: response.status, headers: response.headers } : response;
}

async function healthResponse(request?: HealthRequest): Promise<HttpResponseInit> {
  const deep = request?.query?.get("deep");
  if (deep === "1" || deep === "true") {
    try {
      return await deepHealth();
    } catch (error) {
      reportHandlerError("healthResponse", error);
      return {
        status: 500,
        headers: { ...SECURITY_HEADERS, "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" },
        jsonBody: { error: "Health check failed." }
      };
    }
  }
  return {
    status: 200,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json", "cache-control": "no-store" },
    jsonBody: {
      status: "ok",
      name: SERVER_NAME,
      version: SERVER_VERSION,
      sources: sourceModules.map((module) => module.info.id),
      time: new Date().toISOString()
    }
  };
}

async function deepHealth(): Promise<HttpResponseInit> {
  // Loaded on demand so the plain liveness path stays as small as before.
  const [{ sharedDeepHealth }, { sharedBudgets }] = await Promise.all([
    import("../gateway/deepHealth.js"),
    import("../gateway/upstreamBudget.js")
  ]);
  const report = await sharedDeepHealth().check();
  return {
    status: 200,
    headers: { ...SECURITY_HEADERS, "content-type": "application/json", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" },
    jsonBody: { ...report, name: SERVER_NAME, version: SERVER_VERSION, breakers: sharedBudgets().snapshot() }
  };
}

app.http("healthz", { route: "healthz", methods: ["GET", "HEAD"], authLevel: "anonymous", handler: healthHandler });
