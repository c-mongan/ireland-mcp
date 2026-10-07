import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { bathingTools } from "./bathing.js";

const WFD_BASE = "https://wfdapi.edenireland.ie/api";
const TTL = DAY;

export const epaInfo: SourceInfo = {
  id: "epa",
  name: "EPA Ireland open data",
  licence: "Creative Commons Attribution 4.0",
  attribution: "Water Framework Directive and bathing-water open data © Environmental Protection Agency Ireland.",
  homepage: "https://data.epa.ie/api-list/"
};

interface WfdSearchResponse {
  Results?: Array<{ Name?: string; Type?: string; Organisation?: string; Code?: string; GeometryExtent?: string }>;
  Page?: number;
  Size?: number;
  Total?: number;
}

interface WfdWaterbody {
  Code?: string;
  Name?: string;
  LocalAuthority?: string;
  Type?: string;
  Rbd?: string;
  Tier1Risk?: string;
  Latitude?: number | string;
  Longitude?: number | string;
  Catchment?: Array<{ Name?: string; Code?: string }>;
  Subcatchment?: Array<{ Name?: string; Code?: string }>;
  Status?: Array<{ Code?: string; Status?: Array<{ Name?: string; Status?: string; ParentId?: string | null; AssessmentTechnique?: string; StatusConfidence?: string }> }>;
}

function compactWaterbody(value: WfdWaterbody) {
  const cycles = (value.Status ?? []).map((cycle) => ({
    cycle: cycle.Code ?? null,
    headline: (cycle.Status ?? [])
      .filter((s) => s.ParentId == null)
      .slice(0, 6)
      .map((s) => ({ name: s.Name ?? null, status: s.Status ?? null, technique: s.AssessmentTechnique || null, confidence: s.StatusConfidence || null }))
  }));
  return {
    code: value.Code ?? null,
    name: value.Name ?? null,
    type: value.Type ?? null,
    local_authority: value.LocalAuthority ?? null,
    river_basin_district: value.Rbd ?? null,
    tier1_risk: value.Tier1Risk ?? null,
    lat: typeof value.Latitude === "string" ? Number(value.Latitude) : (value.Latitude ?? null),
    lon: typeof value.Longitude === "string" ? Number(value.Longitude) : (value.Longitude ?? null),
    catchment: value.Catchment?.[0] ?? null,
    subcatchment: value.Subcatchment?.[0] ?? null,
    status_cycles: cycles.slice(-5)
  };
}

async function getJson<T>(ctx: ToolContext, url: string) {
  const result = await ctx.cachedJson<T>(url, TTL, { label: "EPA WFD" });
  return { url, value: result.value, cached: result.cached, stale: result.stale };
}

const searchTool = defineTool({
  name: "epa_wfd_search",
  title: "Search EPA WFD waterbodies",
  description: "Search EPA Water Framework Directive catchments, subcatchments and waterbodies by place, river/lake/coastal name or code.",
  example: { query: "Suir", limit: 5 },
  inputSchema: {
    query: z.string().min(2).max(100).describe("Waterbody, catchment or place keyword, e.g. 'Suir' or 'Blackwater'."),
    page: z.number().int().min(1).max(1000).default(1),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(10)
  },
  handler: async ({ query, page, limit }, ctx) => {
    const url = `${WFD_BASE}/search?${new URLSearchParams({ v: query, page: String(page), size: String(limit) }).toString()}`;
    const result = await getJson<WfdSearchResponse>(ctx, url);
    const rows = (result.value.Results ?? []).map((r) => ({
      name: r.Name ?? null,
      type: r.Type ?? null,
      organisation: r.Organisation ?? null,
      code: r.Code ?? null,
      extent: r.GeometryExtent ?? null
    }));
    const { items, truncated } = bound(rows, limit);
    return envelope(epaInfo, {
      data: { total: result.value.Total ?? rows.length, page: result.value.Page ?? page, results: items },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated: truncated || (result.value.Total ?? 0) > page * limit
    });
  }
});

const waterbodyTool = defineTool({
  name: "epa_wfd_waterbody",
  title: "Get EPA WFD waterbody status",
  description: "Get EPA Water Framework Directive metadata, risk and headline ecological/chemical status cycles for a waterbody code.",
  example: { code: "IE_SE_16B020080" },
  inputSchema: { code: z.string().regex(/^IE_[A-Z]{2}_[A-Za-z0-9_]+$/).describe("EPA WFD waterbody code, e.g. IE_SE_16B020080.") },
  handler: async ({ code }, ctx) => {
    const url = `${WFD_BASE}/waterbody/${encodeURIComponent(code)}`;
    const result = await getJson<WfdWaterbody>(ctx, url);
    if (!result.value.Code) throw new ToolError("NOT_FOUND", `No EPA WFD waterbody found for ${code}.`);
    return envelope(epaInfo, { data: compactWaterbody(result.value), url: result.url, cached: result.cached, stale: result.stale });
  }
});

export const epaModule: SourceModule = {
  info: epaInfo,
  summary: "EPA WFD waterbody status/risk plus bathing-water locations, dated samples and published restrictions.",
  domain: "environment",
  coverage: "Republic of Ireland WFD catchments and waterbodies, plus published bathing-water locations, restrictions and dated measurements from EPA open APIs.",
  tools: [searchTool, waterbodyTool, ...bathingTools],
  async search(query: string, limit: number, ctx: ToolContext): Promise<SearchHit[]> {
    const url = `${WFD_BASE}/search?${new URLSearchParams({ v: query, page: "1", size: String(limit) }).toString()}`;
    const result = await getJson<WfdSearchResponse>(ctx, url);
    return (result.value.Results ?? []).slice(0, limit).map((r) => ({ id: `${epaInfo.id}:wfd:${r.Code}`, title: `${r.Name ?? r.Code} (${r.Type ?? "WFD"})`, url }));
  },
  async fetchById(key: string, ctx: ToolContext): Promise<FetchedDocument> {
    const code = key.replace(/^wfd:/, "");
    const result = await getJson<WfdWaterbody>(ctx, `${WFD_BASE}/waterbody/${encodeURIComponent(code)}`);
    const body = compactWaterbody(result.value);
    return { id: `${epaInfo.id}:wfd:${code}`, title: `${body.name ?? code} WFD waterbody`, text: JSON.stringify(body, null, 2), url: result.url, metadata: { source: epaInfo.id, code } };
  }
};
