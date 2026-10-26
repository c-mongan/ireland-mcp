import { z } from "zod";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { DAY } from "../../gateway/context.js";
import { assertInIreland } from "../geohive/index.js";
import { ToolError } from "../../gateway/errors.js";
import { gsiCard } from "./card.js";

const LAYER = "https://gsi.geodata.gov.ie/server/rest/services/Groundwater/IE_GSI_Groundwater_Vulnerability_40K_IE26_ITM/MapServer/0";
const responseSchema = z.object({
  features: z.array(z.object({ attributes: z.object({
    VUL40KID: z.string().trim().min(1).max(25),
    VUL_CAT: z.string().trim().min(1).max(10),
    VUL_DESC: z.string().trim().min(1).max(40)
  }) })).max(2000),
  exceededTransferLimit: z.boolean().optional(),
  error: z.never().optional()
});

export const gsiInfo: SourceInfo = {
  id: "gsi",
  name: "Geological Survey Ireland",
  licence: "CC BY 4.0",
  attribution: "Contains Irish Public Sector Data (Geological Survey Ireland) licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence",
  homepage: "https://data.gov.ie/dataset/groundwater-vulnerability-140000-ireland-roi-itm"
};
export const gsiModule: SourceModule = {
  info: gsiInfo,
  summary: "Groundwater vulnerability map categories at a WGS84 point.",
  domain: "environment", card: gsiCard,
  coverage: "Republic of Ireland groundwater vulnerability polygons at map scale 1:40000. Dataset revision is unknown.",
  tools: [defineTool({
    name: "groundwater_vulnerability_at",
    title: "Groundwater vulnerability at a point",
    description: "Look up GSI groundwater vulnerability polygons containing a WGS84 point. Map scale 1:40000. Use for screening; this is not a site investigation or engineering approval.",
    inputSchema: { lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), limit: z.number().int().min(1).max(10).default(10) },
    example: { lat: 53.3498, lon: -6.2603 },
    handler: async ({ lat, lon, limit }, ctx) => {
      assertInIreland(lat, lon);
      const params = new URLSearchParams({ f: "json", where: "1=1", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "VUL40KID,VUL_CAT,VUL_DESC", returnGeometry: "false", resultRecordCount: String(limit) });
      const url = `${LAYER}/query?${params}`;
      // Store the fetch time with validated data so cache hits cannot look newly retrieved.
      // The versioned key prevents reuse of older cache entries without this evidence.
      const result = await ctx.cache.getOrLoad(`gsi:groundwater:v1:${url}`, DAY, async () => {
        const value = await ctx.http.json<unknown>(url, { label: "GSI", timeoutMs: 10_000 });
        const parsed = responseSchema.safeParse(value);
        if (!parsed.success) {
          throw new ToolError("UPSTREAM_DOWN", "GSI returned an error or invalid groundwater vulnerability data.", { retryable: false });
        }
        return { body: parsed.data, retrievedAt: ctx.now().toISOString() };
      });
      const areas = result.value.body.features.slice(0, limit).map(({ attributes: a }) => ({ id: a.VUL40KID, category: a.VUL_CAT, description: a.VUL_DESC }));
      const truncated = result.value.body.exceededTransferLimit === true || result.value.body.features.length > limit;
      return envelope(gsiInfo, {
        data: { status: areas.length ? "matched" : truncated ? "incomplete" : "outside_coverage", areas, map_scale: "1:40000", dataset_revision: null, limitation: "Use for screening. This map does not replace a site investigation or provide engineering approval." },
        url, cached: result.cached, stale: result.stale, retrievedAt: new Date(result.value.retrievedAt), truncated
      });
    }
  })]
};
