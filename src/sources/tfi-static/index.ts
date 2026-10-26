import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const tfiStaticInfo: SourceInfo = {
  id: "tfi-static", name: "Transport for Ireland NaPTAN stop records", licence: "CC BY 4.0",
  attribution: "Contains National Transport Authority (Transport for Ireland) data, licensed under CC BY 4.0.",
  homepage: "https://www.transportforireland.ie/transitData/PT_Data.html"
};
const URL = "https://www.transportforireland.ie/transitData/Data/NaPTAN.json";
const note = "Static stop records do not establish live services, accessibility or schedules. NaPTAN AtcoCode is returned as atco_code; a match to GTFS-Realtime stop_id has not been verified. snapshot_modified_at is the publisher's timestamp without an explicit time zone; fetched_at is the upstream download time.";
type Raw = Record<string, unknown>;
const object = (v: unknown): Raw => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Raw : {};
const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const label = (v: unknown) => text(v) ?? text(object(v)["#text"]);
const coordinate = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== "number" && (typeof v !== "string" || !v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
interface Stop { atco_code: string; name: string; plate_code: string | null; lat: number | null; lon: number | null; administrative_area_ref: string | null; status: string | null }
interface Feed { stops: Stop[]; snapshot_modified_at: string | null; snapshot_file: string | null; fetched_at: string }
function normalise(raw: unknown, fetchedAt: string): Feed {
  const root = object(object(raw).NaPTAN);
  const points = object(root.StopPoints).StopPoint;
  if (!Array.isArray(points) || points.length === 0 || points.length > 100_000) throw new ToolError("UPSTREAM_DOWN", "TFI returned an invalid NaPTAN stop list.", { retryable: false });
  const stops = points.map((point): Stop => {
    const p = object(point);
    const atco_code = text(p.AtcoCode);
    const name = label(object(p.Descriptor).CommonName);
    if (!atco_code || !name) throw new ToolError("UPSTREAM_DOWN", "TFI returned a stop without an identifier or name.", { retryable: false });
    const location = object(object(p.Place).Location);
    const translation = object(location.Translation);
    return { atco_code, name, plate_code: text(p.PlateCode), lat: coordinate(translation.Latitude ?? location.Latitude, -90, 90), lon: coordinate(translation.Longitude ?? location.Longitude, -180, 180), administrative_area_ref: text(p.AdministrativeAreaRef), status: text(p["@Status"]) };
  }).sort((a, b) => a.atco_code.localeCompare(b.atco_code));
  return { stops, snapshot_modified_at: text(root["@ModificationDateTime"]), snapshot_file: text(root["@FileName"]), fetched_at: fetchedAt };
}
async function load(ctx: ToolContext) {
  return ctx.cache.getOrLoad<Feed>("tfi-static:naptan:v1", DAY, async () => normalise(await ctx.http.json(URL, { label: "TFI NaPTAN", maxBytes: 30 * 1024 * 1024, timeoutMs: 20_000 }), ctx.now().toISOString()));
}
function distance(lat: number, lon: number, otherLat: number, otherLon: number) {
  const rad = Math.PI / 180;
  const a = Math.sin((otherLat - lat) * rad / 2) ** 2 + Math.cos(lat * rad) * Math.cos(otherLat * rad) * Math.sin((otherLon - lon) * rad / 2) ** 2;
  return 6371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
const search = defineTool({
  name: "tfi_static_search_stops", title: "Search static Irish transport stop records",
  description: "Search keyless TFI NaPTAN stop records by name, exact AtcoCode, or WGS84 point. Returns AtcoCode identifiers, location and publisher snapshot date. Static records do not prove live services or accessibility.",
  inputSchema: {
    atco_code: z.string().trim().min(1).max(64).optional().describe("Exact NaPTAN AtcoCode, not a verified GTFS stop_id."),
    lat: z.number().min(51).max(56).optional(),
    lon: z.number().min(-11).max(-5).optional(),
    radius: z.number().int().min(50).max(20_000).default(1000).describe("Point-search radius in metres; requires lat and lon."),
    name: z.string().trim().min(1).max(100).optional().describe("Case-insensitive common-name substring."),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).max(100_000).default(0)
  },
  handler: async ({ name, atco_code, lat, lon, radius, limit, offset }, ctx) => {
    if ((lat === undefined) !== (lon === undefined)) throw new ToolError("BAD_ARGS", "Point search requires both lat and lon.");
    const r = await load(ctx);
    const stops = r.value.stops
      .filter((s) => (!name || s.name.toLocaleLowerCase("en").includes(name.toLocaleLowerCase("en"))) && (!atco_code || s.atco_code === atco_code))
      .flatMap((s) => {
        if (lat === undefined || lon === undefined) return [s];
        if (s.lat === null || s.lon === null) return [];
        const metres = distance(lat, lon, s.lat, s.lon);
        return metres <= radius ? [{ ...s, distance_m: Math.round(metres) }] : [];
      });
    return envelope(tfiStaticInfo, { data: { snapshot_modified_at: r.value.snapshot_modified_at, snapshot_file: r.value.snapshot_file, fetched_at: r.value.fetched_at, stops: stops.slice(offset, offset + limit), total: stops.length, offset, next_offset: offset + limit < stops.length ? offset + limit : null, note }, url: URL, cached: r.cached, stale: r.stale, truncated: offset + limit < stops.length, retrievedAt: new Date(r.value.fetched_at) });
  }
});
export const tfiStaticModule: SourceModule = { info: tfiStaticInfo, summary: "Keyless static transport stop discovery from TFI NaPTAN.", domain: "transport", coverage: "Publisher NaPTAN stop snapshot, including Irish and cross-border records. Daily cache; not live services or schedules.", tools: [search] };
