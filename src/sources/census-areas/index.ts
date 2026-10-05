import { z } from "zod";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { assertInIreland } from "../geohive/index.js";
import { ARCGIS_LAYERS, fieldEq, queryLayer } from "../arcgis/client.js";

export const censusAreasInfo: SourceInfo = {
  id: "census-areas",
  name: "CSO Census 2022 small areas (ArcGIS)",
  licence: "CC BY 4.0",
  attribution: "© Tailte Éireann / OSi and Central Statistics Office.",
  homepage: "https://data-osi.opendata.arcgis.com/datasets/osi::cso-small-areas-national-statistical-boundaries-2022-generalised-20m"
};

const str = (value: unknown) => (typeof value === "string" ? value.trim() || null : value == null ? null : String(value));
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export async function smallAreaAt(ctx: ToolContext, lat: number, lon: number) {
  assertInIreland(lat, lon);
  const boundary = await queryLayer(ctx, ARCGIS_LAYERS.censusSmallAreas, {
    where: "1=1",
    geometry: { type: "point", lat, lon },
    outFields: ["SA_PUB2022", "SA_GEOGID_2022", "ED_ENGLISH", "ED_ID_STR", "COUNTY_ENGLISH", "COUNTY_CODE", "CSO_LEA", "SA_NUTS3_NAME"],
    resultRecordCount: 1,
    returnGeometry: false
  });
  const attrs = boundary.features[0]?.attributes;
  if (!attrs) return { result: null, cached: boundary.cached, stale: boundary.stale, url: boundary.url };
  const geogid = str(attrs.SA_GEOGID_2022);
  const population = geogid
    ? await queryLayer(ctx, ARCGIS_LAYERS.censusPopulation, {
        where: fieldEq("SA_GEOGID_2022", geogid),
        outFields: ["SA_GEOGID_2022", "T1_1AGETT", "T1_1AGETM", "T1_1AGETF", "GEOGDESC", "LOCAL_AUTHORITY", "COUNTY", "NUTS3_NAME"],
        resultRecordCount: 1,
        returnGeometry: false
      })
    : null;
  const pop = population?.features[0]?.attributes;
  return {
    result: {
      small_area: {
        code: str(attrs.SA_PUB2022),
        geogid,
        name: str(pop?.GEOGDESC) ?? str(attrs.SA_PUB2022),
        population: num(pop?.T1_1AGETT),
        male: num(pop?.T1_1AGETM),
        female: num(pop?.T1_1AGETF)
      },
      electoral_division: { code: str(attrs.ED_ID_STR), name: str(attrs.ED_ENGLISH) },
      county: { code: str(attrs.COUNTY_CODE), name: str(pop?.COUNTY) ?? str(attrs.COUNTY_ENGLISH) },
      local_authority: str(pop?.LOCAL_AUTHORITY),
      nuts3: str(pop?.NUTS3_NAME) ?? str(attrs.SA_NUTS3_NAME)
    },
    cached: boundary.cached && (population?.cached ?? true),
    stale: boundary.stale || (population?.stale ?? false),
    url: population?.url ?? boundary.url
  };
}

const tool = defineTool({
  name: "census_small_area_at",
  title: "Census small area at a location",
  description: "Return the Census 2022 small area, electoral division, county and total population for a WGS84 point in Ireland.",
  example: { lat: 53.3498, lon: -6.2603 },
  inputSchema: {
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180)
  },
  handler: async ({ lat, lon }, ctx) => {
    const result = await smallAreaAt(ctx, lat, lon);
    return envelope(censusAreasInfo, { data: { lat, lon, area: result.result }, url: result.url, cached: result.cached, stale: result.stale });
  }
});

export const censusAreasModule: SourceModule = {
  info: censusAreasInfo,
  summary: "Census 2022 Small Area, ED, county and population at a point.",
  domain: "stats",
  coverage: "Republic of Ireland Census 2022 small areas and population table 1.1.",
  tools: [tool]
};
