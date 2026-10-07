import { z } from "zod";
import { HOUR, MINUTE } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool } from "../../gateway/module.js";

const BASE = "https://data.epa.ie/bw/api/v1";
const info: SourceInfo = {
  id: "epa", name: "EPA Ireland bathing water", licence: "Creative Commons Attribution 4.0",
  attribution: "Bathing water open data © Environmental Protection Agency Ireland.",
  homepage: "https://data.epa.ie/api-list/bathing-water-open-data/"
};
interface Page { count: number; page: number; list: Array<Record<string, unknown>> }
const pagination = {
  page: z.number().int().min(1).max(10000).default(1),
  limit: z.number().int().min(1).max(50).default(10)
};
const pick = (row: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.map((key) => [key, row[key] ?? null]));
const common = ["beach_id", "beach_name", "county_name"];

const fold = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const locationFields = [...common, "local_authority_name", "beach_type", "easting", "northing", "annual_water_quality_assessment", "has_all_season_bathing_restriction_in_place", "reason_for_all_season_bathing_restriction", "next_monitoring_date", "beach_profile_url"];
/** The whole register is ~250 beaches (~0.8 MB), so it is read once and filtered locally. */
const ALL_LOCATIONS = 500;
const MAX_LOCATION_PAGES = 4;

const locationsTool = defineTool({
  name: "epa_bathing_locations", title: "EPA bathing-water locations",
  description: "Find EPA bathing-water locations (beaches and lakes) with their annual water-quality classification. Filter by beach name (e.g. 'Salthill') and/or county; page with offset and next_offset. Annual classifications are not current swimming-safety advice; check epa_bathing_alerts too.",
  example: { name: "Salthill", county: "Galway" },
  inputSchema: {
    name: z.string().min(2).max(80).optional().describe("Part of the beach name, accents optional, e.g. 'Salthill'."),
    county: z.string().min(2).max(40).optional().describe("County, e.g. 'Galway'."),
    offset: z.number().int().min(0).max(10000).optional().describe("Rows to skip; use next_offset from the previous result."),
    page: z.number().int().min(1).max(10000).default(1).describe("1-based page of `limit` rows; ignored when offset is set."),
    limit: z.number().int().min(1).max(50).default(10)
  },
  handler: async ({ name, county, offset, page, limit }, ctx) => {
    const first = `${BASE}/locations?${new URLSearchParams({ page: "1", per_page: String(ALL_LOCATIONS) })}`;
    const head = await ctx.cachedJson<Page>(first, HOUR, { label: "EPA bathing water", validate: validatePage });
    const rows = [...head.value.list];
    let { cached, stale } = head;
    for (let next = 2; rows.length < head.value.count && next <= MAX_LOCATION_PAGES; next += 1) {
      const more = await ctx.cachedJson<Page>(`${BASE}/locations?${new URLSearchParams({ page: String(next), per_page: String(ALL_LOCATIONS) })}`, HOUR, { label: "EPA bathing water", validate: validatePage });
      if (!more.value.list.length) break;
      rows.push(...more.value.list);
      cached &&= more.cached;
      stale ||= more.stale;
    }
    const matches = rows.filter((r) => (!name || fold(r.beach_name).includes(fold(name))) && (!county || fold(r.county_name).includes(fold(county))));
    const start = offset ?? (page - 1) * limit;
    const slice = matches.slice(start, start + limit);
    const end = start + slice.length;
    return envelope(info, {
      data: {
        total: matches.length,
        register_total: head.value.count,
        offset: start,
        next_offset: end < matches.length ? end : null,
        locations: slice.map((r) => pick(r, locationFields)),
        caveat: "Annual classifications cover multiple years; inspect season-long restrictions here as well as dated samples, incidents and local notices."
      },
      url: first, cached, stale,
      truncated: end < matches.length || rows.length < head.value.count
    });
  }
});

/** Alerts and samples use only the documented pagination/season routes: no invented beach or date filters. */
export const bathingTools = [
  { name: "epa_bathing_alerts", title: "EPA bathing-water restrictions", route: "alerts", key: "alerts",
    description: "Browse published EPA bathing-water incidents and restrictions with update dates. An empty page does not establish swimming safety; check local notices.",
    fields: [...common, "incident_id", "has_bathing_restriction_in_place", "incident_start_date", "incident_end_date", "incident_expected_duration", "bathing_restriction_type", "incident_description", "bathing_notice_pdf", "last_updated"],
    caveat: "Published alerts have limited coverage; absence of an alert is not a guarantee of safe swimming. Check dates, stale flags and local notices." }
].map((config) => defineTool({
  name: config.name, title: config.title, description: config.description,
  example: { page: 1, limit: 5 }, inputSchema: pagination,
  handler: async ({ page, limit }, ctx) => {
    const url = `${BASE}/${config.route}?${new URLSearchParams({ page: String(page), per_page: String(limit) })}`;
    const result = await ctx.cachedJson<Page>(url, 5 * MINUTE, { label: "EPA bathing water", validate: validatePage });
    return envelope(info, { data: { total: result.value.count, page: result.value.page, [config.key]: result.value.list.slice(0, limit).map((r) => pick(r, config.fields)), caveat: config.caveat },
      url, cached: result.cached, stale: result.stale, truncated: result.value.count > page * limit || result.value.list.length > limit });
  }
}));

function validatePage(value: Page) {
  if (!value || !Array.isArray(value.list) || !Number.isInteger(value.count) || value.count < 0 || !Number.isInteger(value.page) || value.page < 1 || value.list.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
    throw new ToolError("UPSTREAM_DOWN", "EPA bathing-water API returned an invalid page.");
  }
}

bathingTools.unshift(locationsTool);

bathingTools.push(defineTool({
  name: "epa_bathing_measurements", title: "EPA bathing-water samples",
  description: "Browse dated EPA bathing-water samples, optionally in-season or out-of-season. Pages are not guaranteed to contain the latest samples. No beach/date filter is documented.",
  example: { season: "out-season", page: 1, limit: 5 },
  inputSchema: { ...pagination, season: z.enum(["all", "in-season", "out-season"]).default("all") },
  handler: async ({ page, limit, season }, ctx) => {
    const route = season === "all" ? "measurements" : `measurements/${season}`;
    const url = `${BASE}/${route}?${new URLSearchParams({ page: String(page), per_page: String(limit) })}`;
    const result = await ctx.cachedJson<Page>(url, 5 * MINUTE, { label: "EPA bathing water", validate: validatePage });
    return envelope(info, { data: { total: result.value.count, page: result.value.page, season,
      measurements: result.value.list.slice(0, limit).map((r) => pick(r, [...common, "monitoring_result_id", "sample_code", "result_date", "e_coli_result", "intestinal_enterococci_result", "sample_water_quality_status"])),
      caveat: "Inspect result_date: these pages are not guaranteed to contain the latest samples and do not establish current swimming safety." },
      url, cached: result.cached, stale: result.stale, truncated: result.value.count > page * limit || result.value.list.length > limit });
  }
}));
