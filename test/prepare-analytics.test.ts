import { describe, expect, it } from "vitest";
// @ts-expect-error Deployment helper uses plain JavaScript.
import { analyticsConfig } from "../scripts/prepare-analytics.mjs";

describe("analytics deployment configuration", () => {
  it("disables capture without both explicit enablement and a token", () => {
    expect(analyticsConfig({})).toEqual({ enabled: false });
    expect(analyticsConfig({ IRELAND_MCP_POSTHOG_KEY: "private-test-value" })).toEqual({ enabled: false });
    expect(analyticsConfig({ IRELAND_MCP_POSTHOG_WEB_ENABLED: "true" })).toEqual({ enabled: false });
  });
  it.each(["https://eu.i.posthog.com", "https://us.i.posthog.com"])("uses the selected official ingestion host %s", (host) => {
    expect(analyticsConfig({ IRELAND_MCP_POSTHOG_WEB_ENABLED: "true", IRELAND_MCP_POSTHOG_KEY: "test-token", IRELAND_MCP_POSTHOG_HOST: host })).toEqual({ enabled: true, token: "test-token", host });
  });
  it("rejects an untrusted endpoint without exposing the token", () => {
    expect(() => analyticsConfig({ IRELAND_MCP_POSTHOG_WEB_ENABLED: "true", IRELAND_MCP_POSTHOG_KEY: "private-test-value", IRELAND_MCP_POSTHOG_HOST: "https://untrusted.example" })).toThrow("Use an official PostHog ingestion host.");
  });
  it("includes only a commit hash for release correlation", () => {
    const env = { IRELAND_MCP_POSTHOG_WEB_ENABLED: "true", IRELAND_MCP_POSTHOG_KEY: "test-token", IRELAND_MCP_POSTHOG_HOST: "https://eu.i.posthog.com" };
    expect(analyticsConfig({ ...env, IRELAND_MCP_RELEASE: "286ea1e" }).release).toBe("286ea1e");
    expect(analyticsConfig({ ...env, IRELAND_MCP_RELEASE: "private user message" }).release).toBeUndefined();
  });
});
