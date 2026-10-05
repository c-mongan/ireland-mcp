import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { assertInIreland } from "../geohive/index.js";

export const metInfo: SourceInfo = {
  id: "met-eireann",
  name: "Met Éireann (Irish national meteorological service)",
  licence: "CC BY 4.0",
  attribution: "Copyright Met Éireann. Source: www.met.ie. Licence: CC BY 4.0. Met Éireann does not accept liability for errors or omissions in the data.",
  homepage: "https://www.met.ie"
};

const TTL = 15 * MINUTE;
// The point-forecast API is only served over plain HTTP (HTTPS returns 404).
export const FORECAST_BASE = "http://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast";
export const OBSERVATIONS_BASE = "https://prodapi.metweb.ie/observations";
export const WARNINGS_URL = "https://www.met.ie/Open_Data/json/warning_IRELAND.json";

export interface Station {
  name: string;
  /** Path segment the observations API recognises; unknown names silently fall back to Dublin Airport. */
  slug: string;
  lat: number;
  lon: number;
}

export const STATIONS: Station[] = [
  { name: "Athenry", slug: "Athenry", lat: 53.289, lon: -8.786 },
  { name: "Ballyhaise", slug: "Ballyhaise", lat: 54.051, lon: -7.31 },
  { name: "Belmullet", slug: "Belmullet", lat: 54.228, lon: -10.007 },
  { name: "Casement", slug: "Casement", lat: 53.306, lon: -6.439 },
  { name: "Claremorris", slug: "Claremorris", lat: 53.711, lon: -8.993 },
  { name: "Cork", slug: "Cork", lat: 51.847, lon: -8.486 },
  { name: "Dublin Airport", slug: "Dublin Airport", lat: 53.428, lon: -6.241 },
  { name: "Dunsany", slug: "Dunsany", lat: 53.516, lon: -6.66 },
  { name: "Finner", slug: "Finner", lat: 54.494, lon: -8.243 },
  { name: "Gurteen", slug: "Gurteen", lat: 53.052, lon: -8.009 },
  { name: "Johnstown Castle", slug: "Johnstown-Castle", lat: 52.298, lon: -6.497 },
  { name: "Knock", slug: "Knock", lat: 53.906, lon: -8.817 },
  { name: "Mace Head", slug: "Mace-Head", lat: 53.326, lon: -9.901 },
  { name: "Malin Head", slug: "Malin-Head", lat: 55.372, lon: -7.339 },
  { name: "Moore Park", slug: "Moore-Park", lat: 52.164, lon: -8.264 },
  { name: "Mullingar", slug: "Mullingar", lat: 53.537, lon: -7.362 },
  { name: "Newport Mayo", slug: "Newport-Furnace", lat: 53.923, lon: -9.574 },
  { name: "Oak Park", slug: "Oak-Park", lat: 52.861, lon: -6.915 },
  { name: "Phoenix Park", slug: "Phoenix-Park", lat: 53.364, lon: -6.35 },
  { name: "Roche's Point", slug: "Roches-Point", lat: 51.793, lon: -8.245 },
  { name: "Shannon", slug: "Shannon", lat: 52.69, lon: -8.918 },
  { name: "Sherkin Island", slug: "Sherkin-Island", lat: 51.476, lon: -9.428 },
  { name: "Valentia", slug: "Valentia", lat: 51.938, lon: -10.241 }
];

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f'’-]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export function findStation(name: string): Station | undefined {
  const wanted = fold(name.replace(/airport$/i, ""));
  return STATIONS.find((s) => fold(s.name) === wanted || fold(s.name.replace(/airport$/i, "")) === wanted || fold(s.slug) === wanted);
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function nearestStation(lat: number, lon: number): Station & { distance_km: number } {
  let best = STATIONS[0]!;
  let bestKm = Infinity;
  for (const s of STATIONS) {
    const km = distanceKm(lat, lon, s.lat, s.lon);
    if (km < bestKm) [best, bestKm] = [s, km];
  }
  return { ...best, distance_km: Math.round(bestKm * 10) / 10 };
}

