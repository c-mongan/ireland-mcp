import { DAY } from "../../gateway/context.js";
import { ToolError } from "../../gateway/errors.js";
import type { ToolContext } from "../../gateway/module.js";

const TTL = DAY;
const DEFAULT_CAP = 50;
const HARD_CAP = 100;

export const ARCGIS_LAYERS = {
  geohiveCounties: "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Counties___OSi_National_Statutory_Boundaries/FeatureServer/0",
  geohiveLocalAuthorities:
    "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/LocalAuthorities_NationalStatutoryBoundaries_Ungeneralised_2024/FeatureServer/0",
  geohiveDail:
    "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/ConstituencyBoundariesUngeneralised_National_Electoral_Boundaries_2023/FeatureServer/0",
  geohiveLea: "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Local_Electoral_Areas_Boundaries_Generalised_20m/FeatureServer/0",
  geohiveEd: "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/CSO_Electoral_Divisions_Generalised_20m/FeatureServer/0",
  geohiveSmallAreas: "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Small_Areas_Generalised_20m/FeatureServer/0",
  geohiveSettlements: "https://services-eu1.arcgis.com/FH5XCsx8rYXqnjF5/arcgis/rest/services/Settlements_Generalised_20m/FeatureServer/0",
  planningPoints: "https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0",
  censusSmallAreas:
    "https://services-eu1.arcgis.com/BuS9rtTsYEV5C0xh/arcgis/rest/services/SMALL_AREA_2022_Genralised_20m_view/FeatureServer/0",
  censusPopulation:
    "https://services-eu1.arcgis.com/BuS9rtTsYEV5C0xh/arcgis/rest/services/CensusHub2022_T1_1_SA/FeatureServer/0",
  smr: "https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/arcgis/rest/services/SMROpenData/FeatureServer/0",
  npwsSpa: "https://services-eu1.arcgis.com/Jhij7i46ouO8Cc0N/arcgis/rest/services/NPWSDesignatedAreas/FeatureServer/0",
  npwsPnha: "https://services-eu1.arcgis.com/Jhij7i46ouO8Cc0N/arcgis/rest/services/NPWSDesignatedAreas/FeatureServer/1",
  npwsNha: "https://services-eu1.arcgis.com/Jhij7i46ouO8Cc0N/arcgis/rest/services/NPWSDesignatedAreas/FeatureServer/2",
  npwsSac: "https://services-eu1.arcgis.com/Jhij7i46ouO8Cc0N/arcgis/rest/services/NPWSDesignatedAreas/FeatureServer/3"
} as const;

const ALLOWED = new Set<string>(Object.values(ARCGIS_LAYERS));

export interface ArcGisFeature {
  attributes: Record<string, unknown>;
  geometry?: unknown;
  centroid?: unknown;
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string; details?: string[] };
}

export interface QueryLayerOptions {
  where?: string;
  geometry?: { type: "point"; lat: number; lon: number; distance?: number } | { type: "bbox"; xmin: number; ymin: number; xmax: number; ymax: number };
  outFields?: string[];
  resultRecordCount?: number;
  returnGeometry?: false | "centroid";
  orderByFields?: string;
  /** First feature to read (ArcGIS resultOffset). Pair with a unique orderByFields for stable pages. */
  offset?: number;
  /** Raises the per-call cap above the default 100 for layers that allow it (at most 2000). */
  maxRecords?: number;
  /** Features per upstream request (default 50). */
  pageSize?: number;
  /** Cache lifetime (default one day) and a cache-key prefix, so a caller can keep its own, fresher copy. */
  ttlMs?: number;
  cachePrefix?: string;
}

/** ArcGIS's own per-request ceiling for the allowlisted hosted layers. */
export const ARCGIS_MAX_RECORDS = 2000;

