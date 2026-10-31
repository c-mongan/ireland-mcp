import { describe, expect, it } from "vitest";
import { createContext } from "../src/gateway/context.js";
import { buildServer } from "../src/gateway/server.js";
import { eirgridModule } from "../src/sources/eirgrid/index.js";
import { fakeFetch } from "./helpers/fakeFetch.js";
import { connectClient } from "./helpers/mcpClient.js";
// @ts-expect-error -- plain ESM script without type declarations
import { assessSmokeResult, exitCode, smokeDiagnosticsMarkdown } from "../scripts/live-sanity-policy.mjs";

const sample = { source: "eirgrid", tool: "grid_get_status", check: (data: { demand_mw: number }) => data.demand_mw > 0 };
const envelope = {
  operation: "grid_get_status", source: "EirGrid Smart Grid Dashboard",
  url: "https://www.smartgriddashboard.com/", licence: "Public information", attribution: "EirGrid",
  retrieved_at: "2026-10-28T17:00:00Z", cached: false, truncated: false
};
const result = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify({ ...envelope, data }) }] });

describe("EirGrid smoke failure evidence (issue #154)", () => {
  it.each([false, true])("retains missing-demand evidence through MCP without passing partial data (typed=%s)", async (typed) => {
    // Live observation: demand/CO2 charts have no rows on either day, but wind is available.
    const fetch = fakeFetch([
      { match: /areas=windactual/, body: JSON.stringify({ Rows: [{ Value: 1237, Region: "ALL", EffectiveTime: "28-Oct-2026 17:00:00", FieldName: "WIND_ACTUAL" }] }) },
      { match: /smartgriddashboard/, body: '{"Rows":[]}' }
    ]);
    const client = await connectClient(buildServer({ modules: [eirgridModule], context: createContext({ fetch, now: () => new Date("2026-10-28T17:05:00Z") }), ...(typed ? { toolsets: "eirgrid" } : {}) }));
    try {
      const response = await client.callTool(typed
        ? { name: "grid_get_status", arguments: { region: "ALL" } }
        : { name: "ireland_call", arguments: { source: "eirgrid", operation: "grid_get_status", args: { region: "ALL" } } });
      const assessed = assessSmokeResult(response, { ...sample, typed });
      expect(assessed.status).toBe("FAIL");
      expect(exitCode([assessed])).toBe(1);
      expect(assessed.diagnostics).toMatchObject({ cached: false, data: {
        region: "ALL", demand_mw: null, demand_time: null,
        wind_mw: 1237, wind_time: "28-Oct-2026 17:00:00", co2_g_per_kwh: null
      } });
      expect(assessed.diagnostics.data.note).toContain("No demand or CO2 intensity reading");
      expect(assessed.diagnostics.data.note).toContain("28-Oct-2026 or 27-Oct-2026");
      const markdown = smokeDiagnosticsMarkdown([assessed]);
      expect(markdown).toContain('"demand_mw": null');
      expect(markdown).toContain("28-Oct-2026 or 27-Oct-2026");
    } finally {
      await client.close();
    }
  });

  it.each([null, 0, -1, "5753", undefined])("still fails invalid demand %s and retains the observed value", (demand_mw) => {
    const assessed = assessSmokeResult(result({ region: "ALL", demand_mw }), sample);
    expect(assessed.status).toBe("FAIL");
    expect(exitCode([assessed])).toBe(1);
    expect(assessed.diagnostics.data.demand_mw).toBe(demand_mw);
  });

  it("does not add failure diagnostics to a healthy sample", () => {
    const assessed = assessSmokeResult(result({ region: "ALL", demand_mw: 5753 }), sample);
    expect(assessed.status).toBe("PASS");
    expect(assessed.diagnostics).toBeUndefined();
    expect(smokeDiagnosticsMarkdown([assessed])).toBe("");
  });

  it("bounds diagnostic strings, omits unrelated fields and keeps Markdown fences intact", () => {
    const assessed = assessSmokeResult(result({ region: "ALL", demand_mw: null, note: "```\n" + "x".repeat(5000), unrelated: "not part of the grid status" }), sample);
    expect(assessed.diagnostics.data.note.length).toBeLessThanOrEqual(600);
    expect(assessed.diagnostics.data.unrelated).toBeUndefined();
    const markdown = smokeDiagnosticsMarkdown([assessed]);
    expect(markdown.match(/```/g)).toHaveLength(2);
    expect(markdown.length).toBeLessThan(2000);
    expect(JSON.parse(markdown.split("```json\n")[1].split("\n```")[0])[0].diagnostics.data.note).toContain("```");
  });
});
