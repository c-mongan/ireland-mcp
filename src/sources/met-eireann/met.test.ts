import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { findStation, metModule as mod, nearestStation } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /^http:\/\/openaccess\.pf\.api\.met\.ie\/metno-wdb2ts\/locationforecast\?lat=53\.3498;long=-6\.2603$/, file: f("forecast-dublin.xml") },
  { match: /observations\/Dublin%20Airport\/today/, file: f("obs-dublin-airport.json") },
  { match: /observations\/Malin-Head\/today/, file: f("obs-dublin-airport.json") },
  { match: /warning_IRELAND\.json/, file: f("warnings-synthetic.json") }
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

  it("lists warnings", async () => {
    const { body } = await callTool(mod, "met_get_warnings", {}, fakeFetch(routes));
    expect(body.data.count).toBe(1);
    expect(body.data.warnings[0]).toMatchObject({ level: "Yellow", type: "Wind", region_codes: ["EI07", "EI16"] });
  });

  it("finds stations by name and nearest location", () => {
    expect(findStation("Roches Point")?.slug).toBe("Roches-Point");
    expect(findStation("Cork Airport")?.name).toBe("Cork");
    expect(nearestStation(51.9, -8.47).name).toBe("Cork");
  });
});
