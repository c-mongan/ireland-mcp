import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

export const geohiveInfo: SourceInfo = {
  id: "geohive",
  name: "Tailte Éireann GeoHive boundaries (ArcGIS)",
  licence: "CC BY 4.0",
  attribution: "© Tailte Éireann. Boundary data licensed under CC BY 4.0. Census geographies © CSO.",
  homepage: "https://www.geohive.ie"
};

export const ARCGIS_BASE = "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services";
const TTL = DAY;

/** Ireland (including Northern Ireland) bounding box, used to reject obviously wrong coordinates. */
export const IRELAND_BBOX = { minLat: 51.2, maxLat: 55.6, minLon: -11, maxLon: -5.3 } as const;

export function assertInIreland(lat: number, lon: number): void {
  if (lat < IRELAND_BBOX.minLat || lat > IRELAND_BBOX.maxLat || lon < IRELAND_BBOX.minLon || lon > IRELAND_BBOX.maxLon) {
    throw new ToolError("BAD_ARGS", `(${lat}, ${lon}) is outside Ireland.`, {
      hint: "Use WGS84 decimal degrees: latitude about 51.4 to 55.4, longitude about -10.7 to -5.4 (negative = west)."
    });
  }
}

interface BoundaryLayer {
  key: string;
  label: string;
  service: string;
  fields: string[];
  pick: (a: Record<string, unknown>) => Record<string, unknown>;
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() || null : value == null ? null : String(value));
const title = (value: unknown) =>
  str(value)
    ?.toLowerCase()
    .replace(/(^|[\s(-])\p{L}/gu, (m) => m.toUpperCase()) ?? null;

export const BOUNDARY_LAYERS: BoundaryLayer[] = [
  {
    key: "county",
    label: "County",
    service: "Counties___OSi_National_Statutory_Boundaries",
    fields: ["ENGLISH", "GAEILGE", "PROVINCE"],
    pick: (a) => ({ name: title(a.ENGLISH), irish: str(a.GAEILGE), province: str(a.PROVINCE) })
  },
  {
    key: "local_authority",
    label: "Local authority (2024)",
    service: "LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024",
    fields: ["ENG_NAME_VALUE", "GLE_NAME_VALUE", "BDY_TYPE_VALUE"],
    pick: (a) => ({ name: title(a.ENG_NAME_VALUE), irish: str(a.GLE_NAME_VALUE), type: str(a.BDY_TYPE_VALUE) })
  },
  {
    key: "dail_constituency",
    label: "Dáil constituency (2023 boundaries, used from GE2024)",
    service: "ConstituencyBoundariesUngeneralised_National_Electoral_Boundaries_2023",
    fields: ["ENG_NAME_VALUE", "GLE_NAME_VALUE"],
    pick: (a) => {
      const name = str(a.ENG_NAME_VALUE) ?? "";
      const seats = name.match(/\((\d+)\)\s*$/)?.[1];
      return { name: name.replace(/\s*\(\d+\)\s*$/, "") || null, irish: str(a.GLE_NAME_VALUE)?.replace(/\s*\(\d+\)\s*$/, "") ?? null, seats: seats ? Number(seats) : null };
    }
  },
  {
    key: "local_electoral_area",
    label: "Local electoral area",
    service: "Local_Electoral_Areas_Boundaries_Generalised_20m",
    fields: ["LE_ENGLISH", "COUNTY"],
    pick: (a) => {
      const name = str(a.LE_ENGLISH) ?? "";
      const seats = name.match(/\((\d+)\)\s*$/)?.[1];
      return { name: title(name.replace(/\s*\(\d+\)\s*$/, "")), seats: seats ? Number(seats) : null };
    }
  },
  {
    key: "electoral_division",
    label: "CSO electoral division",
    service: "CSO_Electoral_Divisions_Generalised_20m",
    fields: ["ED_ENGLISH", "CSOED_3409", "CSOED_34_1"],
    pick: (a) => ({ name: str(a.CSOED_34_1) ?? title(a.ED_ENGLISH), cso_code: str(a.CSOED_3409) })
  },
  {
    key: "small_area",
    label: "CSO small area",
    service: "Small_Areas_Generalised_20m",
    fields: ["SMALL_AREA", "GEOGID", "EDNAME", "COUNTYNAME", "NUTS3NAME"],
    pick: (a) => ({ code: str(a.SMALL_AREA), geogid: str(a.GEOGID), local_authority: str(a.COUNTYNAME), nuts3: str(a.NUTS3NAME) })
  },
  {
    key: "settlement",
    label: "CSO settlement (town/city)",
    service: "Settlements_Generalised_20m",
    fields: ["SETTL_NAME", "SETTLEMENT"],
    pick: (a) => ({ name: str(a.SETTL_NAME), code: str(a.SETTLEMENT) })
  }
];

interface ArcGisResponse {
  features?: Array<{ attributes: Record<string, unknown> }>;
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string; details?: string[] };
}

