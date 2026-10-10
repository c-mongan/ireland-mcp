import { describe, expect, it } from "vitest";
import { createContext } from "../src/gateway/context.js";
import { buildServer } from "../src/gateway/server.js";
import { ntaModule } from "../src/sources/nta/index.js";
import { fixturePath } from "./helpers/callTool.js";
import { fakeFetch } from "./helpers/fakeFetch.js";
import { connectClient } from "./helpers/mcpClient.js";
// @ts-expect-error -- plain ESM script without type declarations
import { assessSmokeResult, classify, exitCode, KNOWN_FLAKY, ntaSummarySample } from "../scripts/live-sanity-policy.mjs";

type Result = { source: string; tool: string; status: string; ms: number; note: string };
const row = (source: string, status: string, note = ""): Result => ({ source, tool: "t", status, ms: 1, note });
const envelope = { operation: "met_get_warnings", data: { count: 0, warnings: [] }, source: "Met Éireann", url: "https://www.met.ie/", licence: "CC BY 4.0", attribution: "Met Éireann", retrieved_at: "2026-10-07T08:00:00Z", cached: false, truncated: false };
const result = (body: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(body) }], isError });
const sample = { source: "met-eireann", tool: "met_get_warnings", check: (data: { warnings: unknown[] }) => Array.isArray(data.warnings) };

