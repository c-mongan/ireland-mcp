import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { findStation, metModule as mod, nearestStation } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /^http:\/\/openaccess\.pf\.api\.met\.ie\/metno-wdb2ts\/locationforecast\?lat=53\.3498;long=-6\.2603$/, file: f("forecast-dublin.xml") },
  { match: /observations\/Dublin%20Airport\/today/, file: f("obs-dublin-airport.json") },
  { match: /observations\/Malin-Head\/today/, file: f("obs-dublin-airport.json") },
  { match: /^https:\/\/prodapi\.met\.ie\/v2\/warnings\/$/, file: f("warnings-synthetic.json") }
];

describe("Met Éireann module", () => {
  it("parses the hourly point forecast", async () => {
    const { ok, body } = await callTool(mod, "met_get_forecast", { lat: 53.3498, lon: -6.2603, hours: 3 }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.forecast).toHaveLength(3);
    expect(body.data.forecast[0]).toEqual({
      time: "2026-10-05T13:00:00Z",
      temperature_c: 18.3,
      wind_speed_kmh: 16,
      wind_gust_kmh: 39,
      wind_direction: "W",
      humidity_pct: 76,
      pressure_hpa: 1020.5,
      cloud_pct: 99.7,
      precipitation_mm: 0,
      precipitation_probability_pct: 1.5,
      symbol: "Cloud"
    });
    expect(body.truncated).toBe(true);
    expect(body.attribution).toContain("Met Éireann");
    expect(body.licence).toBe("CC BY 4.0");
  });

  it("returns station observations and guards the silent Dublin fallback", async () => {
    const { body } = await callTool(mod, "met_get_observations", { station: "dublin airport" }, fakeFetch(routes));
    expect(body.data.latest).toMatchObject({ time: "2026-10-05T03:00", temperature_c: expect.any(Number), humidity_pct: expect.any(Number) });
    const malin = await callTool(mod, "met_get_observations", { station: "Malin Head" }, fakeFetch(routes));
    expect(malin.body.error.code).toBe("NOT_FOUND");
    const unknown = await callTool(mod, "met_get_observations", { station: "Atlantis" }, fakeFetch(routes));
    expect(unknown.body.error.hint).toContain("Valentia");
  });

  it.each([
    ["12:00", "11:00", "00:00"],
    ["00:00", "11:00", "12:00"],
    ["11:00", "12:00", "00:00"]
  ])("selects the newest station reading regardless of upstream order: %j", async (...times) => {
    // The real observations feed returned newest first on 10 October 2026.
    const { ok, body } = await callTool(mod, "met_get_observations", { station: "Dublin Airport" }, fakeFetch([
      { match: /observations/, body: JSON.stringify(times.map((reportTime) => ({
        name: "Dublin Airport", date: "10-10-2026", reportTime,
        temperature: reportTime === "12:00" ? "12" : "10"
      }))) }
    ]));
    expect(ok).toBe(true);
    expect(body.data.latest).toMatchObject({ time: "2026-10-10T12:00", temperature_c: 12 });
    expect(body.data.observations.map((row: { time: string }) => row.time)).toEqual([
      "2026-10-10T00:00", "2026-10-10T11:00", "2026-10-10T12:00"
    ]);
  });

  it.each([null, { error: "busy" }, [null], [{}], [{ name: "Dublin Airport", date: "bad", reportTime: "09:00" }],
    [{ name: "Dublin Airport", date: "31-02-2026", reportTime: "09:00" }],
    [{ name: "Dublin Airport", date: "07-10-2026", reportTime: "29:99" }],
    [{ name: "Dublin Airport", date: "07-10-2026", reportTime: "09:00", temperature: "broken" }]])(
    "rejects malformed observations before caching: %j", async (payload) => {
      let requests = 0;
      const context = createContext({ fetch: async () => {
        requests += 1;
        return new Response(JSON.stringify(payload));
      } });
      for (let i = 0; i < 2; i += 1) {
        const result = await callTool(mod, "met_get_observations", { station: "Dublin Airport" }, context);
        expect(result.ok).toBe(false);
        expect(result.body.error.code).toBe("UPSTREAM_DOWN");
      }
      expect(requests).toBe(2);
    }
  );

  it("rejects a different station in any observation row", async () => {
    const { ok, body } = await callTool(mod, "met_get_observations", { station: "Dublin Airport" }, fakeFetch([
      { match: /observations/, body: JSON.stringify([
        { name: "Dublin Airport", date: "07-10-2026", reportTime: "09:00" },
        { name: "Cork", date: "07-10-2026", reportTime: "10:00" }
      ]) }
    ]));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("lists warnings", async () => {
    const { body } = await callTool(mod, "met_get_warnings", {}, fakeFetch(routes));
    expect(body.data.count).toBe(2);
    expect(body.data.warnings[0]).toMatchObject({ level: "Yellow", type: "Wind", region_codes: ["EI07", "EI16"] });
  });

  it("returns both land and marine warnings from the official v2 feed", async () => {
    const fetcher = fakeFetch([{ match: /^https:\/\/prodapi\.met\.ie\/v2\/warnings\/$/, body: JSON.stringify({
      warnings: {
        national: [{ id: "land", level: "Orange", type: "Rain", regions: ["EI07"], headline: "Heavy rain", onset: "2026-10-06T23:00:00Z" }],
        // The live feed uses numeric ids (seen 2026-10-07).
        marine: [{ id: 1, level: "Yellow", type: "small-craft", regions: ["EI811"], headline: "Strong winds" }],
        environmental: [], northern_ireland: [], advisories: [], highestMarine: "yellow", smallCraftWarningsOnly: false
      }
    }) }]);
    const { ok, body } = await callTool(mod, "met_get_warnings", {}, fetcher);
    expect(ok).toBe(true);
    expect(body.data.count).toBe(2);
    expect(body.data.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "national", level: "Orange", headline: "Heavy rain", region_codes: ["EI07"], onset: "2026-10-06T23:00:00Z" }),
      expect.objectContaining({ category: "marine", type: "small-craft", headline: "Strong winds", region_codes: ["EI811"] })
    ]));
  });

  it("reports no warnings only when the official categories are empty", async () => {
    const { ok, body } = await callTool(mod, "met_get_warnings", {}, fakeFetch([
      { match: /v2\/warnings/, body: JSON.stringify({ warnings: { national: [], marine: [], environmental: [], northern_ireland: [], advisories: [] } }) }
    ]));
    expect(ok).toBe(true);
    expect(body.data).toMatchObject({ count: 0, warnings: [] });
  });

  it.each([{ error: "maintenance" }, { warnings: { national: "unavailable" } }, { warnings: {} }])(
    "does not report malformed warnings as a clear weather forecast: %j", async (payload) => {
      const { ok, body } = await callTool(mod, "met_get_warnings", {}, fakeFetch([
        { match: /warnings/, body: JSON.stringify(payload) }
      ]));
      expect(ok).toBe(false);
      expect(body.error.code).toBe("UPSTREAM_DOWN");
    }
  );

  it("finds stations by name and nearest location", () => {
    expect(findStation("Roches Point")?.slug).toBe("Roches-Point");
    expect(findStation("Cork Airport")?.name).toBe("Cork");
    expect(nearestStation(51.9, -8.47).name).toBe("Cork");
  });
});
