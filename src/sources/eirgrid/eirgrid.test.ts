import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { emptyChartRetry, eirgridModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /smartgriddashboard\.com\/api\/chart\/\?.*region=ALL.*areas=demandactual/, file: f("demandactual.json") },
  { match: /smartgriddashboard\.com\/api\/chart\/\?.*region=ALL.*areas=windactual/, file: f("windactual.json") },
  { match: /smartgriddashboard\.com\/api\/chart\/\?.*region=ALL.*areas=co2intensity/, file: f("co2intensity.json") }
];

describe("EirGrid module", () => {
  const retryDelay = emptyChartRetry.delayMs;
  beforeAll(() => { emptyChartRetry.delayMs = 0; });
  afterAll(() => { emptyChartRetry.delayMs = retryDelay; });

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
      wind_share_time: "05-Oct-2026 16:45:00",
      co2_g_per_kwh: 149,
      co2_time: "05-Oct-2026 15:15:00"
    });
    expect(body.attribution).toContain("EirGrid");
  });

  it("computes wind share from the latest interval both series report", async () => {
    const delayedWind = JSON.stringify({ Rows: [
      { EffectiveTime: "05-Oct-2026 16:30:00", FieldName: "WIND_ACTUAL", Region: "ALL", Value: 806 },
      { EffectiveTime: "05-Oct-2026 16:45:00", FieldName: "WIND_ACTUAL", Region: "ALL", Value: null }
    ] });
    const delayed: Route[] = [routes[0]!, { match: /areas=windactual/, body: delayedWind }, routes[2]!];
    const { body } = await callTool(mod, "grid_get_status", { region: "ALL" }, fakeFetch(delayed));
    expect(body.data.demand_time).toBe("05-Oct-2026 16:45:00");
    expect(body.data.wind_time).toBe("05-Oct-2026 16:30:00");
    expect(body.data.wind_share_pct).toBe(14.3);
    expect(body.data.wind_share_time).toBe("05-Oct-2026 16:30:00");
  });

  it("defaults to the whole island", async () => {
    const fetch = fakeFetch(routes);
    const { ok } = await callTool(mod, "grid_get_status", {}, fetch);
    expect(ok).toBe(true);
    expect(fetch.calls).toHaveLength(3);
  });

  it("falls back to yesterday's readings just after midnight, and says so", async () => {
    const now = () => new Date("2026-10-07T23:02:00Z"); // 00:02 on 8 Oct in Dublin
    const empty = '{"Rows":[]}';
    const midnight: Route[] = [
      { match: /dateFrom=08-Oct-2026/, body: empty },
      ...["demandactual", "windactual", "co2intensity"].map((area) => ({ match: new RegExp(`dateFrom=07-Oct-2026.*areas=${area}`), file: f(`${area}.json`) }))
    ];
    const fetch = fakeFetch(midnight);
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, createContext({ fetch, now }));
    expect(ok).toBe(true);
    expect(body.data.demand_mw).toBe(5753);
    expect(body.data.note).toContain("08-Oct-2026");
    expect(JSON.stringify(body)).toContain("dateFrom=07-Oct-2026");
    // Each empty chart for today is retried once before falling back to yesterday.
    expect(fetch.calls).toHaveLength(9);
  });

  it("falls back per series when only some of today's charts have readings", async () => {
    const now = () => new Date("2026-10-26T01:09:00Z"); // 01:09 on 26 Oct in Dublin (after the clocks change)
    const todayWind = JSON.stringify({ Rows: [{ EffectiveTime: "26-Oct-2026 01:00:00", FieldName: "WIND_ACTUAL", Region: "ALL", Value: 2189 }] });
    const routes: Route[] = [
      { match: /dateFrom=26-Oct-2026.*areas=windactual/, body: todayWind },
      { match: /dateFrom=26-Oct-2026/, body: '{"Rows":[]}' },
      ...["demandactual", "windactual", "co2intensity"].map((area) => ({ match: new RegExp(`dateFrom=25-Oct-2026.*areas=${area}`), file: f(`${area}.json`) }))
    ];
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, createContext({ fetch: fakeFetch(routes), now }));
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ demand_mw: 5753, wind_mw: 2189, wind_time: "26-Oct-2026 01:00:00", co2_g_per_kwh: 149 });
    // Wind share must come from one day's matching interval, never today's wind over yesterday's demand.
    expect(body.data.wind_share_time).toBe("05-Oct-2026 16:45:00");
    expect(body.data.note).toContain("26-Oct-2026");
  });

  it("keeps today's readings when only an unneeded part of yesterday fails", async () => {
    const now = () => new Date("2026-10-26T01:09:00Z");
    const routes: Route[] = [
      ...["demandactual", "windactual"].map((area) => ({ match: new RegExp(`dateFrom=26-Oct-2026.*areas=${area}`), file: f(`${area}.json`) })),
      { match: /dateFrom=26-Oct-2026.*areas=co2intensity/, body: '{"Rows":[]}' },
      { match: /dateFrom=25-Oct-2026.*areas=co2intensity/, file: f("co2intensity.json") },
      { match: /dateFrom=25-Oct-2026/, status: 500, body: "down" }
    ];
    const fetch = fakeFetch(routes);
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, createContext({ fetch, now }));
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ demand_mw: 5753, wind_mw: 826, co2_g_per_kwh: 149 });
    // Only the missing CO2 series is fetched for yesterday.
    expect(fetch.calls.filter((call) => call.url.includes("25-Oct-2026"))).toHaveLength(1);
  });

  it("returns null for a series whose fallback read fails, keeping the rest", async () => {
    const now = () => new Date("2026-10-26T01:09:00Z");
    const routes: Route[] = [
      ...["demandactual", "windactual"].map((area) => ({ match: new RegExp(`dateFrom=26-Oct-2026.*areas=${area}`), file: f(`${area}.json`) })),
      { match: /dateFrom=26-Oct-2026.*areas=co2intensity/, body: '{"Rows":[]}' },
      { match: /dateFrom=25-Oct-2026/, status: 500, body: "down" }
    ];
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, createContext({ fetch: fakeFetch(routes), now }));
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ demand_mw: 5753, co2_g_per_kwh: null });
    expect(body.data.note).toContain("No CO2 intensity reading");
    expect(body.data.note).toContain("could not be fetched");
    expect(body.data.note).not.toContain("returned no readings for");
  });

  it("never reports yesterday's wind share without saying so", async () => {
    const now = () => new Date("2026-10-26T01:09:00Z");
    // Today's demand and wind share no interval, and CO2 is empty on both days.
    const demand = JSON.stringify({ Rows: [{ EffectiveTime: "26-Oct-2026 00:45:00", FieldName: "SYSTEM_DEMAND", Region: "ALL", Value: 4100 }] });
    const wind = JSON.stringify({ Rows: [{ EffectiveTime: "26-Oct-2026 01:00:00", FieldName: "WIND_ACTUAL", Region: "ALL", Value: 2189 }] });
    const routes: Route[] = [
      { match: /dateFrom=26-Oct-2026.*areas=demandactual/, body: demand },
      { match: /dateFrom=26-Oct-2026.*areas=windactual/, body: wind },
      { match: /areas=co2intensity/, body: '{"Rows":[]}' },
      ...["demandactual", "windactual"].map((area) => ({ match: new RegExp(`dateFrom=25-Oct-2026.*areas=${area}`), file: f(`${area}.json`) }))
    ];
    const fetch = fakeFetch(routes);
    const { body } = await callTool(mod, "grid_get_status", { region: "ALL" }, createContext({ fetch, now }));
    expect(body.data).toMatchObject({ demand_mw: 4100, wind_mw: 2189, wind_share_pct: null, co2_g_per_kwh: null });
    expect(body.data.note).not.toContain("latest from");
    expect(body.data.note).toContain("No CO2 intensity reading");
    expect(fetch.calls.filter((call) => /25-Oct-2026.*areas=(demand|wind)/.test(call.url))).toHaveLength(0);
  });

  it("reports UPSTREAM_DOWN when the dashboard returns no rows", async () => {
    const empty: Route[] = [{ match: /smartgriddashboard/, body: '{"Rows":[]}' }];
    const { ok, body } = await callTool(mod, "grid_get_status", { region: "ROI" }, fakeFetch(empty));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("UPSTREAM_DOWN");
  });

  describe("empty charts (issue #106)", () => {
    const empty = f("empty-chart.json");
    /** Serves the empty fixture for the first `times` requests matching `pattern`; later routes answer the rest. */
    const emptyFirst = (pattern: RegExp, times: number): Route => {
      let seen = 0;
      return { match: (url) => pattern.test(url) && seen++ < times, file: empty };
    };

    it("retries an empty chart once and uses the second answer", async () => {
      const fetch = fakeFetch([emptyFirst(/areas=demandactual/, 1), ...routes]);
      const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, fetch);
      expect(ok).toBe(true);
      expect(body.data).toMatchObject({ demand_mw: 5753, wind_share_pct: 14.4 });
      expect(body.data.note).toBeUndefined();
      expect(fetch.calls.filter((call) => call.url.includes("areas=demandactual"))).toHaveLength(2);
    });

    it("does not cache an empty chart", async () => {
      const now = () => new Date("2026-10-26T13:30:00Z");
      const fetch = fakeFetch([emptyFirst(/areas=demandactual/, 2), ...routes]);
      const ctx = createContext({ fetch, now });
      // Today's demand is empty twice, so this call falls back to yesterday's and says why.
      const first = await callTool(mod, "grid_get_status", { region: "ALL" }, ctx);
      expect(first.body.data.note).toContain("intermittent EirGrid gap");
      // Within the 5-minute TTL, the next call asks EirGrid again instead of replaying the empty chart.
      const second = await callTool(mod, "grid_get_status", { region: "ALL" }, ctx);
      expect(second.body.data).toMatchObject({ demand_mw: 5753 });
      expect(second.body.data.note).toBeUndefined();
    });

    it("serves the earlier copy of a chart, flagged stale, when a refresh comes back empty", async () => {
      let clock = new Date("2026-10-26T13:00:00Z").getTime();
      const now = () => new Date(clock);
      let emptyNow = false;
      const fetch = fakeFetch([{ match: (url) => emptyNow && /areas=demandactual/.test(url), file: empty }, ...routes]);
      const ctx = createContext({ fetch, now });
      expect((await callTool(mod, "grid_get_status", { region: "ALL" }, ctx)).body.data.demand_mw).toBe(5753);
      clock += 6 * 60_000;
      emptyNow = true;
      const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, ctx);
      expect(ok).toBe(true);
      expect(body.data.demand_mw).toBe(5753);
      expect(body.stale).toBe(true);
    });

    it("explains a series that stays empty on both days instead of silently returning null", async () => {
      const now = () => new Date("2026-10-26T01:30:00Z");
      const fetch = fakeFetch([{ match: /areas=demandactual/, file: empty }, ...["windactual", "co2intensity"].map((area) => ({ match: new RegExp(`areas=${area}`), file: f(`${area}.json`) }))]);
      const { ok, body } = await callTool(mod, "grid_get_status", { region: "ALL" }, createContext({ fetch, now }));
      expect(ok).toBe(true);
      expect(body.data).toMatchObject({ demand_mw: null, wind_mw: 826, co2_g_per_kwh: 149, wind_share_pct: null });
      expect(body.data.note).toContain("No demand reading");
      expect(body.data.note).toContain("not cached");
      // Today's and yesterday's demand charts were each asked twice.
      expect(fetch.calls.filter((call) => call.url.includes("areas=demandactual"))).toHaveLength(4);
    });

    it("treats a chart whose rows are all null as empty", async () => {
      const nullRows = JSON.stringify({ Rows: [{ EffectiveTime: "26-Oct-2026 00:00:00", FieldName: "SYSTEM_DEMAND", Region: "ALL", Value: null }] });
      let served = 0;
      const fetch = fakeFetch([{ match: (url) => /areas=demandactual/.test(url) && served++ === 0, body: nullRows }, ...routes]);
      const { body } = await callTool(mod, "grid_get_status", { region: "ALL" }, fetch);
      expect(body.data.demand_mw).toBe(5753);
      expect(fetch.calls.filter((call) => call.url.includes("areas=demandactual"))).toHaveLength(2);
    });
  });
});
