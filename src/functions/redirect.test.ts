import { describe, expect, it } from "vitest";
import { redirectFor } from "./redirect.js";

describe("custom-domain redirects", () => {
  it.each([
    ["irishopendata.com", "/", "https://irishopendata.ie/"],
    ["www.irishopendata.com", "/install?x=1", "https://irishopendata.ie/install?x=1"],
    ["WWW.IrishOpenData.ie:443", "/docs", "https://irishopendata.ie/docs"],
    ["mcp.irishopendata.ie", "/", "https://irishopendata.ie/"],
    ["mcp.irishopendata.ie", "/?utm_source=newsletter&next=%2Fmcp", "https://irishopendata.ie/?utm_source=newsletter&next=%2Fmcp"]
  ])("sends %s%s to the canonical site", (host, path, location) => {
    expect(redirectFor(host, path)).toEqual({ status: 301, headers: { location, "cache-control": "public, max-age=3600" } });
  });

  it.each(["/anything", "/anything?utm_source=newsletter", "/mcp?next=%2F"])("does not redirect %s on the MCP host", (path) => {
    expect(redirectFor("mcp.irishopendata.ie", path).status).toBe(404);
  });

  it("returns 404 for unknown hosts, so it cannot become an open redirect", () => {
    expect(redirectFor("evil.example", "/").status).toBe(404);
    expect(redirectFor("func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net", "/").status).toBe(404);
  });
});
