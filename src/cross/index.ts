import { z } from "zod";
import { DEFAULT_LIMIT, envelope, type SourceInfo } from "../gateway/envelope.js";
import { ToolError, toToolError } from "../gateway/errors.js";
import { defineTool, type AnyTool, type SearchHit, type SourceModule, type ToolContext } from "../gateway/module.js";
import { boundariesAt, geohiveInfo, locatePlace } from "../sources/geohive/index.js";
import { activeWarnings, forecastAt, metInfo, nearestStation } from "../sources/met-eireann/index.js";
import { findPlace } from "./places.js";

export const crossInfo: SourceInfo = {
  id: "cross",
  name: "Ireland MCP (combined sources)",
  licence: "Per section; see `sources` in data",
  attribution: "Combined from the public sources listed in `data.sources`; cite each one you use.",
  homepage: "https://github.com/c-mongan/ireland-mcp"
};

/** One slow source must not hold up the combined search; its result still warms the cache for next time. */
export const SEARCH_TIMEOUT_MS = 5_000;

const withTimeout = <T>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new ToolError("UPSTREAM_DOWN", `${label} timed out.`)), ms).unref?.())]);

/** Round-robin merge so every source gets a fair share of the top results. */
export function interleave<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i += 1) {
    for (const l of lists) if (i < l.length && out.length < limit) out.push(l[i]!);
  }
  return out;
}

const cite = (info: SourceInfo, url: string) => ({ source: info.name, url, licence: info.licence, attribution: info.attribution });
const short = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function settledSection<T>(r: PromiseSettledResult<T>): T | { error: { code: string; message: string } } {
  if (r.status === "fulfilled") return r.value;
  const e = toToolError(r.reason);
  return { error: { code: e.code, message: e.message } };
}

