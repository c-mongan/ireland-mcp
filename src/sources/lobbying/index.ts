import { z } from "zod";
import { HOUR } from "../../gateway/context.js";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

const SEARCH_URL = "https://api.lobbying.ie/api/Search";
const LOBBYING_URL = "https://www.lobbying.ie";
const TTL = HOUR;
const MAX_PAGE_SIZE = 100;
const MAX_DATE_WINDOW_DAYS = 366;

export const lobbyingInfo: SourceInfo = {
  id: "lobbying",
  name: "Lobbying.ie Register of Lobbying",
  licence: "PSI General Licence for Re-use of Public Sector Information",
  attribution: "Contains data from the Register of Lobbying, © Standards in Public Office Commission, published on Lobbying.ie.",
  homepage: LOBBYING_URL
};

const PUBLIC_STRING_FIELDS = [
  ["DidAnyDposCarryOutLobbying", "did_any_dpos_carry_out_lobbying"],
  ["OnBehalfOfClient", "on_behalf_of_client"],
  ["PeriodName", "period_name"], ["SubjectMatterText", "subject_matter_text"], ["SubjectMatterName", "subject_matter_name"],
  ["PublicPolicyAreaName", "public_policy_area_name"],
  ["IntendedResultsText", "intended_results_text"], ["GrassRootsDirective", "grass_roots_directive"],
  ["LobbyingActivityText", "lobbying_activity_text"], ["ClientsText", "clients_text"], ["PublishStatus", "publish_status"],
  ["CarriedOutLobbyingName", "carried_out_lobbying_name"], ["DPONameResolved", "dpo_name_resolved"]
] as const;
const PUBLIC_BOOLEAN_FIELDS = [
  ["IsGrassRootsCampaign", "is_grass_roots_campaign"], ["IsOnBehalfOfClient", "is_on_behalf_of_client"],
  ["IsPublished", "is_published"], ["IsDraft", "is_draft"], ["NilReturn", "nil_return"],
  ["SummaryFormat", "summary_format"], ["CeasedLobbying", "ceased_lobbying"], ["ReturnVisiblePublic", "return_visible_public"],
  ["NoExDpoInvolved", "no_ex_dpo_involved"],
  ["IsAwaitingPublication", "is_awaiting_publication"]
] as const;
const PUBLIC_NUMBER_FIELDS = [["ReturnVersionType", "return_version_type"], ["VersionNumber", "version_number"]] as const;

type SearchRecord = Record<string, unknown> & { Id: number; FormattedUrl: string; SubmittedDate?: unknown; LobbyistNameResolved?: unknown };
interface SearchResponse { Total: number; Data: SearchRecord[] }

function invalidSearch(reason: string): never {
  throw new ToolError("UPSTREAM_DOWN", `Lobbying.ie returned an invalid register search: ${reason}`, { retryable: false });
}

/** Resolves official relative return links and rejects external hosts. */
export function resolveReturnUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return invalidSearch("a return link is missing.");
  const raw = value.trim();
  const localPath = /^\/(?!\/)/.test(raw);
  const hostRelative = /^(?:www\.)?lobbying\.ie\//i.test(raw);
  const absolute = /^https:\/\/(?:www\.)?lobbying\.ie(?:\/|$)/i.test(raw);
  if (!localPath && !hostRelative && !absolute) return invalidSearch("a return link points outside Lobbying.ie.");
  const normalized = hostRelative ? `${LOBBYING_URL}/${raw.replace(/^(?:www\.)?lobbying\.ie\//i, "")}` : raw;
  let url: URL;
  try { url = new URL(normalized, LOBBYING_URL); } catch { return invalidSearch("a return link is invalid."); }
  if (url.protocol !== "https:" || !["lobbying.ie", "www.lobbying.ie"].includes(url.hostname)) {
    return invalidSearch("a return link points outside Lobbying.ie.");
  }
  return url.href;
}

function validSubmittedDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const isoDate = `${year}-${month}-${day}`;
  const date = new Date(`${isoDate}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === isoDate &&
    Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59 && Number.isFinite(Date.parse(value));
}

/** Validates the Search API response before the cache stores it. */
function validateSearchResponse(value: unknown): asserts value is SearchResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidSearch("the response is not an object.");
  const response = value as Record<string, unknown>;
  if (!Number.isSafeInteger(response.Total) || (response.Total as number) < 0 || !Array.isArray(response.Data)) {
    return invalidSearch("the response is missing a valid Total or Data field.");
  }
  for (const item of response.Data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalidSearch("a result row is not an object.");
    const row = item as Record<string, unknown>;
    if (!Number.isSafeInteger(row.Id) || (row.Id as number) < 1) return invalidSearch("a result row has an invalid Id.");
    resolveReturnUrl(row.FormattedUrl);
    if (row.SubmittedDate !== undefined && row.SubmittedDate !== null && !validSubmittedDate(row.SubmittedDate)) {
      return invalidSearch("a result row has an invalid SubmittedDate.");
    }
    if (row.LobbyistNameResolved !== undefined && row.LobbyistNameResolved !== null && typeof row.LobbyistNameResolved !== "string") {
      return invalidSearch("a result row has an invalid LobbyistNameResolved.");
    }
    for (const [field] of PUBLIC_STRING_FIELDS) {
      if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "string") return invalidSearch(`a result row has an invalid ${field}.`);
    }
    for (const [field] of PUBLIC_BOOLEAN_FIELDS) {
      if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "boolean") return invalidSearch(`a result row has an invalid ${field}.`);
    }
    for (const [field] of PUBLIC_NUMBER_FIELDS) {
      if (row[field] !== undefined && row[field] !== null && typeof row[field] !== "number") return invalidSearch(`a result row has an invalid ${field}.`);
    }
    if (row.IsDraft === true || row.IsAwaitingPublication === true || row.IsPublished === false || row.ReturnVisiblePublic === false) {
      return invalidSearch("the search returned a row that is not a published public record.");
    }
  }
}

function publicRecord(row: SearchRecord): Record<string, unknown> {
  const submittedDate = typeof row.SubmittedDate === "string" ? row.SubmittedDate : null;
  const result: Record<string, unknown> = {
    id: row.Id,
    url: resolveReturnUrl(row.FormattedUrl),
    lobbyist: typeof row.LobbyistNameResolved === "string" ? row.LobbyistNameResolved : null,
    submitted_at: submittedDate,
    submitted_date: submittedDate?.slice(0, 10) ?? null
  };
  for (const [sourceField, outputField] of [...PUBLIC_STRING_FIELDS, ...PUBLIC_BOOLEAN_FIELDS, ...PUBLIC_NUMBER_FIELDS]) {
    result[outputField] = Object.prototype.hasOwnProperty.call(row, sourceField) ? row[sourceField] : null;
  }
  return result;
}

function toApiDate(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new ToolError("BAD_ARGS", `${field} must be a valid date in YYYY-MM-DD format.`);
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ToolError("BAD_ARGS", `${field} must be a valid date in YYYY-MM-DD format.`);
  }
  return `${match[3]}-${match[2]}-${match[1]}`;
}

interface DateWindow { from: string; to: string; apiFrom: string; apiTo: string }

function dateWindow(dateFrom: string | undefined, dateTo: string | undefined, now: Date): DateWindow {
  const today = now.toISOString().slice(0, 10);
  let from = dateFrom;
  let to = dateTo;
  if (!from && !to) {
    from = `${today.slice(0, 4)}-01-01`;
    to = today;
  } else if (!from) {
    from = `${to!.slice(0, 4)}-01-01`;
  } else if (!to) {
    const yearEnd = `${from.slice(0, 4)}-12-31`;
    to = yearEnd < today ? yearEnd : today;
  }

  if (from! > to!) {
    throw new ToolError("BAD_ARGS", "The date range starts after it ends. A date_from-only search cannot start after today.", {
      hint: "Choose a date_from on or before today, or provide a valid date_to."
    });
  }
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_DATE_WINDOW_DAYS) {
    throw new ToolError("BAD_ARGS", `Search windows cannot exceed ${MAX_DATE_WINDOW_DAYS} days.`, {
      hint: `Split the search into requests of no more than ${MAX_DATE_WINDOW_DAYS} days (about one year) each.`
    });
  }
  return { from: from!, to: to!, apiFrom: toApiDate(from, "date_from")!, apiTo: toApiDate(to, "date_to")! };
}

const searchTool = defineTool({
  name: "lobbying_search_returns",
  title: "Search the Register of Lobbying",
  description: "Search SIPO's public Register of Lobbying by words, return date, designated public official or lobbyist. Omit dates to search from 1 January this year through today. Search windows are limited to 366 days. Results are published returns, not a count of meetings; use page to continue.",
  example: { query: "housing", limit: 10 },
  inputSchema: {
    query: z.string().trim().min(1).max(100).optional().describe("Words in the published return, e.g. 'housing supply'."),
    date_from: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("First return date, YYYY-MM-DD (source Search filter)."),
    date_to: z.string().max(10).regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Last return date, YYYY-MM-DD (source Search filter)."),
    official: z.string().trim().min(1).max(100).optional().describe("Designated public official named in the return."),
    lobbyist: z.string().trim().min(1).max(100).optional().describe("Lobbyist name."),
    page: z.number().int().min(1).max(100_000).default(1).describe("One-based result page."),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(50).describe(`Rows per page (1-${MAX_PAGE_SIZE}).`)
  },
  handler: async ({ query, date_from, date_to, official, lobbyist, page, limit }, ctx: ToolContext) => {
    if (date_from) toApiDate(date_from, "date_from");
    if (date_to) toApiDate(date_to, "date_to");
    const dates = dateWindow(date_from, date_to, ctx.now());
    const params = new URLSearchParams({
      currentPage: String(page),
      pageSize: String(limit),
      queryText: query ?? "",
      subjectMatters: "",
      subjectMatterAreas: "",
      publicBodys: "",
      jobTitles: "",
      returnDateFrom: dates.apiFrom,
      returnDateTo: dates.apiTo,
      period: "",
      dpo: official ?? "",
      client: "",
      responsible: "",
      lobbyist: lobbyist ?? "",
      lobbyistId: ""
    });
    const url = `${SEARCH_URL}?${params.toString()}`;
    const result = await ctx.cachedJson<SearchResponse>(url, TTL, {
      label: "Lobbying.ie Register of Lobbying",
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 30_000,
      validate: (value) => {
        validateSearchResponse(value);
        if (value.Data.length > limit) return invalidSearch("the response contains more rows than the requested page size.");
      }
    });
    const rows = result.value.Data.slice(0, limit).map(publicRecord);
    const possiblyMore = result.value.Total > page * limit;
    return envelope(lobbyingInfo, {
      data: { date_from: dates.from, date_to: dates.to, page, page_size: limit, returned: rows.length, total: result.value.Total, possibly_more: possiblyMore, next_page: possiblyMore ? page + 1 : null, returns: rows },
      url,
      cached: result.cached,
      stale: result.stale,
      truncated: possiblyMore
    });
  }
});

export function createLobbyingModule(): SourceModule {
  return {
    info: lobbyingInfo,
    summary: "Public lobbying returns filed with the Standards in Public Office Commission, searchable by matter, date, official and lobbyist.",
    domain: "law/politics",
    coverage: "Published returns in the Register of Lobbying on Lobbying.ie. Search results are paged; a full register export is not implied.",
    tools: [searchTool]
  };
}

export const lobbyingModule = createLobbyingModule();
