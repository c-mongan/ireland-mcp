import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const opwWaterInfo: SourceInfo = {
  id: "opw-water",
  name: "OPW Hydrometric Network (waterlevel.ie)",
  licence: "CC BY 4.0",
  attribution:
    "Contains Irish Public Sector Information licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence (source: waterlevel.ie, provided by the Office of Public Works). Provisional real-time data; see the waterlevel.ie disclaimer.",
  homepage: "https://waterlevel.ie/"
};

export const OPW_BASE = "https://waterlevel.ie";

interface Feature {
  geometry: { coordinates: [number, number] };
  properties: { station_ref: string; station_name: string; sensor_ref: string; datetime: string; value: string };
}

export interface WaterStation {
  ref: string;
  name: string;
  lat: number;
  lon: number;
  time: string | null;
  level_m: number | null;
  od_level_m: number | null;
  water_temp_c: number | null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f'’.]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const shortRef = (ref: string) => ref.replace(/^0+/, "").padStart(5, "0");
const toNum = (s: string | undefined) => {
  const n = Number(s);
  return s === undefined || s === "" || !Number.isFinite(n) ? null : n;
};

export function groupStations(features: Feature[]): WaterStation[] {
  const byRef = new Map<string, WaterStation>();
  for (const { geometry, properties: p } of features) {
    const ref = shortRef(p.station_ref);
    let s = byRef.get(ref);
    if (!s) {
      s = { ref, name: p.station_name, lat: geometry.coordinates[1], lon: geometry.coordinates[0], time: null, level_m: null, od_level_m: null, water_temp_c: null };
      byRef.set(ref, s);
    }
    if (p.sensor_ref === "0001") {
      s.level_m = toNum(p.value);
      s.time = p.datetime;
    } else if (p.sensor_ref === "OD") s.od_level_m = toNum(p.value);
    else if (p.sensor_ref === "0002") s.water_temp_c = toNum(p.value);
  }
  return [...byRef.values()];
}

async function loadStations(ctx: ToolContext) {
  const url = `${OPW_BASE}/geojson/latest/`;
  const r = await ctx.cachedJson<{ features?: Feature[] }>(url, 15 * MINUTE, { label: "OPW water levels" });
  if (!Array.isArray(r.value.features)) throw new ToolError("UPSTREAM_DOWN", "waterlevel.ie returned an unexpected format.");
  return { url, stations: groupStations(r.value.features), cached: r.cached, stale: r.stale };
}

function matchStations(stations: WaterStation[], query: string) {
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 4 && digits.length === query.trim().length) return stations.filter((s) => s.ref === shortRef(digits));
  const q = fold(query);
  const exact = stations.filter((s) => fold(s.name) === q);
  return exact.length ? exact : stations.filter((s) => fold(s.name).includes(q));
}

const findTool = defineTool({
  name: "water_find_stations",
  title: "Find river and lake level stations",
  description:
    "Search the OPW hydrometric network (~460 river/lake gauges) by place or river-station name. Returns each station's latest water level (m above local gauge zero), level above Ordnance Datum and water temperature.",
  inputSchema: {
    query: z.string().min(2).max(60).optional().describe("Station name or part of it, e.g. 'Athlone', 'Banagher', or a 5-digit station ref."),
    limit: z.number().int().min(1).max(100).optional().describe("Max stations to return (default 20).")
  },
  handler: async ({ query, limit }, ctx) => {
    const r = await loadStations(ctx);
    const matches = query ? matchStations(r.stations, query) : r.stations;
    const { items, truncated } = bound(matches, limit);
    return envelope(opwWaterInfo, { data: { count: matches.length, stations: items }, url: r.url, cached: r.cached, stale: r.stale, truncated });
  }
});

const levelTool = defineTool({
  name: "water_get_level",
  title: "River level now and over the last day",
  description:
    "Latest water level at one OPW gauging station plus a summary of the last N hours (min, max, change) — useful for flood or river-condition questions. Levels are provisional.",
  inputSchema: {
    station: z.string().min(2).max(60).describe("Station name (e.g. 'Banagher') or ref (e.g. '25017')."),
    hours: z.number().int().min(1).max(36).default(24).describe("History window in hours (max 36).")
  },
  handler: async ({ station, hours }, ctx) => {
    const r = await loadStations(ctx);
    const [found] = matchStations(r.stations, station);
    if (!found) throw new ToolError("NOT_FOUND", `No OPW gauging station matches '${station}'.`, { hint: "Use water_find_stations to search station names." });
    const url = `${OPW_BASE}/data/day/${found.ref}_0001.csv`;
    const csv = await ctx.cachedText(url, 15 * MINUTE, { label: "OPW station history" });
    const points = csv.value
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => {
        const [time = "", value] = line.split(",");
        return { time: time.trim(), value: toNum(value?.trim()) };
      })
      .filter((p): p is { time: string; value: number } => p.time !== "" && p.value !== null);
    const last = points.at(-1);
    let history = null;
    if (last) {
      const end = Date.parse(`${last.time.replace(" ", "T")}Z`);
      const window = points.filter((p) => Date.parse(`${p.time.replace(" ", "T")}Z`) >= end - hours * 60 * MINUTE);
      const values = window.map((p) => p.value);
      history = {
        from: window[0]?.time ?? last.time,
        to: last.time,
        readings: window.length,
        min_m: Math.min(...values),
        max_m: Math.max(...values),
        change_m: Math.round((last.value - (window[0]?.value ?? last.value)) * 1000) / 1000
      };
    }
    return envelope(opwWaterInfo, {
      data: { station: found, history, note: "Times in the history are UTC. level_m is relative to the local gauge zero, not sea level." },
      url,
      cached: r.cached && csv.cached,
      stale: r.stale || csv.stale
    });
  }
});

export const opwWaterModule: SourceModule = {
  info: opwWaterInfo,
  summary: "Rivers: live water levels and temperatures from ~460 OPW gauging stations (waterlevel.ie).",
  domain: "environment",
  coverage: "About 460 OPW hydrometric stations on waterlevel.ie: latest level and temperature plus the last day of readings.",
  tools: [findTool, levelTool]
};