export function crossSourceTools(modules: SourceModule[]): AnyTool[] {
  const searchable = modules.filter((m) => m.search);
  const byId = new Map(modules.map((m) => [m.info.id, m]));

  const search = defineTool({
    name: "search",
    title: "Search Irish public data",
    description: `Search across ${searchable.map((m) => m.info.name).join(", ")}. Returns ids like 'cso:F1001' to pass to fetch.`,
    raw: true,
    inputSchema: { query: z.string().min(1).max(200).describe("What to look for, e.g. 'population by county' or 'housing bill 2024'.") },
    handler: async ({ query }, ctx) => {
      const settled = await Promise.allSettled(
        searchable.map((m) => withTimeout(m.search!(query, DEFAULT_LIMIT / 5, ctx), SEARCH_TIMEOUT_MS, m.info.name))
      );
      const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : ([] as SearchHit[])));
      if (settled.every((s) => s.status === "rejected")) throw toToolError((settled[0] as PromiseRejectedResult).reason);
      // ChatGPT's search contract is exactly { results }; slow or failed sources are simply omitted.
      return { results: interleave(lists, 20) };
    }
  });

  const fetchTool = defineTool({
    name: "fetch",
    title: "Fetch a document by id",
    description: "Fetch the full text of a search result by its id, e.g. 'cso:F1001', 'oireachtas:bill/2024/12', 'legislation:2018/7/s2' or 'data-gov-ie:moby-bikes'.",
    raw: true,
    inputSchema: { id: z.string().min(3).max(200).describe("Id from search, '<source>:<key>'.") },
    handler: async ({ id }, ctx) => {
      const at = id.indexOf(":");
      const module = at > 0 ? byId.get(id.slice(0, at)) : undefined;
      if (!module?.fetchById) {
        throw new ToolError("NOT_FOUND", `No source can fetch "${id}".`, {
          hint: `Ids look like '<source>:<key>'. Fetchable sources: ${searchable.map((m) => m.info.id).join(", ")}.`
        });
      }
      return module.fetchById(id.slice(at + 1), ctx);
    }
  });

  const listSources = defineTool({
    name: "list_sources",
    title: "List data sources",
    description: "List every Irish public data source on this server, with its licence, attribution and tool names.",
    inputSchema: {},
    handler: async () =>
      envelope(crossInfo, {
        data: {
          sources: modules.map((m) => ({
            id: m.info.id,
            name: short(m.info.name, 70),
            licence: short(m.info.licence, 70),
            attribution: short(m.info.attribution, 70),
            tools: m.tools.map((t) => t.name),
            searchable: Boolean(m.search)
          }))
        },
        url: crossInfo.homepage,
        cached: true
      })
  });

  type Section = { data: Record<string, unknown>; url: string; cached?: boolean; stale?: boolean };
  const runSourceTool = (source: string, tool: string, args: Record<string, unknown>, ctx: ToolContext): Promise<Section> => {
    const t = byId.get(source)?.tools.find((x) => x.name === tool);
    return t ? (t.handler(args, ctx) as Promise<Section>) : Promise.reject(new ToolError("NOT_FOUND", `${source} is not enabled.`));
  };
  const MONUMENT_RADIUS_M = 500;
  const NEARBY_ITEMS = 5;

  async function nearbyData(ctx: ToolContext, lat: number, lon: number, hours: number) {
    const station = nearestStation(lat, lon);
    const [bounds, forecast] = await Promise.allSettled([boundariesAt(ctx, lat, lon), forecastAt(ctx, lat, lon, hours)]);
    return {
      boundaries: bounds.status === "fulfilled" ? bounds.value.boundaries : settledSection(bounds),
      nearest_met_station: station,
      forecast: forecast.status === "fulfilled" ? { model_run: forecast.value.model_run, hours: forecast.value.items } : settledSection(forecast),
      stale: [bounds, forecast].some((s) => s.status === "fulfilled" && s.value.stale),
      cached: [bounds, forecast].every((s) => s.status === "fulfilled" && s.value.cached),
      forecastUrl: forecast.status === "fulfilled" ? forecast.value.url : null
    };
  }

  /** Monuments and protected sites for nearby; compact, and each section fails on its own. */
  async function placeLayers(ctx: ToolContext, lat: number, lon: number) {
    const [smr, npws] = await Promise.allSettled([
      runSourceTool("heritage", "heritage_monuments_near", { lat, lon, radius_m: MONUMENT_RADIUS_M, limit: NEARBY_ITEMS }, ctx),
      runSourceTool("environment-sites", "protected_sites_at", { lat, lon, limit: NEARBY_ITEMS }, ctx)
    ]);
    const sources = [
      ...(smr.status === "fulfilled" ? [cite(byId.get("heritage")!.info, smr.value.url)] : []),
      ...(npws.status === "fulfilled" ? [cite(byId.get("environment-sites")!.info, npws.value.url)] : [])
    ];
    return {
      monuments:
        smr.status === "fulfilled"
          ? { radius_m: MONUMENT_RADIUS_M, count: smr.value.data.count, items: smr.value.data.monuments }
          : settledSection(smr),
      protected_sites: npws.status === "fulfilled" ? { count: npws.value.data.count, items: npws.value.data.sites } : settledSection(npws),
      sources
    };
  }

  const nearby = defineTool({
    name: "nearby",
    pinned: true,
    title: "What is at this location",
    description:
      "For a WGS84 point in Ireland: county, local authority, constituency, electoral division, small area and settlement (GeoHive), the nearest Met Éireann station and forecast, recorded monuments within 500 m (SMR) and NPWS protected sites at the point. Not live observations, river levels, buoys, bikes or populations: use ireland_call for those.",
    inputSchema: {
      lat: z.number().min(-90).max(90).describe("Latitude, e.g. 53.3498."),
      lon: z.number().min(-180).max(180).describe("Longitude, e.g. -6.2603."),
      hours: z.number().int().min(1).max(48).default(6).describe("Forecast hours to include.")
    },
    handler: async ({ lat, lon, hours }, ctx) => {
      const [d, layers] = await Promise.all([nearbyData(ctx, lat, lon, hours), placeLayers(ctx, lat, lon)]);
      return envelope(crossInfo, {
        data: {
          lat,
          lon,
          boundaries: d.boundaries,
          nearest_met_station: d.nearest_met_station,
          forecast: d.forecast,
          monuments: layers.monuments,
          protected_sites: layers.protected_sites,
          sources: [cite(geohiveInfo, "https://www.geohive.ie/"), cite(metInfo, d.forecastUrl ?? metInfo.homepage), ...layers.sources]
        },
        url: crossInfo.homepage,
        cached: d.cached,
        stale: d.stale
      });
    }
  });

  const snapshot = defineTool({
    name: "ireland_snapshot",
    example: { place: "Galway" },
    title: "Snapshot of an Irish place",
    description:
      "One-call overview of an Irish county, town or townland: census population (CSO F1001), boundaries (GeoHive), weather forecast and national weather warnings (Met Éireann). Use the source tools for detail.",
    inputSchema: {
      place: z.string().min(2).max(60).optional().describe("County or town, e.g. 'Galway', 'Co. Kerry', 'Athlone'."),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional()
    },
    handler: async ({ place, lat, lon }, ctx) => {
      let where: { name: string; county: string | null; lat: number; lon: number };
      if (place) {
        const p = findPlace(place);
        if (p) {
          where = { name: p.name, county: p.county, lat: p.lat, lon: p.lon };
        } else {
          const hit = await locatePlace(ctx, place.replace(/^(co\.?|county)\s+/i, ""), 1).catch(() => null);
          const g = hit?.places[0];
          if (!g) {
            throw new ToolError("NOT_FOUND", `"${place}" was not found in the built-in place list or the Tailte Éireann gazetteer.`, {
              hint: "Check the spelling or try the Irish name, or give lat and lon."
            });
          }
          where = { name: g.name ?? place, county: g.county, lat: g.lat, lon: g.lon };
        }
      } else if (lat !== undefined && lon !== undefined) {
        where = { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, county: null, lat, lon };
      } else {
        throw new ToolError("BAD_ARGS", "Give a place name, or both lat and lon.");
      }

      const near = await nearbyData(ctx, where.lat, where.lon, 6);
      const countyName =
        where.county ??
        (near.boundaries && typeof near.boundaries === "object" && "county" in near.boundaries
          ? ((near.boundaries.county as { name?: string } | null)?.name ?? null)
          : null);
      const cso = byId.get("cso")?.tools.find((t) => t.name === "cso_area_profile");
      const [population, warnings] = await Promise.allSettled([
        cso && countyName ? cso.handler({ area: countyName }, ctx) : Promise.reject(new ToolError("NOT_FOUND", "County unknown for this point.")),
        activeWarnings(ctx)
      ]);
      const pop = population.status === "fulfilled" ? (population.value as { data: unknown; url: string }) : null;
      return envelope(crossInfo, {
        data: {
          place: where.name,
          county: countyName,
          lat: where.lat,
          lon: where.lon,
          population: pop ? pop.data : settledSection(population),
          boundaries: near.boundaries,
          nearest_met_station: near.nearest_met_station,
          forecast: near.forecast,
          national_warnings:
            warnings.status === "fulfilled"
              ? warnings.value.warnings.filter((w) => w.category === "national").map((w) => ({ level: w.level, type: w.type, headline: w.headline, regions: w.region_codes, expiry: w.expiry }))
              : settledSection(warnings),
          sources: [
            ...(pop && byId.get("cso") ? [cite(byId.get("cso")!.info, pop.url)] : []),
            cite(geohiveInfo, "https://www.geohive.ie/"),
            cite(metInfo, near.forecastUrl ?? metInfo.homepage)
          ]
        },
        url: crossInfo.homepage,
        cached: near.cached,
        stale: near.stale
      });
    }
  });

  return [search, fetchTool, listSources, snapshot, nearby];
}
