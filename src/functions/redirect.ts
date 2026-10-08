import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";

/** Default canonical docs site. Set CANONICAL_SITE_URL=https://irishopendata.ie once the .ie apex is live. */
export const CANONICAL_SITE = "https://irishopendata.com";
const SITE_HOSTS = ["irishopendata.com", "www.irishopendata.com", "irishopendata.ie", "www.irishopendata.ie"];
const MCP_HOSTS = new Set(["mcp.irishopendata.com", "mcp.irishopendata.ie"]);

/** Accepts only an allow-listed site origin, so a bad setting cannot turn this into an open redirect. */
export function canonicalSite(raw: string | undefined = process.env.CANONICAL_SITE_URL): string {
  const value = raw?.trim().replace(/\/+$/, "").toLowerCase();
  return value && SITE_HOSTS.some((host) => value === `https://${host}`) ? value : CANONICAL_SITE;
}

/** Allow-listed host redirects; anything else is a 404 so this can never act as an open redirect. */
export function redirectFor(host: string, pathAndQuery: string, canonical: string = canonicalSite()): HttpResponseInit {
  const name = host.toLowerCase().replace(/:\d+$/, "");
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;
  const pathname = path.split("?", 1)[0];
  const isAlias = SITE_HOSTS.includes(name) && `https://${name}` !== canonical;
  const target = isAlias || (MCP_HOSTS.has(name) && pathname === "/") ? path : null;
  if (target === null) return { status: 404, jsonBody: { error: "Not found. The MCP endpoint is /mcp." } };
  return { status: 301, headers: { location: `${canonical}${target}`, "cache-control": "public, max-age=3600" } };
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