const attr = (xml: string, tag: string, name: string): string | undefined =>
  xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`))?.[1];
const num = (value: string | undefined) => (value === undefined || value === "" ? null : Number(value));

export interface ForecastHour {
  time: string;
  temperature_c: number | null;
  wind_speed_kmh: number | null;
  wind_gust_kmh: number | null;
  wind_direction: string | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  cloud_pct: number | null;
  precipitation_mm: number | null;
  precipitation_probability_pct: number | null;
  symbol: string | null;
}

const kmh = (mps: number | null) => (mps === null ? null : Math.round(mps * 3.6));

/** Parses the met.no-style locationforecast XML into one entry per instant time step. */
export function parseForecast(xml: string): ForecastHour[] {
  const blocks = [...xml.matchAll(/<time\b[^>]*from="([^"]+)"[^>]*to="([^"]+)"[^>]*>([\s\S]*?)<\/time>/g)];
  const periods = new Map<string, string>();
  for (const [, from, to, body] of blocks) {
    if (from !== to && body && !periods.has(to!)) periods.set(to!, body);
  }
  const hours: ForecastHour[] = [];
  for (const [, from, to, body = ""] of blocks) {
    if (from !== to) continue;
    const period = periods.get(from!) ?? "";
    hours.push({
      time: from!,
      temperature_c: num(attr(body, "temperature", "value")),
      wind_speed_kmh: kmh(num(attr(body, "windSpeed", "mps"))),
      wind_gust_kmh: kmh(num(attr(body, "windGust", "mps"))),
      wind_direction: attr(body, "windDirection", "name") ?? null,
      humidity_pct: num(attr(body, "humidity", "value")),
      pressure_hpa: num(attr(body, "pressure", "value")),
      cloud_pct: num(attr(body, "cloudiness", "percent")),
      precipitation_mm: num(attr(period, "precipitation", "value")),
      precipitation_probability_pct: num(attr(period, "precipitation", "probability")),
      symbol: attr(period, "symbol", "id") ?? null
    });
  }
  return hours;
}

export async function forecastAt(ctx: ToolContext, lat: number, lon: number, hours: number) {
  assertInIreland(lat, lon);
  const url = `${FORECAST_BASE}?lat=${lat.toFixed(4)};long=${lon.toFixed(4)}`;
  const result = await ctx.cachedText(url, TTL, { label: "Met Éireann forecast" });
  if (!result.value.includes("<weatherdata")) throw new ToolError("UPSTREAM_DOWN", "Met Éireann returned an unexpected forecast format.");
  const all = parseForecast(result.value);
  return { url, ...bound(all, hours), cached: result.cached, stale: result.stale, model_run: attr(result.value, "model", "runended") ?? null };
}

interface RawObservation {
  name: string;
  temperature?: string;
  weatherDescription?: string;
  windSpeed?: string;
  windGust?: string;
  cardinalWindDirection?: string;
  humidity?: string;
  rainfall?: string;
  pressure?: string;
  date?: string;
  reportTime?: string;
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t === "" || t === "-" || t === "n/a" ? null : Number.isFinite(Number(t)) ? Number(t) : t;
};

export async function observationsAt(ctx: ToolContext, station: Station) {
  const url = `${OBSERVATIONS_BASE}/${encodeURIComponent(station.slug)}/today`;
  const result = await ctx.cachedJson<RawObservation[]>(url, TTL, { label: "Met Éireann observations" });
  const rows = Array.isArray(result.value) ? result.value : [];
  if (rows.length && fold(rows[0]!.name) !== fold(station.name)) {
    throw new ToolError("NOT_FOUND", `Met Éireann has no observations for ${station.name} today.`);
  }
  const observations = rows.map((r) => {
    const [d, m, y] = (r.date ?? "").split("-");
    return {
      time: y && r.reportTime ? `${y}-${m}-${d}T${r.reportTime}` : null,
      temperature_c: clean(r.temperature),
      weather: r.weatherDescription ?? null,
      wind_speed_kmh: clean(r.windSpeed),
      wind_gust_kmh: clean(r.windGust),
      wind_direction: r.cardinalWindDirection ?? null,
      humidity_pct: clean(r.humidity),
      rainfall_mm: clean(r.rainfall),
      pressure_hpa: clean(r.pressure)
    };
  });
  return { url, observations, cached: result.cached, stale: result.stale };
}

interface RawWarning {
  id?: string;
  type?: string;
  level?: string;
  headline?: string;
  description?: string;
  regions?: string[];
  onset?: string;
  expiry?: string;
  severity?: string;
  certainty?: string;
  updated?: string;
}

export async function activeWarnings(ctx: ToolContext) {
  const result = await ctx.cachedJson<RawWarning[]>(WARNINGS_URL, 5 * MINUTE, { label: "Met Éireann warnings" });
  const warnings = (Array.isArray(result.value) ? result.value : []).map((w) => ({
    level: w.level ?? null,
    type: w.type ?? null,
    headline: w.headline ?? null,
    description: w.description ?? null,
    region_codes: w.regions ?? [],
    onset: w.onset ?? null,
    expiry: w.expiry ?? null,
    severity: w.severity ?? null,
    certainty: w.certainty ?? null,
    updated: w.updated ?? null
  }));
  return { warnings, cached: result.cached, stale: result.stale };
}

const forecastTool = defineTool({
  name: "met_get_forecast",
  title: "Weather forecast for a location",
  description:
    "Met Éireann point forecast (HARMONIE then ECMWF, ~10 days) for a WGS84 location in Ireland: hourly temperature, wind, rain and cloud.",
  inputSchema: {
    lat: z.number().min(-90).max(90).describe("Latitude, e.g. 53.35."),
    lon: z.number().min(-180).max(180).describe("Longitude, e.g. -6.26."),
    hours: z.number().int().min(1).max(240).default(24).describe("Number of forecast time steps to return.")
  },
  handler: async ({ lat, lon, hours }, ctx) => {
    const r = await forecastAt(ctx, lat, lon, hours);
    return envelope(metInfo, {
      data: { lat, lon, model_run: r.model_run, forecast: r.items },
      url: r.url,
      cached: r.cached,
      stale: r.stale,
      truncated: r.truncated
    });
  }
});

const observationsTool = defineTool({
  name: "met_get_observations",
  title: "Today's weather observations",
  description: `Hourly observations so far today from a Met Éireann synoptic station. Stations: ${STATIONS.map((s) => s.name).join(", ")}.`,
  inputSchema: {
    station: z.string().min(2).max(40).default("Dublin Airport").describe("Station name, e.g. 'Cork' or 'Malin Head'.")
  },
  handler: async ({ station }, ctx) => {
    const found = findStation(station);
    if (!found) {
      throw new ToolError("NOT_FOUND", `Unknown Met Éireann station '${station}'.`, { hint: `Use one of: ${STATIONS.map((s) => s.name).join(", ")}.` });
    }
    const r = await observationsAt(ctx, found);
    return envelope(metInfo, {
      data: { station: found.name, lat: found.lat, lon: found.lon, latest: r.observations.at(-1) ?? null, observations: r.observations },
      url: r.url,
      cached: r.cached,
      stale: r.stale
    });
  }
});

const warningsTool = defineTool({
  name: "met_get_warnings",
  title: "Active weather warnings",
  description: "Active Met Éireann weather warnings for Ireland (Yellow/Orange/Red), with onset/expiry and EMMA region codes. An empty list means no warnings.",
  inputSchema: {},
  handler: async (_args, ctx) => {
    const r = await activeWarnings(ctx);
    return envelope(metInfo, {
      data: { count: r.warnings.length, warnings: r.warnings },
      url: "https://www.met.ie/warnings",
      cached: r.cached,
      stale: r.stale
    });
  }
});

export const metModule: SourceModule = {
  info: metInfo,
  summary: "Weather: point forecasts anywhere in Ireland, today's station observations and active warnings.",
  domain: "environment",
  coverage: "Point forecasts for anywhere in Ireland (hourly, up to 48h here), today's synoptic station observations and national warnings.",
  tools: [forecastTool, observationsTool, warningsTool]
};
