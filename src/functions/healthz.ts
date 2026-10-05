import { app, type HttpResponseInit } from "@azure/functions";
import { SERVER_NAME, SERVER_VERSION } from "../gateway/server.js";
import { sourceModules } from "../registry.js";

export async function healthHandler(): Promise<HttpResponseInit> {
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

app.http("healthz", { route: "healthz", methods: ["GET"], authLevel: "anonymous", handler: healthHandler });
