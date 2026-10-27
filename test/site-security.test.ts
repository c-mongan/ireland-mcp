import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../web/staticwebapp.config.json", import.meta.url), "utf8"));

describe("Static Web App security configuration", () => {
  it("pins HTTPS and browser security headers without preloading every subdomain", () => {
    expect(config.globalHeaders).toMatchObject({
      "strict-transport-security": "max-age=31536000",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()"
    });
    expect(config.globalHeaders["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("lets the site connect only to origins that its pages use", () => {
    const csp: string = config.globalHeaders["content-security-policy"];
    const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src "))?.split(/\s+/).slice(1);
    expect(connect).toEqual(["'self'", "https://eu.i.posthog.com", "https://us.i.posthog.com", "https://mcp.irishopendata.ie", "https://raw.githubusercontent.com"]);
    expect(csp).not.toMatch(/localhost|127\.0\.0\.1|azurewebsites|irishopendata\.com/);
  });

  it("keeps missing resources as real 404 responses", () => {
    expect(config.responseOverrides["404"]).toEqual({ rewrite: "/404.html", statusCode: 404 });
    expect(config.navigationFallback).toBeUndefined();
  });
});
