import { describe, expect, it } from "vitest";
import { canonicalSite, redirectFor, siteAliasRedirect } from "./redirect.js";
import { SECURITY_HEADERS } from "../gateway/securityHeaders.js";

const moved = (location: string) => ({ status: 301, headers: { ...SECURITY_HEADERS, location, "cache-control": "public, max-age=3600" } });

describe("custom-domain redirects", () => {
  it.each([
    ["www.irishopendata.com", "/install?x=1", "https://irishopendata.com/install?x=1"],
    ["irishopendata.ie", "/", "https://irishopendata.com/"],
    ["WWW.IrishOpenData.ie:443", "/docs", "https://irishopendata.com/docs"],
    ["mcp.irishopendata.com", "/", "https://irishopendata.com/"],
    ["mcp.irishopendata.ie", "/?utm_source=newsletter&next=%2Fmcp", "https://irishopendata.com/?utm_source=newsletter&next=%2Fmcp"]
  ])("sends %s%s to the canonical site", (host, path, location) => {
    expect(redirectFor(host, path)).toEqual(moved(location));
  });

  it("follows a configured .ie canonical and never redirects the canonical host to itself", () => {
    const ie = "https://irishopendata.ie";
    expect(redirectFor("irishopendata.com", "/a?b=1", ie)).toEqual(moved("https://irishopendata.ie/a?b=1"));
    expect(redirectFor("mcp.irishopendata.com", "/", ie)).toEqual(moved("https://irishopendata.ie/"));
    expect(redirectFor("irishopendata.ie", "/", ie).status).toBe(404);
    expect(redirectFor("irishopendata.com", "/").status).toBe(404);
  });

  it("only accepts allow-listed canonical origins", () => {
    expect(canonicalSite(undefined)).toBe("https://irishopendata.com");
    expect(canonicalSite(" https://IrishOpenData.ie/ ")).toBe("https://irishopendata.ie");
    expect(canonicalSite("https://evil.example")).toBe("https://irishopendata.com");
    expect(canonicalSite("http://irishopendata.ie")).toBe("https://irishopendata.com");
  });

  it.each(["/anything", "/anything?utm_source=newsletter", "/mcp?next=%2F"])("does not redirect %s on the MCP hosts", (path) => {
    expect(redirectFor("mcp.irishopendata.com", path).status).toBe(404);
    expect(redirectFor("mcp.irishopendata.ie", path).status).toBe(404);
  });

  it("returns 404 for unknown hosts, so it cannot become an open redirect", () => {
    expect(redirectFor("evil.example", "/").status).toBe(404);
    expect(redirectFor("evil.example", "/").headers).toEqual(SECURITY_HEADERS);
    expect(redirectFor("func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net", "/").status).toBe(404);
  });

  it("checks only allow-listed site aliases before explicit routes and preserves the query", () => {
    expect(siteAliasRedirect({ url: "https://WWW.IRISHOPENDATA.COM:443/mcp?x=1&next=%2Fhealthz" }))
      .toEqual(moved("https://irishopendata.com/mcp?x=1&next=%2Fhealthz"));
    expect(siteAliasRedirect({ url: "https://irishopendata.ie/healthz?deep=1" }))
      .toEqual(moved("https://irishopendata.com/healthz?deep=1"));
    expect(siteAliasRedirect()).toBeUndefined();
  });

  it.each(["evil.example", "www.irishopendata.com.evil.example", "mcp.irishopendata.com", "irishopendata.com", "example.azurewebsites.net"])(
    "does not apply the site-alias guard to %s",
    (host) => expect(siteAliasRedirect({ url: `https://${host}/healthz?deep=1` })).toBeUndefined()
  );
});
