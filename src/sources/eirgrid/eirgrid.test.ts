import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { eirgridModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /smartgriddashboard\.com\/api\/chart\/\?.*region=ALL.*areas=demandactual/, file: f("demandactual.json") },
  { match: /smartgriddashboard\.com\/api\/chart\/\?.*region=ALL.*areas=windactual/, file: f("windactual.json") },
  { match: /smartgriddashboard\.com\/api\/chart\/\?.*region=ALL.*areas=co2intensity/, file: f("co2intensity.json") }
];

describe("EirGrid module", () => {
  it("returns the latest demand, wind, wind share and CO2 intensity, skipping empty future slots", async () => {
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data).toEqual({
      region: "ALL",
      demand_mw: 5753,
      demand_time: "05-Oct-2026 16:45:00",
      wind_mw: 826,
      wind_time: "05-Oct-2026 16:45:00",
      wind_share_pct: 14.4,
      co2_g_per_kwh: 149,
      co2_time: "05-Oct-2026 15:15:00"
    });
    expect(body.attribution).toContain("EirGrid");
  });

  it("defaults to the whole island", async () => {
    const fetch = fakeFetch(routes);
    const { ok } = await callTool(mod, "grid_get_status", {}, fetch);
    expect(ok).toBe(true);
    expect(fetch.calls).toHaveLength(3);
  });

  it("reports UPSTREAM_DOWN when the dashboard returns no rows", async () => {
    const empty: Route[] = [{ match: /smartgriddashboard/, body: '{"Rows":[]}' }];
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ROI" }, fakeFetch(empty));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
  });
});