/** ArcGIS reports errors in a 200 body; throwing here keeps them out of the cache. */
function assertArcGisOk(body: ArcGisResponse): void {
  if (!body.error) return;
  const detail = [body.error.message, ...(body.error.details ?? [])].filter(Boolean).join(" ");
  throw body.error.code === 400 || body.error.code === 404
    ? new ToolError(body.error.code === 404 ? "NOT_FOUND" : "BAD_ARGS", `GeoHive rejected the query: ${detail}`.slice(0, 300), {
        hint: "Check the service name with geohive_list_layers and use ArcGIS SQL in 'where', e.g. PROVINCE='Munster'."
      })
    : new ToolError("UPSTREAM_DOWN", "GeoHive ArcGIS returned an error.");
}

function assertFeatures(body: ArcGisResponse): void {
  if (!body || typeof body !== "object") throw new ToolError("UPSTREAM_DOWN", "GeoHive returned an invalid feature response.", { retryable: false });
  assertArcGisOk(body);
  if (!Array.isArray(body.features) || body.features.some((feature) => !feature || !feature.attributes || typeof feature.attributes !== "object" || Array.isArray(feature.attributes))) {
    throw new ToolError("UPSTREAM_DOWN", "GeoHive returned invalid feature rows.", { retryable: false });
  }
}

async function arcgisQuery(ctx: ToolContext, service: string, params: Record<string, string>, layerId = 0) {
  const query = new URLSearchParams({ returnGeometry: "false", f: "json", ...params });
  const url = `${ARCGIS_BASE}/${encodeURIComponent(service)}/FeatureServer/${layerId}/query?${query.toString()}`;
  const result = await ctx.cachedJson<ArcGisResponse>(url, TTL, { label: "GeoHive ArcGIS", validate: assertFeatures });
  return { url, features: result.value.features ?? [], exceeded: Boolean(result.value.exceededTransferLimit), cached: result.cached, stale: result.stale };
}

