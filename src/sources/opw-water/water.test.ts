import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { opwWaterModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [
  { match: /waterlevel\.ie\/geojson\/latest\/$/, file: f("latest.json") },
  { match: /waterlevel\.ie\/data\/day\/25017_0001\.csv$/, file: f("day-25017_0001.csv") }
];

describe("OPW water levels module", () => {
  it("finds gauging stations by name with their latest level, OD level and water temperature", async () => {
    const { ok, body } = await callTool(mod, "water_find_stations", { query: "ballybofey" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.stations).toEqual([
      {
        ref: "01043",
        name: "Ballybofey",
        lat: 54.799769,
        lon: -7.790749,
        time: "2026-10-05T15:30:00Z",
        level_m: 0.944,
        od_level_m: 14.188,
        water_temp_c: 13.5
      }
    ]);
    expect(body.attribution).toContain("waterlevel.ie");
  });

  it("lists all stations when no query is given", async () => {
    const { ok, body } = await callTool(mod, "water_find_stations", {}, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.stations.map((s: { name: string }) => s.name)).toEqual(["Sandy Mills", "Ballybofey", "Banagher"]);
  });

  it("returns the latest level and a 24-hour summary for a station", async () => {
    const { ok, body } = await callTool(mod, "water_get_level", { station: "Banagher" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.station).toMatchObject({ ref: "25017", name: "Banagher", level_m: 2.114, od_level_m: 32.444, water_temp_c: 15.9 });
    expect(body.data.history).toEqual({
      from: "2026-10-04 15:15",
      to: "2026-10-05 15:15",
      readings: 97,
      min_m: 2.106,
      max_m: 2.118,
      change_m: 0.006
    });
  });

  it("accepts the numeric station reference", async () => {
    const { ok, body } = await callTool(mod, "water_get_level", { station: "0000025017" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.station.name).toBe("Banagher");
  });

  it("returns NOT_FOUND with a hint for an unknown station", async () => {
    const { ok, body } = await callTool(mod, "water_get_level", { station: "Atlantis" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.hint).toContain("water_find_stations");
  });
});
