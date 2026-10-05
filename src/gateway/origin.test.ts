import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_ORIGINS, isOriginAllowed, parseAllowedOrigins } from "./origin.js";

describe("isOriginAllowed", () => {
  const allow = DEFAULT_ALLOWED_ORIGINS;

  it("allows the known clients and the landing page", () => {
    for (const origin of [
      "https://claude.ai",
      "https://chatgpt.com",
      "vscode-webview://1a2b3c4d5e",
      "http://localhost",
      "http://localhost:6274",
      "http://127.0.0.1:5173",
      "https://lemon-meadow-03b2b8903.3.azurestaticapps.net",
      "https://irishopendata.ie",
      "https://www.irishopendata.ie",
      "https://irishopendata.com",
      "HTTPS://Claude.AI"
    ]) {
      expect(isOriginAllowed(origin, allow), origin).toBe(true);
    }
  });

  it("rejects everything else, including look-alikes", () => {
    for (const origin of [
      "https://evil.example",
      "https://claude.ai.evil.example",
      "https://evilclaude.ai",
      "http://claude.ai",
      "http://localhost.evil.example",
      "http://localhost:80/path",
      "null",
      ""
    ]) {
      expect(isOriginAllowed(origin, allow), origin).toBe(false);
    }
  });

  it("supports a wildcard host label and an allow-all escape hatch", () => {
    expect(isOriginAllowed("https://preview-1.example.net", ["https://*.example.net"])).toBe(true);
    expect(isOriginAllowed("https://a.b.example.net", ["https://*.example.net"])).toBe(false);
    expect(isOriginAllowed("https://anything.example", ["*"])).toBe(true);
  });
});

describe("parseAllowedOrigins", () => {
  it("uses the defaults when unset and replaces them when set", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(DEFAULT_ALLOWED_ORIGINS);
    expect(parseAllowedOrigins("  ")).toEqual(DEFAULT_ALLOWED_ORIGINS);
    expect(parseAllowedOrigins("https://a.ie, https://b.ie/")).toEqual(["https://a.ie", "https://b.ie"]);
  });

  it("appends to the defaults with a leading +", () => {
    expect(parseAllowedOrigins("+https://extra.ie")).toEqual([...DEFAULT_ALLOWED_ORIGINS, "https://extra.ie"]);
  });
});