export async function boundariesAt(ctx: ToolContext, lat: number, lon: number) {
  assertInIreland(lat, lon);
  const point = { geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects" };
  const settled = await Promise.allSettled(
    BOUNDARY_LAYERS.map((layer) => arcgisQuery(ctx, layer.service, { ...point, outFields: layer.fields.join(",") }))
  );
  if (settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  const boundaries: Record<string, unknown> = {};
  const unavailable: string[] = [];
  let cached = true;
  let stale = false;
  settled.forEach((s, i) => {
    const layer = BOUNDARY_LAYERS[i]!;
    if (s.status === "rejected") {
      unavailable.push(layer.key);
      boundaries[layer.key] = null;
      return;
    }
    cached &&= s.value.cached;
    stale ||= s.value.stale;
    const first = s.value.features[0];
    boundaries[layer.key] = first ? layer.pick(first.attributes) : null;
  });
  return { boundaries, unavailable, cached, stale };
}

const boundariesTool = defineTool({
  name: "geohive_boundaries_at_point",
  title: "Boundaries at a location",
  description:
    "Which county, local authority, Dáil constituency, local electoral area, CSO electoral division, small area and settlement contain a WGS84 point. Null means none (e.g. at sea or in Northern Ireland).",
  inputSchema: {
    lat: z.number().min(-90).max(90).describe("Latitude, e.g. 53.3498."),
    lon: z.number().min(-180).max(180).describe("Longitude, e.g. -6.2603 (west is negative).")
  },
  handler: async ({ lat, lon }, ctx) => {
    const result = await boundariesAt(ctx, lat, lon);
    return envelope(geohiveInfo, {
      data: { lat, lon, ...result.boundaries, ...(result.unavailable.length ? { unavailable: result.unavailable } : {}) },
      url: `https://www.geohive.ie/`,
      cached: result.cached,
      stale: result.stale
    });
  }
});

const serviceName = z.string().regex(/^[A-Za-z0-9_-]{3,120}$/).describe("Service name from geohive_list_layers.");
interface ServiceLayer { id: number; name: string; type?: string }
interface ServiceMetadata extends ArcGisResponse { layers: ServiceLayer[] }

async function readServiceLayers(ctx: ToolContext, service: string) {
  const url = `${ARCGIS_BASE}/${encodeURIComponent(service)}/FeatureServer?f=json`;
  const result = await ctx.cachedJson<ServiceMetadata>(url, TTL, {
    label: "GeoHive service metadata",
    validate: (body) => {
      if (!body || typeof body !== "object") throw new ToolError("UPSTREAM_DOWN", "GeoHive returned invalid service metadata.");
      assertArcGisOk(body);
      if (!Array.isArray(body.layers) || body.layers.some((layer) => !layer || !Number.isSafeInteger(layer.id) || layer.id < 0 || typeof layer.name !== "string")) {
        throw new ToolError("UPSTREAM_DOWN", "GeoHive returned invalid service layers.", { retryable: false });
      }
    }
  });
  return { ...result, url, layers: result.value.layers.filter((layer) => !layer.type || layer.type === "Feature Layer") };
}

const listLayersTool = defineTool({
  name: "geohive_list_layers",
  title: "List GeoHive layers",
  description: "List Tailte Éireann / GeoHive ArcGIS feature services (boundaries, placenames, map layers), optionally filtered by words in the name. Pass service to discover its queryable layer IDs.",
  inputSchema: {
    service: serviceName.optional(),
    query: z.string().max(80).optional().describe("Words in the service name, e.g. 'constituency 2023' or 'townlands'."),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(50)
  },
  handler: async ({ service, query, limit }, ctx) => {
    if (service) {
      const result = await readServiceLayers(ctx, service);
      const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const layers = result.layers.filter((layer) => words.every((word) => layer.name.toLowerCase().includes(word)))
        .map((layer) => ({ ...layer, url: `${ARCGIS_BASE}/${encodeURIComponent(service)}/FeatureServer/${layer.id}` }));
      const { items, truncated } = bound(layers, limit);
      return envelope(geohiveInfo, { data: { service, total: layers.length, layers: items }, url: result.url, cached: result.cached, stale: result.stale, truncated });
    }
    const url = `${ARCGIS_BASE}?f=json`;
    const result = await ctx.cachedJson<{ services?: Array<{ name: string; type: string }> }>(url, TTL, { label: "GeoHive ArcGIS" });
    const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const services = (result.value.services ?? [])
      .filter((s) => words.every((w) => s.name.toLowerCase().replace(/_+/g, " ").includes(w)))
      .map((s) => ({ service: s.name, type: s.type, url: `${ARCGIS_BASE}/${s.name}/${s.type}` }));
    const { items, truncated } = bound(services, limit);
    return envelope(geohiveInfo, { data: { total: services.length, services: items }, url, cached: result.cached, stale: result.stale, truncated });
  }
});

const queryLayerTool = defineTool({
  name: "geohive_query_layer",
  example: { service: "Counties___OSi_National_Statutory_Boundaries", where: "PROVINCE='Munster'", out_fields: "ENGLISH,PROVINCE", limit: 3 },
  title: "Query a GeoHive layer",
  description:
    "Query attributes (no geometry) from a GeoHive service. Omit layer_id to select its sole layer or layer 0; otherwise discover IDs with geohive_list_layers(service) and choose one. Use ArcGIS SQL in where.",
  inputSchema: {
    service: serviceName,
    layer_id: z.number().int().min(0).max(100000).optional().describe("Layer ID from geohive_list_layers with service. Omit for the sole layer or layer 0."),
    where: z.string().min(1).max(500).default("1=1").describe("ArcGIS SQL filter."),
    out_fields: z.string().regex(/^(\*|[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*)$/).default("*").describe("Comma-separated field names or *."),
    order_by: z.string().regex(/^[A-Za-z0-9_]+( (ASC|DESC))?$/i).optional(),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(50)
  },
  handler: async ({ service, layer_id, where, out_fields, order_by, limit }, ctx) => {
    const metadata = await readServiceLayers(ctx, service);
    if (!metadata.layers.length) throw new ToolError("NOT_FOUND", "GeoHive service has no queryable feature layers.");
    const selected = layer_id ?? (metadata.layers.length === 1 ? metadata.layers[0]!.id : metadata.layers.find((layer) => layer.id === 0)?.id);
    if (selected === undefined || !metadata.layers.some((layer) => layer.id === selected)) {
      throw new ToolError("BAD_ARGS", "Choose a queryable layer from this service.", {
        hint: `Set layer_id using geohive_list_layers({service: "${service}"}). Available IDs: ${metadata.layers.slice(0, 20).map((layer) => layer.id).join(", ")}.`
      });
    }
    const result = await arcgisQuery(ctx, service, {
      where,
      outFields: out_fields,
      resultRecordCount: String(limit),
      ...(order_by ? { orderByFields: order_by } : {})
    }, selected);
    const rows = result.features.slice(0, limit).map((f) => f.attributes);
    return envelope(geohiveInfo, {
      data: { service, layer_id: selected, count: rows.length, features: rows },
      url: result.url,
      cached: metadata.cached && result.cached,
      stale: metadata.stale || result.stale,
      truncated: result.exceeded || result.features.length > limit
    });
  }
});

const GAZETTEER = [
  { kind: "town", service: "Centres_of_Population___OSi_National_Placenames_Gazetteer" },
  { kind: "townland", service: "Townlands___OSi_National_Placenames_Gazetteer" }
] as const;
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Gazetteer lookup: towns first, then townlands; exact English or Irish name. */
export async function locatePlace(ctx: ToolContext, name: string, limit = 5) {
  const upper = name.trim().toUpperCase().replace(/'/g, "''");
  const where = `UPPER(English_Na) = '${upper}' OR UPPER(Irish_Name) = '${upper}'`;
  for (const layer of GAZETTEER) {
    const query = new URLSearchParams({
      where,
      outFields: "English_Na,Irish_Name,County,Classifica",
      outSR: "4326",
      returnGeometry: "true",
      resultRecordCount: String(limit),
      f: "json"
    });
    const url = `${ARCGIS_BASE}/${layer.service}/FeatureServer/0/query?${query.toString()}`;
    const result = await ctx.cachedJson<{ features?: Array<{ attributes: Record<string, unknown>; geometry?: { x: number; y: number } }> }>(
      url,
      TTL,
      { label: "GeoHive gazetteer", validate: assertArcGisOk }
    );
    const places = (result.value.features ?? [])
      .filter((f) => f.geometry)
      .map((f) => ({
        name: title(f.attributes.English_Na),
        irish: str(f.attributes.Irish_Name),
        county: title(f.attributes.County),
        kind: layer.kind,
        lat: round5(f.geometry!.y),
        lon: round5(f.geometry!.x)
      }));
    if (places.length) return { places, url, cached: result.cached, stale: result.stale };
  }
  return null;
}

const locateTool = defineTool({
  name: "geohive_locate",
  example: { name: "Dingle" },
  title: "Locate an Irish place name",
  description:
    "Find coordinates for an Irish town, village or townland by English or Irish name (Tailte Éireann gazetteer). Use the lat/lon with nearby or other point tools.",
  inputSchema: {
    name: z.string().min(2).max(80).describe("Exact place name, English or Irish, e.g. 'Dingle' or 'An Daingean'."),
    limit: z.number().int().min(1).max(20).default(5)
  },
  handler: async ({ name, limit }, ctx) => {
    const found = await locatePlace(ctx, name, limit);
    if (!found) {
      throw new ToolError("NOT_FOUND", `No town or townland named "${name}" in the gazetteer.`, {
        hint: "Check spelling, drop 'Co.' or suffixes like 'town', or try the Irish name."
      });
    }
    return envelope(geohiveInfo, { data: { count: found.places.length, places: found.places }, url: found.url, cached: found.cached, stale: found.stale });
  }
});

export const geohiveModule: SourceModule = {
  info: geohiveInfo,
  summary: "Boundaries and geography: which county, constituency, electoral division or small area a point is in; GeoHive layers.",
  domain: "places/property",
  coverage: "Republic of Ireland statutory boundaries: counties, local authorities, constituencies, electoral divisions, small areas and settlements.",
  tools: [boundariesTool, locateTool, listLayersTool, queryLayerTool]
};