function assertArcGisOk(body: ArcGisResponse): void {
  if (!body.error) return;
  const detail = [body.error.message, ...(body.error.details ?? [])].filter(Boolean).join(" ");
  if (body.error.code === 400 || body.error.code === 404) {
    throw new ToolError(body.error.code === 404 ? "NOT_FOUND" : "BAD_ARGS", `ArcGIS rejected the query: ${detail}`.slice(0, 300));
  }
  throw new ToolError("UPSTREAM_DOWN", "ArcGIS returned an upstream error.");
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function fieldEq(field: string, value: string | number): string {
  assertField(field);
  return `${field}=${typeof value === "number" ? value : sqlString(value)}`;
}

export function fieldLike(field: string, value: string): string {
  assertField(field);
  const clean = value.trim().replace(/[%_]/g, "").slice(0, 80);
  if (!clean) return "1=1";
  return `${field} LIKE ${sqlString(`%${clean}%`)}`;
}

export function dateClause(field: string, op: ">=" | "<=", yyyyMmDd: string): string {
  assertField(field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) throw new ToolError("BAD_ARGS", "Dates must be YYYY-MM-DD.");
  return `${field} ${op} DATE ${sqlString(yyyyMmDd)}`;
}

export function andWhere(parts: Array<string | undefined | null | false>): string {
  const valid = parts.filter(Boolean) as string[];
  return valid.length ? valid.map((p) => `(${p})`).join(" AND ") : "1=1";
}

export function orWhere(parts: Array<string | undefined | null | false>): string {
  const valid = parts.filter(Boolean) as string[];
  return valid.length ? valid.map((p) => `(${p})`).join(" OR ") : "1=0";
}

export function assertField(field: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) throw new ToolError("BAD_ARGS", `Invalid ArcGIS field "${field}".`);
}

function normalizeLayerUrl(layerUrl: string): string {
  const trimmed = layerUrl.replace(/\/+$/, "");
  if (!ALLOWED.has(trimmed)) throw new ToolError("BAD_ARGS", "ArcGIS layer is not allowlisted.");
  return trimmed;
}

