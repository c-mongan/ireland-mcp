import { z } from "zod";
import { MINUTE } from "../../gateway/context.js";
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

/** Only documented pagination/season routes: no invented beach or date filters. */
export const bathingTools = [
  { name: "epa_bathing_locations", title: "EPA bathing-water locations", route: "locations", key: "locations",
    description: "Browse EPA bathing-water locations with annual classifications. Paginated; annual classifications are not current swimming-safety advice.",
    fields: [...common, "local_authority_name", "beach_type", "easting", "northing", "annual_water_quality_assessment", "next_monitoring_date", "beach_profile_url"],
    caveat: "Annual classifications cover multiple years; check dated samples and published restrictions separately." },
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
