import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { assertInIreland } from "../geohive/index.js";
import { ARCGIS_LAYERS, queryLayer } from "../arcgis/client.js";

export const heritageInfo: SourceInfo = {
  id: "heritage",
  name: "National Monuments Service SMR",
  licence: "CC BY 4.0",
  attribution: "© National Monuments Service / Department of Housing.",
  homepage: "https://maps.archaeology.ie/historicenvironment"
};

const fields = ["SMRS", "COUNTY", "TOWNLAND", "MONUMENT_CLASS", "WEBSITE_LINK", "LATITUDE", "LONGITUDE"];
const str = (value: unknown) => (typeof value === "string" ? value.trim() || null : value == null ? null : String(value));

const tool = defineTool({
  name: "heritage_monuments_near",
  title: "Sites and Monuments Record near a point",
  description: "Find National Monuments Service Sites and Monuments Record (SMR) points near a WGS84 location.",
  example: { lat: 53.3498, lon: -6.2603, radius_m: 1000, limit: 10 },
  inputSchema: {
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_m: z.number().int().min(1).max(20_000).default(1000),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(20)
  },
  handler: async ({ lat, lon, radius_m, limit }, ctx) => {
    assertInIreland(lat, lon);
    const result = await queryLayer(ctx, ARCGIS_LAYERS.smr, {
      where: "1=1",
      geometry: { type: "point", lat, lon, distance: radius_m },
      outFields: fields,
      resultRecordCount: limit,
      returnGeometry: false
    });
    const monuments = result.features.slice(0, limit).map((f) => ({
      smr: str(f.attributes.SMRS),
      county: str(f.attributes.COUNTY),
      townland: str(f.attributes.TOWNLAND),
      class: str(f.attributes.MONUMENT_CLASS),
      lat: f.attributes.LATITUDE,
      lon: f.attributes.LONGITUDE,
      url: str(f.attributes.WEBSITE_LINK)
    }));
    return envelope(heritageInfo, {
      data: { count: monuments.length, monuments },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated: result.exceeded || result.features.length > limit
    });
  }
});

export const heritageModule: SourceModule = {
  info: heritageInfo,
  summary: "Sites and Monuments Record (SMR) points near a location.",
  domain: "places/property",
  coverage: "Republic of Ireland archaeological monument point records from the National Monuments Service.",
  tools: [tool]
};
