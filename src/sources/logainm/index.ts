import { ToolError } from "../../gateway/errors.js";
import { DAY } from "../../gateway/context.js";
import { z } from "zod";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { DEFAULT_LIMIT, MAX_LIMIT, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { logainmCard } from "./card.js";
// Official contracts: https://docs.gaois.ie/en/data/logainm/v1.0/api
// Schema: https://docs.gaois.ie/en/data/logainm/v1.0/data
// Header auth: https://docs.gaois.ie/en/data/getting-started
// Licence: https://docs.gaois.ie/en/data/logainm/v1.0/licence
export const logainmInfo: SourceInfo = {
  id: "logainm", name: "Logainm Placenames Database of Ireland", licence: "CC BY 4.0",
  attribution: "Irish-language placename data by Logainm © Government of Ireland and licensed under CC BY 4.0.",
  homepage: "https://www.logainm.ie"
};
const id = z.number().int().positive();
const timestamp = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
const nullableText = z.string().nullable().optional();
const category = z.object({ ID: z.string(), NameEN: nullableText, NameGA: nullableText });
const placeSchema = z.object({
  ID: id, Permalink: z.string().url(), DateCreated: timestamp, DateModified: timestamp.nullable().optional(),
  ReplacementID: id.nullable().optional(),
  Placenames: z.array(z.object({ ID: id, Language: nullableText, Wording: z.string().trim().min(1), Main: z.boolean() })).min(1),
  IncludedIn: z.array(z.object({ ID: id, NameEN: nullableText, NameGA: nullableText, Category: category.nullable().optional() })).optional(),
  Geography: z.object({ Accurate: z.boolean(), Coordinates: z.array(z.object({
    Latitude: z.number().min(-90).max(90), Longitude: z.number().min(-180).max(180)
  })).min(1) }).nullable().optional()
});
const pageSchema = z.object({
  TotalCount: z.number().int().nonnegative(), TotalPages: z.number().int().nonnegative(),
  CurrentPage: z.number().int().positive(), CountPerPage: z.number().int().positive().max(1000),
  Results: z.array(placeSchema)
});
// The dictionary uses PascalCase; JSON serializers can emit camelCase (v1 changelog uses "results").
const fields = new Map([
  "ID", "Permalink", "DateCreated", "DateModified", "ReplacementID", "Placenames", "Language", "Wording", "Main",
  "IncludedIn", "NameEN", "NameGA", "Category", "Geography", "Accurate", "Coordinates", "Latitude", "Longitude",
  "TotalCount", "TotalPages", "CurrentPage", "CountPerPage", "Results"
].map(key => [key.toLowerCase(), key]));
function dictionaryKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dictionaryKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [fields.get(key.toLowerCase()) ?? key, dictionaryKeys(item)]));
}
const normalisePlace = (p: z.infer<typeof placeSchema>) => ({
  id: p.ID, url: p.Permalink, replacement_id: p.ReplacementID ?? null,
  created_at: p.DateCreated, modified_at: p.DateModified ?? null,
  names: p.Placenames.map(n => ({ id: n.ID, language: n.Language ?? null, wording: n.Wording, main: n.Main })),
  included_in: (p.IncludedIn ?? []).map(u => ({ id: u.ID, name_en: u.NameEN ?? null, name_ga: u.NameGA ?? null, category_id: u.Category?.ID ?? null })),
  geography: p.Geography ? { accurate: p.Geography.Accurate, coordinates: p.Geography.Coordinates.map(c => ({ latitude: c.Latitude, longitude: c.Longitude })) } : null
});

export const logainmModule: SourceModule = {
  info: logainmInfo, domain: "places/property", card: logainmCard,
  summary: "Irish and English placenames (requires a server-side Gaois API key).",
  coverage: "Placenames Database of Ireland: bilingual names, containing administrative units and coordinate accuracy. Exact, accent-sensitive search; server-side LOGAINM_API_KEY required.",
  tools: [defineTool({
    name: "logainm_search_places", title: "Search Irish placenames",
    description: "Search the Logainm placenames database. Searches are accent sensitive and exact; requires LOGAINM_API_KEY.",
    inputSchema: {
      query: z.string().trim().min(1).max(200),
      place_id: id.optional().describe("Containing place identifier; county IDs are listed by Logainm's counties endpoint."),
      page: z.number().int().min(1).max(10000).default(1),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT)
    },
    handler: async ({ query, place_id, page, limit }, ctx) => {
      if (!ctx.env.LOGAINM_API_KEY?.trim()) throw new ToolError("NOT_CONFIGURED", "Logainm is not configured on this server.", {
        hint: "The operator must register at the Gaois Developer Hub and set LOGAINM_API_KEY. See https://docs.gaois.ie/en/data/getting-started."
      });
      const url = new URL("https://www.logainm.ie/api/v1.0/");
      url.searchParams.set("Query", query);
      url.searchParams.set("Page", String(page));
      url.searchParams.set("PerPage", String(limit));
      if (place_id !== undefined) url.searchParams.set("PlaceID", String(place_id));
      const r = await ctx.cache.getOrLoad(`logainm:places:v3:${url}`, DAY, async () => {
        let raw: unknown;
        try {
          raw = await ctx.http.json(url.toString(), {
            headers: { "X-Api-Key": ctx.env.LOGAINM_API_KEY!.trim() }, label: "Logainm",
            maxBytes: 4 * 1024 * 1024, timeoutMs: 15000
          });
        } catch (error) {
          // HttpClient may include an upstream 400 reason. Never expose reflected credentials.
          if (error instanceof ToolError && error.code === "BAD_ARGS") {
            throw new ToolError("BAD_ARGS", "Logainm rejected the request parameters.", {
              hint: "Check the query, containing place ID and page number against the Logainm API documentation."
            });
          }
          throw error;
        }
        const result = pageSchema.safeParse(dictionaryKeys(raw));
        if (!result.success || result.data.CurrentPage !== page || result.data.CountPerPage !== limit
          || result.data.TotalPages !== Math.ceil(result.data.TotalCount / limit)
          || (result.data.Results.length !== Math.max(0, Math.min(limit, result.data.TotalCount - (page - 1) * limit)))
          || result.data.Results.length > limit || result.data.Results.length > result.data.TotalCount) throw new ToolError("UPSTREAM_DOWN", "Logainm returned malformed place data.", { retryable: false });
        return { ...result.data, retrievedAt: ctx.now().toISOString() };
      });
      return envelope(logainmInfo, {
        url: url.toString(), cached: r.cached, stale: r.stale, retrievedAt: new Date(r.value.retrievedAt),
        truncated: r.value.CurrentPage < r.value.TotalPages,
        data: { total: r.value.TotalCount, page: r.value.CurrentPage,
          next_page: r.value.CurrentPage < r.value.TotalPages ? r.value.CurrentPage + 1 : null,
          places: r.value.Results.map(normalisePlace) }
      });
    }
  })]
};
