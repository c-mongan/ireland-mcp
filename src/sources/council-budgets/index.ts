import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { BUDGET_RESOURCES, budgetResourceForYear, budgetResourceUrl, DATASET_URL, isAllowedBudgetUrl, MANIFEST_OBSERVED_AT } from "./manifest.js";
import { canonicalAuthorityName, parseBudgetWorkbook, type ParsedBudget } from "./parser.js";

export const councilBudgetsInfo: SourceInfo = {
  id: "council-budgets",
  name: "Local Authority and Regional Assembly Annual Budgets",
  licence: "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)",
  attribution: "Source: Department of Housing, Local Government and Heritage, Local Authority and Regional Assembly Annual Budgets. Licensed under CC BY-SA 4.0.",
  homepage: DATASET_URL
};

const rowLimit = z.number().int().min(1).max(MAX_LIMIT).default(30).describe("Maximum budget rows to return (1–500).");
const yearSchema = z.number().int().min(2013).max(2026).describe("Budget year from council_budgets_list_years.");
const offsetSchema = z.number().int().min(0).max(20_000).default(0).describe("Zero-based row offset for the next page.");
const divisions = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const cacheTtlMs = 24 * 60 * 60 * 1000;

function loadBudget(year: number, ctx: ToolContext) {
  const resource = budgetResourceForYear(year);
  if (!resource) throw new ToolError("NOT_FOUND", `No annual budget resource is listed for ${year}.`);
  if (!resource.supported) {
    throw new ToolError("NOT_FOUND", `The ${year} budget workbook is listed but its legacy layout is not supported.`, {
      hint: resource.reason
    });
  }
  const url = budgetResourceUrl(resource);
  if (!isAllowedBudgetUrl(url, resource)) {
    throw new ToolError("UPSTREAM_DOWN", "The council budget workbook URL failed its publisher allowlist check.", { retryable: false });
  }
  return ctx.cache.getOrLoad<ParsedBudget>(`council-budgets:${year}:v1`, cacheTtlMs, async () => {
    const bytes = await ctx.http.bytes(url, {
      label: `Council budget ${year}`,
      timeoutMs: 20_000,
      maxBytes: 5 * 1024 * 1024,
      headers: { accept: "application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    });
    return parseBudgetWorkbook(bytes, year);
  }).then((result) => ({ ...result, resource, url }));
}

const listYearsTool = defineTool({
  name: "council_budgets_list_years",
  title: "List council budget years",
  description: "List years in the official local-authority budget workbook series, including years whose older workbook layout is not supported. This is the source manifest observed on 2026-10-25, not live catalogue metadata.",
  example: {},
  inputSchema: {},
  handler: async (_args, ctx) => {
    const years = BUDGET_RESOURCES.map((resource) => ({
      year: resource.year,
      supported: resource.supported,
      partial: resource.partial ?? false,
      format: resource.format,
      resource_id: resource.id,
      resource_url: budgetResourceUrl(resource),
      resource_last_modified: resource.resourceModifiedAt,
      ...(resource.reason ? { reason: resource.reason } : {}),
      ...(resource.partialReason ? { partial_reason: resource.partialReason } : {})
    }));
    return envelope(councilBudgetsInfo, {
      data: { dataset_url: DATASET_URL, manifest_observed_at: MANIFEST_OBSERVED_AT, years },
      url: DATASET_URL,
      retrievedAt: ctx.now(),
      truncated: false
    });
  }
});

const getTool = defineTool({
  name: "council_budgets_get",
  title: "Get council budget rows",
  description: "Read adopted budget estimates by council, service division (A–H), budget line and expenditure or income. Amounts are in EUR. This is budget data, not actual spend.",
  example: { year: 2026, authority: "Dublin City Council", division: "A", limit: 20 },
  inputSchema: {
    year: yearSchema,
    authority: z.string().trim().min(2).max(100).describe("Council name as shown in the workbook, e.g. Dublin City Council."),
    division: z.enum(divisions).optional().describe("Optional service division letter, A–H."),
    limit: rowLimit,
    offset: offsetSchema
  },
  handler: async ({ year, authority, division, limit, offset }, ctx) => {
    const loaded = await loadBudget(year, ctx);
    const requestedAuthority = canonicalAuthorityName(authority);
    const availableAuthority = loaded.value.rows.find((row) => row.authority.toLocaleLowerCase("en-IE") === requestedAuthority.toLocaleLowerCase("en-IE"))?.authority;
    if (!availableAuthority) {
      const available = [...new Set(loaded.value.rows.map((row) => row.authority))].sort().slice(0, 20);
      throw new ToolError("NOT_FOUND", `The ${year} workbook has no council named '${authority.trim()}'.`, {
        hint: `Use a council name from the workbook. Examples: ${available.join(", ")}${available.length === 20 ? ", …" : "."}`
      });
    }
    const matches = loaded.value.rows.filter((row) => row.authority === availableAuthority && (!division || row.division === division));
    const page = matches.slice(offset, offset + limit);
    const nextOffset = offset + page.length < matches.length ? offset + page.length : null;
    return envelope(councilBudgetsInfo, {
      data: {
        budget_year: year,
        authority: availableAuthority,
        division: division ?? null,
        amount_unit: loaded.value.unit,
        budget_type: "adopted budget estimate",
        partial: loaded.value.partial,
        unlabelled_source_value_count: loaded.value.unlabelledSourceValueCount,
        offset,
        next_offset: nextOffset,
        councils_in_division: division ? loaded.value.authorityCountsByDivision[division] : null,
        coverage_note: loaded.value.coverageNotes.length ? loaded.value.coverageNotes.join(" ") : null,
        rows: page.map((row) => ({
          division: row.division,
          source_authority: row.sourceAuthority,
          line_item: row.item,
          measure: row.measure,
          amount: row.amount,
          unit: loaded.value.unit
        })),
        total_rows: matches.length,
        resource_id: loaded.resource.id,
        resource_last_modified: loaded.resource.resourceModifiedAt,
        resource_metadata_observed_at: MANIFEST_OBSERVED_AT
      },
      url: loaded.url,
      cached: loaded.cached,
      stale: loaded.stale,
      retrievedAt: ctx.now(),
      truncated: nextOffset !== null
    });
  }
});

export const councilBudgetsModule: SourceModule = {
  info: councilBudgetsInfo,
  summary: "Official council budget estimates from the Department of Housing, Local Government and Heritage, with council-level service division rows from the published Excel workbooks.",
  domain: "economy",
  coverage: "Adopted current expenditure and income budgets for 2015–2026. The listed 2013–2014 workbooks use a legacy authority structure and are not parsed. The resource list reflects portal metadata observed on 2026-10-25.",
  tools: [listYearsTool, getTool]
};