describe("live smoke policy", () => {
  it("checks the envelope and domain contract before the sample predicate", () => {
    expect(assessSmokeResult(result(envelope), sample).status).toBe("PASS");
    for (const body of [{ ...envelope, retrieved_at: "bad date" }, { ...envelope, data: { warnings: [] } }, { ...envelope, operation: "met_get_forecast" }]) {
      const assessed = assessSmokeResult(result(body), sample);
      expect(assessed.status).toBe("FAIL");
      expect(exitCode([assessed])).toBe(1);
    }
    expect(assessSmokeResult(result(envelope), { ...sample, check: () => false }).status).toBe("FAIL");
  });
  it("fails stale successful data instead of reporting live success", () => {
    const assessed = assessSmokeResult(result({ ...envelope, stale: true }), sample);
    expect(assessed.status).toBe("FAIL");
    expect(assessed.note).toContain("Stale");
    expect(exitCode([assessed])).toBe(1);
  });
  it("fails invalid JSON, non-object errors, and partial combined data", () => {
    for (const response of [result(null, true), { content: [{ type: "text", text: "not JSON" }] }]) {
      expect(assessSmokeResult(response, sample).status).toBe("FAIL");
    }
    const combined = { ...envelope, operation: "ireland_snapshot", data: { place: "Galway", population: {}, boundaries: {}, forecast: { error: { code: "UPSTREAM_DOWN" } }, national_warnings: [] } };
    expect(assessSmokeResult(result(combined), { source: "cross", tool: "ireland_snapshot", check: () => true }).status).toBe("FAIL");
  });
  it("supports typed tools without weakening their response checks", () => {
    const body = { ...envelope, operation: undefined };
    expect(assessSmokeResult(result(body), { ...sample, typed: true }).status).toBe("PASS");
    expect(assessSmokeResult(result(body), sample).status).toBe("FAIL");
    expect(assessSmokeResult(result({ ...body, operation: "met_get_forecast" }), { ...sample, typed: true }).status).toBe("FAIL");
  });
  it("only tolerates a marked known provider error, never a wrong successful response", () => {
    const kohesio = { source: "kohesio", tool: "kohesio_search_projects", check: () => true };
    const error = { error: { code: "UPSTREAM_DOWN", message: "Kohesio returned HTTP 403." } };
    expect(assessSmokeResult(result(error, true), kohesio).status).toBe("WARN");
    expect(assessSmokeResult(result(error), kohesio).status).toBe("FAIL");
    expect(assessSmokeResult({ ...result(error, true), _meta: { "ireland/source": "nta" } }, kohesio).status).toBe("FAIL");
    expect(assessSmokeResult(result({ ...error, operation: "kohesio_get_project" }, true), { ...kohesio, typed: true }).status).toBe("FAIL");
    expect(assessSmokeResult(result({ error: { code: "UPSTREAM_DOWN", message: "Kohesio returned HTTP 500." } }, true), kohesio).status).toBe("FAIL");
  });
  it.each([false, true])("accepts the real NTA fixture through a complete MCP round trip (typed=%s)", async (typed) => {
    const fetch = fakeFetch([{ match: /TripUpdates/, file: fixturePath(new URL("../src/sources/nta/nta.test.ts", import.meta.url).href, "tripupdates-synthetic.json") }]);
    const client = await connectClient(buildServer({ modules: [ntaModule], context: createContext({ fetch, env: { NTA_API_KEY: "fixture-key" } }), ...(typed ? { toolsets: "nta" } : {}) }));
    try {
      const call = typed
        ? { name: "nta_get_realtime_summary", arguments: { limit: 3 } }
        : { name: "ireland_call", arguments: { source: "nta", operation: "nta_get_realtime_summary", args: { limit: 3 } } };
      const response = await client.callTool(call);
      const assessed = assessSmokeResult(response, { source: "nta", tool: "nta_get_realtime_summary", check: ntaSummarySample, typed });
      expect(assessed.status).toBe("PASS");
      expect(fetch.calls).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
  it("uses real NTA summary fields and accepts a valid empty feed", () => {
    const base = { ...envelope, operation: "nta_get_realtime_summary", source: "National Transport Authority GTFS-Realtime" };
    const nta = { source: "nta", tool: "nta_get_realtime_summary", check: ntaSummarySample };
    for (const data of [
      { feed_timestamp: "2026-10-05T16:00:00Z", trips: 4, cancelled: 1, added: 1, routes: [] },
      { feed_timestamp: "2026-10-05T16:00:00Z", trips: 0, cancelled: 0, added: 0, routes: [] }
    ]) expect(assessSmokeResult(result({ ...base, data }), nta).status).toBe("PASS");
    for (const data of [{ entities: 4, trip_updates: 4 }, { feed_timestamp: null, trips: 0, cancelled: 0, added: 0, routes: [] }]) {
      expect(assessSmokeResult(result({ ...base, data }), nta).status).toBe("FAIL");
    }
  });
  it("lists Kohesio as known flaky", () => {
    expect(KNOWN_FLAKY.kohesio).toContain("403");
  });

  it("downgrades the known Kohesio HTTP 403 to WARN and keeps the original note", () => {
    const warned = classify(row("kohesio", "FAIL", "UPSTREAM_DOWN: Kohesio returned HTTP 403.")) as Result;
    expect(warned.status).toBe("WARN");
    expect(warned.note).toContain("Kohesio returned HTTP 403.");
    expect(warned.note).toContain("Known flaky");
  });

  it("keeps real failures as FAIL", () => {
    expect(classify(row("kohesio", "FAIL", "")).status).toBe("FAIL");
    expect(classify(row("kohesio", "FAIL", "BAD_ARGS: rejected")).status).toBe("FAIL");
    expect(classify(row("cso", "FAIL", "UPSTREAM_DOWN: CSO returned HTTP 500.")).status).toBe("FAIL");
    expect(classify(row("cso", "PASS")).status).toBe("PASS");
  });

  it.each([
    "UPSTREAM_DOWN: Kohesio returned HTTP 500.",
    "UPSTREAM_DOWN: Kohesio timed out.",
    "UPSTREAM_DOWN: unexpected handler failure",
    "UPSTREAM_DOWN: unexpected schema mentioning HTTP 403",
    "UPSTREAM_DOWN: Kohesio returned HTTP 4030.",
    "BAD_ARGS: Kohesio returned HTTP 403."
  ])("fails unexpected Kohesio failures: %s", (note) => {
    const failure = row("kohesio", "FAIL", note);
    expect(classify(failure)).toBe(failure);
    expect(exitCode([classify(failure)])).toBe(1);
  });

  it("passes with one isolated warning but fails on any FAIL or multiple warnings", () => {
    expect(exitCode([row("cso", "PASS"), row("nta", "SKIP")])).toBe(0);
    expect(exitCode([row("cso", "PASS"), row("kohesio", "WARN")])).toBe(0);
    expect(exitCode([row("cso", "FAIL"), row("kohesio", "WARN")])).toBe(1);
    expect(exitCode([row("kohesio", "WARN"), row("kohesio", "WARN")])).toBe(1);
  });
});
