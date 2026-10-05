import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { assertInIreland } from "../geohive/index.js";
import { ARCGIS_LAYERS, queryLayer } from "../arcgis/client.js";

export const environmentSitesInfo: SourceInfo = {
  id: "environment-sites",
  name: "NPWS designated protected sites",
  licence: "CC BY 4.0",
  attribution: "© National Parks and Wildlife Service.",
  homepage: "https://experience.arcgis.com/experience/edf34d92e28040fd87d3d14f55d8d95f/"
};

const layers = [
  { type: "SPA", url: ARCGIS_LAYERS.npwsSpa },
  { type: "pNHA", url: ARCGIS_LAYERS.npwsPnha },
  { type: "NHA", url: ARCGIS_LAYERS.npwsNha },
  { type: "SAC", url: ARCGIS_LAYERS.npwsSac }
] as const;

const fields = ["SITECODE", "SITE_NAME", "COUNTY", "HA", "URL"];
const str = (value: unknown) => (typeof value === "string" ? value.trim() || null : value == null ? null : String(value));
const site = (type: string, a: Record<string, unknown>) => ({
  type,
  code: str(a.SITECODE),
  name: str(a.SITE_NAME),
  county: str(a.COUNTY),
  hectares: typeof a.HA === "number" ? a.HA : null,
  url: str(a.URL)
});

async function protectedSites(ctx: ToolContext, lat: number, lon: number, radius_m: number | undefined, limit: number) {
  assertInIreland(lat, lon);
  const settled = await Promise.allSettled(
    layers.map((l) =>
      queryLayer(ctx, l.url, {
        where: "1=1",
        geometry: { type: "point", lat, lon, ...(radius_m ? { distance: radius_m } : {}) },
        outFields: fields,
        resultRecordCount: Math.ceil(limit / layers.length),
        returnGeometry: false
      }).then((r) => ({ ...r, type: l.type }))
    )
  );
  const sites = settled.flatMap((s) => (s.status === "fulfilled" ? s.value.features.map((f) => site(s.value.type, f.attributes)) : []));
  return {
    sites: sites.slice(0, limit),
    cached: settled.every((s) => s.status === "fulfilled" && s.value.cached),
    stale: settled.some((s) => s.status === "fulfilled" && s.value.stale),
    url: environmentSitesInfo.homepage,
    unavailable: settled
      .map((s, i) => (s.status === "rejected" ? layers[i]!.type : null))
      .filter(Boolean)
  };
}

const atTool = defineTool({
  name: "protected_sites_at",
  title: "Protected sites at a location",
  description: "Return NPWS SPA, SAC, NHA and proposed NHA polygons containing a WGS84 point.",
  example: { lat: 53.3498, lon: -6.2603, limit: 10 },
  inputSchema: {
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(20)
  },
  handler: async ({ lat, lon, limit }, ctx) => {
    const result = await protectedSites(ctx, lat, lon, undefined, limit);
    return envelope(environmentSitesInfo, {
      data: { count: result.sites.length, sites: result.sites, ...(result.unavailable.length ? { unavailable: result.unavailable } : {}) },
      url: result.url,
      cached: result.cached,
      stale: result.stale
    });
  }
});

const nearTool = defineTool({
  name: "protected_sites_near",
  title: "Protected sites near a location",
  description: "Find NPWS SPA, SAC, NHA and proposed NHA polygons intersecting a radius around a WGS84 point.",
  example: { lat: 53.3498, lon: -6.2603, radius_m: 1000, limit: 10 },
  inputSchema: {
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_m: z.number().int().min(1).max(20_000).default(1000),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(20)
  },
  handler: async ({ lat, lon, radius_m, limit }, ctx) => {
    const result = await protectedSites(ctx, lat, lon, radius_m, limit);
    return envelope(environmentSitesInfo, {
      data: { count: result.sites.length, sites: result.sites, ...(result.unavailable.length ? { unavailable: result.unavailable } : {}) },
      url: result.url,
      cached: result.cached,
      stale: result.stale
    });
  }
});

export const environmentSitesModule: SourceModule = {
  info: environmentSitesInfo,
  summary: "NPWS SPA, SAC, NHA and proposed NHA sites at or near a point.",
  domain: "environment",
  coverage: "Republic of Ireland designated protected sites from NPWS ArcGIS FeatureServer.",
  tools: [atTool, nearTool]
};
