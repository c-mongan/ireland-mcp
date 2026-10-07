import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";

export const CANONICAL_SITE = "https://irishopendata.ie";
const SITE_ALIASES = new Set(["irishopendata.com", "www.irishopendata.com", "www.irishopendata.ie"]);
const MCP_HOST = "mcp.irishopendata.ie";

/** Allow-listed host redirects; anything else is a 404 so this can never act as an open redirect. */
export function redirectFor(host: string, pathAndQuery: string): HttpResponseInit {
  const name = host.toLowerCase().replace(/:\d+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const pathname = path.split("?", 1)[0];
  const target = SITE_ALIASES.has(name) || (name === MCP_HOST && pathname === "/") ? path : null;
  if (target === null) return { status: 404, jsonBody: { error: "Not found. The MCP endpoint is /mcp." } };
  return { status: 301, headers: { location: `${CANONICAL_SITE}${target}`, "cache-control": "public, max-age=3600" } };
}

app.http("redirect", {
  route: "{*path}",
  methods: ["GET", "HEAD"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest) => {
    const url = new URL(request.url);
    return redirectFor(request.headers.get("host") ?? url.host, `${url.pathname}${url.search}`);
  }
});
