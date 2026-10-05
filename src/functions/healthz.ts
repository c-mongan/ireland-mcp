import { app, type HttpResponseInit } from "@azure/functions";
import { SERVER_NAME, SERVER_VERSION } from "../gateway/server.js";
import { sourceModules } from "../registry.js";

/** Plain liveness by default. `?deep=1` probes every upstream (cached 60s, see deepHealth.ts). */
export async function healthHandler(request?: { query?: URLSearchParams }): Promise<HttpResponseInit> {
  const deep = request?.query?.get("deep");
  if (deep === "1" || deep === "true") return deepHealth();
  return {
    status: 200,
    headers: { "cache-control": "no-store" },
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
    headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" },
    jsonBody: { ...report, name: SERVER_NAME, version: SERVER_VERSION, breakers: sharedBudgets().snapshot() }
  };
}

app.http("healthz", { route: "healthz", methods: ["GET"], authLevel: "anonymous", handler: healthHandler });
