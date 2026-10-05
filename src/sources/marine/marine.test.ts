import { describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../../test/helpers/fakeFetch.js";
import { callTool, fixturePath } from "../../../test/helpers/callTool.js";
import { marineModule as mod } from "./index.js";

const f = (name: string) => fixturePath(import.meta.url, name);
const routes: Route[] = [{ match: /erddap\.marine\.ie\/erddap\/tabledap\/IWBNetwork\.csv\?/, file: f("buoys.csv") }];

describe("Marine Institute weather buoys module", () => {
  it("returns the latest reading for each buoy with unit-labelled fields", async () => {
    const { ok, body } = await callTool(mod, "marine_get_buoys", {}, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.buoys.map((b: { id: string }) => b.id)).toEqual(["M2", "M3", "M5", "M6"]);
    expect(body.data.buoys[0]).toEqual({
      id: "M2",
      location: "Irish Sea, east of Lambay",
      time: "2026-10-05T15:00:00Z",
      lat: 53.4836,
      lon: -5.4302,
      wind_speed_kn: 13.3,
      wind_speed_kmh: 24.7,
      gust_kn: 16.1,
      wind_direction_deg: 188,
      wave_height_m: 1.17,
      wave_period_s: 3.9,
      air_temp_c: 16,
      sea_temp_c: 15.1,
      pressure_hpa: 1019.6
    });
    expect(body.attribution).toContain("Marine Institute");
  });

  it("filters to one buoy", async () => {
    const { ok, body } = await callTool(mod, "marine_get_buoys", { buoy: "m6" }, fakeFetch(routes));
    expect(ok).toBe(true);
    expect(body.data.buoys).toHaveLength(1);
    expect(body.data.buoys[0]).toMatchObject({ id: "M6", wave_height_m: 2.23, sea_temp_c: 14.8 });
  });

  it("returns NOT_FOUND for a buoy with no recent data", async () => {
    const { ok, body } = await callTool(mod, "marine_get_buoys", { buoy: "M4" }, fakeFetch(routes));
    expect(ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