function paramsForGeometry(geometry: QueryLayerOptions["geometry"]): Record<string, string> {
  if (!geometry) return {};
  if (geometry.type === "point") {
    return {
      geometry: `${geometry.lon},${geometry.lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      ...(geometry.distance ? { distance: String(Math.min(Math.max(geometry.distance, 1), 20_000)), units: "esriSRUnit_Meter" } : {})
    };
  }
  return {
    geometry: `${geometry.xmin},${geometry.ymin},${geometry.xmax},${geometry.ymax}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects"
  };
}

export async function queryLayer(ctx: ToolContext, layerUrl: string, options: QueryLayerOptions) {
  const base = normalizeLayerUrl(layerUrl);
  const hardCap = Math.min(Math.max(options.maxRecords ?? HARD_CAP, 1), ARCGIS_MAX_RECORDS);
  const cap = Math.min(Math.max(options.resultRecordCount ?? DEFAULT_CAP, 1), hardCap);
  const pageSize = Math.min(cap, Math.max(1, options.pageSize ?? DEFAULT_CAP), ARCGIS_MAX_RECORDS);
  const start = Math.max(0, Math.floor(options.offset ?? 0));
  const features: ArcGisFeature[] = [];
  let exceeded = false;
  let transferLimit = false;
  let cached = true;
  let stale = false;
  let lastUrl = "";

  for (let offset = start; features.length < cap; offset += pageSize) {
    const query = new URLSearchParams({
      f: "json",
      where: options.where ?? "1=1",
      outFields: options.outFields?.join(",") ?? "*",
      resultRecordCount: String(Math.min(pageSize, cap - features.length)),
      resultOffset: String(offset),
      returnGeometry: options.returnGeometry === "centroid" ? "true" : "false",
      ...(options.returnGeometry === "centroid" ? { returnCentroid: "true", outSR: "4326" } : {}),
      ...paramsForGeometry(options.geometry),
      ...(options.orderByFields ? { orderByFields: options.orderByFields } : {})
    });
    lastUrl = `${base}/query?${query.toString()}`;
    const result = await ctx.cachedJson<ArcGisResponse>(lastUrl, options.ttlMs ?? TTL, {
      label: "ArcGIS",
      validate: assertArcGisOk,
      ...(options.cachePrefix ? { cacheKey: `${options.cachePrefix} ${lastUrl}` } : {})
    });
    cached &&= result.cached;
    stale ||= result.stale;
    const page = result.value.features ?? [];
    features.push(...page);
    exceeded ||= Boolean(result.value.exceededTransferLimit);
    transferLimit = Boolean(result.value.exceededTransferLimit);
    if (!result.value.exceededTransferLimit || page.length === 0) break;
  }

  /** transferLimit: ArcGIS's own flag on the last page, true when more features follow it. */
  return { url: lastUrl, features, exceeded: exceeded || features.length >= cap, transferLimit, cached, stale };
}


interface ArcGisCountResponse {
  count?: number;
  error?: ArcGisResponse["error"];
}

/** Exact number of features matching a filter (ArcGIS returnCountOnly), through the cache. */
export async function countLayer(ctx: ToolContext, layerUrl: string, options: Pick<QueryLayerOptions, "where" | "geometry" | "ttlMs" | "cachePrefix">) {
  const base = normalizeLayerUrl(layerUrl);
  const query = new URLSearchParams({ f: "json", where: options.where ?? "1=1", returnCountOnly: "true", ...paramsForGeometry(options.geometry) });
  const url = `${base}/query?${query.toString()}`;
  const result = await ctx.cachedJson<ArcGisCountResponse>(url, options.ttlMs ?? TTL, {
    label: "ArcGIS",
    ...(options.cachePrefix ? { cacheKey: `${options.cachePrefix} ${url}` } : {}),
    validate: (body) => {
      assertArcGisOk(body);
      if (typeof body.count !== "number" || !Number.isInteger(body.count) || body.count < 0) {
        throw new ToolError("UPSTREAM_DOWN", "ArcGIS returned no feature count.");
      }
    }
  });
  return { url, count: result.value.count as number, cached: result.cached, stale: result.stale };
}

export interface LayerStatistic {
  type: "count" | "sum" | "avg" | "min" | "max";
  field: string;
  as: string;
}

/** Server-side ArcGIS statistics (outStatistics), optionally grouped by allowlisted fields. */
export async function statsLayer(
  ctx: ToolContext,
  layerUrl: string,
  options: Pick<QueryLayerOptions, "where" | "geometry"> & { statistics: LayerStatistic[]; groupBy?: string[]; maxGroups?: number }
) {
  const base = normalizeLayerUrl(layerUrl);
  for (const s of options.statistics) {
    assertField(s.field);
    assertField(s.as);
  }
  for (const g of options.groupBy ?? []) assertField(g);
  const outStatistics = options.statistics.map((s) => ({ statisticType: s.type, onStatisticField: s.field, outStatisticFieldName: s.as }));
  const query = new URLSearchParams({
    f: "json",
    where: options.where ?? "1=1",
    outStatistics: JSON.stringify(outStatistics),
    returnGeometry: "false",
    // ArcGIS rejects resultRecordCount on an ungrouped statistics query, which returns one row anyway.
    ...(options.groupBy?.length
      ? {
          groupByFieldsForStatistics: options.groupBy.join(","),
          orderByFields: options.groupBy.join(","),
          resultRecordCount: String(Math.min(Math.max(options.maxGroups ?? 500, 1), ARCGIS_MAX_RECORDS))
        }
      : {}),
    ...paramsForGeometry(options.geometry)
  });
  const url = `${base}/query?${query.toString()}`;
  const result = await ctx.cachedJson<ArcGisResponse>(url, TTL, {
    label: "ArcGIS",
    validate: (body) => {
      assertArcGisOk(body);
      if (!Array.isArray(body.features)) throw new ToolError("UPSTREAM_DOWN", "ArcGIS returned no statistics.");
    }
  });
  return {
    url,
    groups: (result.value.features ?? []).map((f) => f.attributes),
    exceeded: Boolean(result.value.exceededTransferLimit),
    cached: result.cached,
    stale: result.stale
  };
}
