import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";

export const marineInfo: SourceInfo = {
  id: "marine",
  name: "Marine Institute Irish Weather Buoy Network",
  licence: "CC BY 4.0",
  attribution: "Source: Marine Institute, Irish Weather Buoy Network (erddap.marine.ie). Licence: CC BY 4.0.",
  homepage: "https://data.gov.ie/dataset/weather-buoy-network"
};

export const ERDDAP_BASE = "https://erddap.marine.ie/erddap/tabledap/IWBNetwork.csv";

const LOCATIONS: Record<string, string> = {
  M2: "Irish Sea, east of Lambay",
  M3: "Atlantic, southwest of Mizen Head",
  M4: "Donegal Bay",
  M5: "Celtic Sea, south of Hook Head",
  M6: "Atlantic, far west of Galway"
};

const FIELDS = [
  "station_id",
  "time",
  "longitude",
  "latitude",
  "AtmosphericPressure",
  "WindDirection",
  "WindSpeed",
  "Gust",
  "WaveHeight",
  "WavePeriod",
  "AirTemperature",
  "SeaTemperature"
];

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const num = (s: string | undefined, dp: number) => {
  if (s === undefined || s === "" || s === "NaN") return null;
  const n = Number(s);
  return Number.isFinite(n) ? round(n, dp) : null;
};

function latestPerBuoy(csv: string) {
  const [header = "", , ...lines] = csv.trim().split(/\r?\n/);
  const cols = header.split(",");
  const latest = new Map<string, Record<string, string>>();
  for (const line of lines) {
    const values = line.split(",");
    const row = Object.fromEntries(cols.map((c, i) => [c, values[i] ?? ""]));
    const id = row.station_id;
    if (!id) continue;
    const prev = latest.get(id);
    if (!prev || (row.time ?? "") >= (prev.time ?? "")) latest.set(id, row);
  }
  return [...latest.values()].sort((a, b) => (a.station_id ?? "").localeCompare(b.station_id ?? ""));
}

const buoysTool = defineTool({
  name: "marine_get_buoys",
  title: "Live sea conditions from weather buoys",
  description:
    "Latest observations from the Irish Weather Buoy Network (M2–M6): wind speed/gusts, wave height and period, air and sea temperature, pressure. Use for sea state, sailing, surfing or offshore weather questions.",
  inputSchema: {
    buoy: z.string().regex(/^[A-Z]{1,3}\d{1,2}$/i).optional().describe("Optional buoy id, e.g. 'M2' (Irish Sea) or 'M6' (far west Atlantic).")
  },
  handler: async ({ buoy }, ctx) => {
    const since = new Date(Date.now() - 6 * 60 * MINUTE).toISOString().slice(0, 13) + ":00:00Z";
    const url = `${ERDDAP_BASE}?${FIELDS.join("%2C")}&time%3E=${since}`;
    const r = await ctx.cachedText(url, 10 * MINUTE, { label: "Marine Institute buoys" });
    if (!r.value.startsWith("station_id")) throw new ToolError("UPSTREAM_DOWN", "The Marine Institute ERDDAP returned an unexpected format.");
    let rows = latestPerBuoy(r.value);
    if (buoy) {
      rows = rows.filter((row) => row.station_id?.toUpperCase() === buoy.toUpperCase());
      if (!rows.length)
        throw new ToolError("NOT_FOUND", `Buoy ${buoy.toUpperCase()} has no readings in the last 6 hours.`, {
          hint: "Call marine_get_buoys without a buoy to see which buoys are reporting."
        });
    }
    const buoys = rows.map((row) => {
      const kn = num(row.WindSpeed, 3);
      return {
        id: row.station_id,
        location: LOCATIONS[row.station_id ?? ""] ?? null,
        time: row.time,
        lat: num(row.latitude, 6),
        lon: num(row.longitude, 6),
        wind_speed_kn: kn === null ? null : round(kn, 1),
        wind_speed_kmh: kn === null ? null : round(kn * 1.852, 1),
        gust_kn: num(row.Gust, 1),
        wind_direction_deg: num(row.WindDirection, 0),
        wave_height_m: num(row.WaveHeight, 2),
        wave_period_s: num(row.WavePeriod, 1),
        air_temp_c: num(row.AirTemperature, 1),
        sea_temp_c: num(row.SeaTemperature, 1),
        pressure_hpa: num(row.AtmosphericPressure, 1)
      };
    });
    return envelope(marineInfo, { data: { count: buoys.length, buoys }, url, cached: r.cached, stale: r.stale });
  }
});

export const marineModule: SourceModule = {
  info: marineInfo,
  summary: "Sea: live wind, wave and temperature readings from the Marine Institute's offshore weather buoys.",
  tools: [buoysTool]
};
