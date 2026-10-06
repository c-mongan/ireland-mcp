import { z } from "zod";
import { ToolError } from "../../gateway/errors.js";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";

const RESOURCE_ID = "0806f07b-b514-4769-bd3d-649da87ad205";
const API = "https://data.gov.ie/api/3/action/datastore_search";
const TTL = DAY;

export const pobalInfo: SourceInfo = {
  id: "pobal",
  name: "Pobal HP Deprivation Index",
  licence: "Creative Commons Attribution 4.0",
  attribution: "Pobal HP Deprivation Index Scores 2022 © Pobal.",
  homepage: "https://data.gov.ie/dataset/pobal-hp-deprivation-index-scores-2022"
};

interface CkanEnvelope<T> { success: boolean; result?: T; error?: { message?: string } }
interface DatastoreResult { total?: number; records?: Array<Record<string, unknown>> }
function value(body: CkanEnvelope<DatastoreResult>): DatastoreResult {
  if (body?.success !== true || !body.result || !Array.isArray(body.result.records)) {
    throw new ToolError("UPSTREAM_DOWN", "Pobal HP returned an invalid or unsuccessful response.");
  }
  return body.result;
}
function n(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const out = Number(v.replace(/,/g, "")); return Number.isFinite(out) ? out : null; }
  return null;
}
function compact(r: Record<string, unknown>) {
  return {
    ed_id: String(r.ED_ID_STR ?? ""),
    electoral_division: String(r.ED_ENGLISH ?? ""),
    population_2022: n(r.TOTPOP22),
    relative_score_2022: n(r.Index22_ED_std_rel_wt),
    absolute_score_2022: n(r.Index22_ED_std_abs_wt),
    deprivation_category: n(r.Index22_ED_rel_wt_cat),
    deprivation_label: String(r.Index22_ED_rel_wt_lab ?? "")
  };
}
async function query(ctx: ToolContext, params: URLSearchParams) {
  const url = `${API}?${params.toString()}`;
  const result = await ctx.cachedJson<CkanEnvelope<DatastoreResult>>(url, TTL, { label: "Pobal HP", validate: value });
  return { url, value: value(result.value), cached: result.cached, stale: result.stale };
}

const searchTool = defineTool({
  name: "pobal_deprivation_search",
  title: "Search Pobal deprivation scores",
  description: "Search 2022 Pobal HP Deprivation Index electoral-division scores by ED id or name.",
  example: { query: "Galvone", limit: 5 },
  inputSchema: {
    query: z.string().min(2).max(120).describe("Electoral division name or ED id, e.g. 'Galvone' or '128020'."),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(10)
  },
  handler: async ({ query: q, limit }, ctx) => {
    const params = new URLSearchParams({ resource_id: RESOURCE_ID, q, limit: String(limit) });
    const result = await query(ctx, params);
    const records = (result.value.records ?? []).map(compact);
    const { items, truncated } = bound(records, limit);
    return envelope(pobalInfo, { data: { total: result.value.total ?? records.length, areas: items }, url: result.url, cached: result.cached, stale: result.stale, truncated: truncated || (result.value.total ?? 0) > items.length });
  }
});

export const pobalModule: SourceModule = {
  info: pobalInfo,
  summary: "2022 Pobal HP Deprivation Index scores by electoral division.",
  domain: "stats",
  coverage: "Republic of Ireland electoral divisions, 2022 deprivation index scores from Pobal via data.gov.ie datastore.",
  tools: [searchTool],
  async search(queryText: string, limit: number, ctx: ToolContext): Promise<SearchHit[]> {
    const result = await query(ctx, new URLSearchParams({ resource_id: RESOURCE_ID, q: queryText, limit: String(limit) }));
    return (result.value.records ?? []).slice(0, limit).map((r) => {
      const area = compact(r);
      return { id: `${pobalInfo.id}:${area.ed_id}`, title: `${area.electoral_division}: ${area.deprivation_label}`, url: pobalInfo.homepage };
    });
  },
  async fetchById(key: string, ctx: ToolContext): Promise<FetchedDocument> {
    const result = await query(ctx, new URLSearchParams({ resource_id: RESOURCE_ID, filters: JSON.stringify({ ED_ID_STR: key }), limit: "1" }));
    const record = result.value.records?.[0];
    if (!record) throw new ToolError("NOT_FOUND", "No Pobal electoral division matches this id.");
    const area = compact(record);
    return { id: `${pobalInfo.id}:${key}`, title: `${area.electoral_division || key} deprivation score`, text: JSON.stringify(area, null, 2), url: result.url, metadata: { source: pobalInfo.id } };
  }
};
