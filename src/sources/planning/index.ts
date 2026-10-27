import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { assertInIreland } from "../geohive/index.js";
import type { Envelope } from "../../gateway/envelope.js";
import type { ToolContext } from "../../gateway/module.js";
import { ARCGIS_LAYERS, ARCGIS_MAX_RECORDS, andWhere, countLayer, dateClause, fieldEq, fieldLike, orWhere, queryLayer, statsLayer } from "../arcgis/client.js";
import { planningCard } from "./card.js";

export const planningInfo: SourceInfo = {
  id: "planning",
  name: "National Planning Application Database (NPAD)",
  licence: "CC BY 4.0",
  attribution: "© Department of Housing, Local Government and Heritage.",
  homepage: "https://data-housinggovie.opendata.arcgis.com/maps/housinggovie::irishplanningapplications"
};

const fields = [
  "PlanningAuthority",
  "ApplicationNumber",
  "DevelopmentDescription",
  "DevelopmentAddress",
  "ApplicationStatus",
  "ApplicationType",
  "Decision",
  "ReceivedDate",
  "DecisionDate",
  "GrantDate",
  "ExpiryDate",
  "NumResidentialUnits",
  "LinkAppDetails"
];

const str = (value: unknown) => (typeof value === "string" ? value.trim() || null : value == null ? null : String(value));
const date = (value: unknown) => (typeof value === "number" ? new Date(value).toISOString().slice(0, 10) : null);
const row = (a: Record<string, unknown>) => ({
  council: str(a.PlanningAuthority),
  application_ref: str(a.ApplicationNumber),
  description: str(a.DevelopmentDescription),
  address: str(a.DevelopmentAddress),
  status: str(a.ApplicationStatus),
  type: str(a.ApplicationType),
  decision: str(a.Decision),
  received_date: date(a.ReceivedDate),
  decision_date: date(a.DecisionDate),
  grant_date: date(a.GrantDate),
  expiry_date: date(a.ExpiryDate),
  residential_units: typeof a.NumResidentialUnits === "number" ? a.NumResidentialUnits : null,
  url: str(a.LinkAppDetails)
});

const dateRange = (from?: string, to?: string) => [from ? dateClause("ReceivedDate", ">=", from) : null, to ? dateClause("ReceivedDate", "<=", to) : null];

/** Rows planning_search returns per call; one ArcGIS request. */
const PAGE_MAX = 500;
/** ReceivedDate is not unique; OBJECTID breaks ties so offset pages neither repeat nor skip rows. */
const STABLE_ORDER = "ReceivedDate DESC,OBJECTID DESC";

interface Filters {
  lat?: number | undefined;
  lon?: number | undefined;
  radius_m: number;
  council?: string | undefined;
  text?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  min_units?: number | undefined;
}

const filterShape = {
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  radius_m: z.number().int().min(1).max(20_000).default(1000),
  council: z.string().min(2).max(80).optional().describe("Planning authority, e.g. Dublin City Council."),
  text: z.string().min(2).max(80).optional().describe("Words to match in development description or address."),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ReceivedDate lower bound, YYYY-MM-DD."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ReceivedDate upper bound, YYYY-MM-DD."),
  min_units: z.number().int().min(0).max(100_000).optional().describe("Only applications proposing at least this many residential units (1 = any housing).")
};

/** Builds the validated ArcGIS filter. Caller text only ever reaches SQL through the quoting helpers. */
function planningQuery({ lat, lon, radius_m, council, text, from, to, min_units }: Filters) {
  if ((lat === undefined) !== (lon === undefined)) throw new ToolError("BAD_ARGS", "Give both lat and lon, or neither.");
  if (!council && !text && lat === undefined && !from && !to) throw new ToolError("BAD_ARGS", "Give a location, council, text or date range.");
  if (lat !== undefined && lon !== undefined) assertInIreland(lat, lon);
  const where = andWhere([
    council ? fieldEq("PlanningAuthority", council) : null,
    text ? orWhere([fieldLike("DevelopmentDescription", text), fieldLike("DevelopmentAddress", text), fieldLike("ApplicationNumber", text)]) : null,
    ...dateRange(from, to),
    min_units !== undefined ? `NumResidentialUnits >= ${Math.trunc(min_units)}` : null
  ]);
  const geometry = lat !== undefined && lon !== undefined ? ({ type: "point", lat, lon, distance: radius_m } as const) : undefined;
  return { where, geometry };
}

/** Exact total, or null when the count request fails (the page is still returned). */
async function totalOf(ctx: ToolContext, q: ReturnType<typeof planningQuery>) {
  try {
    return await countLayer(ctx, ARCGIS_LAYERS.planningPoints, q);
  } catch {
    return null;
  }
}

const searchTool = defineTool({
  name: "planning_search",
  title: "Search planning applications",
  description: "Search NPAD planning applications by point+radius, council, free text, received-date range and minimum residential units. Returns compact attributes, application-detail links, the exact total and next_offset for paging. For counts and unit totals use planning_stats; for joins use ireland_query.",
  example: { lat: 53.3498, lon: -6.2603, radius_m: 1000, text: "apartments", limit: 5 },
  inputSchema: {
    ...filterShape,
    limit: z.number().int().min(1).max(MAX_LIMIT).default(20),
    offset: z.number().int().min(0).max(100_000).default(0).describe("Matching applications to skip (newest first).")
  },
  table: {
    rows: "applications",
    load: async (args, ctx, maxRows) => loadAll(args as unknown as Filters, ctx, maxRows)
  },
  handler: async ({ limit, offset, ...filters }, ctx) => {
    const q = planningQuery(filters);
    const [result, total] = await Promise.all([
      queryLayer(ctx, ARCGIS_LAYERS.planningPoints, {
        ...q,
        outFields: fields,
        resultRecordCount: Math.min(limit, PAGE_MAX),
        maxRecords: PAGE_MAX,
        pageSize: PAGE_MAX,
        offset,
        returnGeometry: false,
        orderByFields: STABLE_ORDER
      }),
      totalOf(ctx, q)
    ]);
    const applications = result.features.slice(0, limit).map((f) => row(f.attributes));
    const more = total ? offset + applications.length < total.count : result.exceeded;
    return envelope(planningInfo, {
      data: {
        total: total?.count ?? null,
        ...(total ? {} : { total_note: "Total unknown: the count request failed. truncated says whether more rows exist." }),
        offset,
        count: applications.length,
        next_offset: more ? offset + applications.length : null,
        applications
      },
      url: result.url,
      cached: result.cached && (total?.cached ?? true),
      stale: result.stale || Boolean(total?.stale),
      truncated: more
    });
  }
});

/** Reads every matching application for a table handle, in OBJECTID order, checked against the exact count. */
async function loadAll(filters: Filters, ctx: ToolContext, maxRows: number) {
  const q = planningQuery(filters);
  const total = await countLayer(ctx, ARCGIS_LAYERS.planningPoints, q);
  if (total.count > maxRows) {
    throw new ToolError("BAD_ARGS", `${total.count} planning applications match; a table holds at most ${maxRows}.`, {
      hint: "Narrow by council, dates or location, or use planning_stats for counts and unit totals at any scale."
    });
  }
  const seen = new Map<unknown, Record<string, unknown>>();
  const urls = [total.url];
  let cached = total.cached;
  let stale = total.stale;
  for (let offset = 0; offset < total.count; offset += ARCGIS_MAX_RECORDS) {
    const page = await queryLayer(ctx, ARCGIS_LAYERS.planningPoints, {
      ...q,
      outFields: [...fields, "OBJECTID"],
      resultRecordCount: ARCGIS_MAX_RECORDS,
      maxRecords: ARCGIS_MAX_RECORDS,
      pageSize: ARCGIS_MAX_RECORDS,
      offset,
      returnGeometry: false,
      orderByFields: "OBJECTID ASC"
    });
    urls.push(page.url);
    cached &&= page.cached;
    stale ||= page.stale;
    for (const f of page.features) seen.set(f.attributes.OBJECTID, row(f.attributes));
    if (page.features.length === 0) break;
  }
  if (seen.size !== total.count) {
    throw new ToolError("UPSTREAM_DOWN", `The planning layer returned ${seen.size} applications but counted ${total.count}; it may have changed while being read.`, {
      hint: "Try again shortly. ireland_query never computes over a partial table."
    });
  }
  const env: Envelope = envelope(planningInfo, { data: null, url: urls[1] ?? total.url, cached, stale, retrievedAt: ctx.now() });
  return { rows: [...seen.values()], envelope: env, urls, pages: urls.length };
}

const GROUPS = { council: "PlanningAuthority", decision: "Decision", status: "ApplicationStatus", type: "ApplicationType" } as const;

const statsTool = defineTool({
  name: "planning_stats",
  title: "Count planning applications and units",
  description: "Exact counts of NPAD planning applications and their proposed residential units for any filter (council, dates, location, text, min_units), optionally grouped by council, decision, status or type. Computed by the ArcGIS service, so it works at national scale.",
  example: { council: "Galway City Council", from: "2024-01-01", to: "2024-12-31" },
  inputSchema: {
    ...filterShape,
    group_by: z.enum(Object.keys(GROUPS) as [keyof typeof GROUPS, ...Array<keyof typeof GROUPS>]).optional().describe("Break the totals down by this field.")
  },
  table: { rows: "groups" },
  handler: async ({ group_by, ...filters }, ctx) => {
    const q = planningQuery(filters);
    const field = group_by ? GROUPS[group_by] : undefined;
    const result = await statsLayer(ctx, ARCGIS_LAYERS.planningPoints, {
      ...q,
      statistics: [
        { type: "count", field: "OBJECTID", as: "applications" },
        { type: "sum", field: "NumResidentialUnits", as: "residential_units" },
        { type: "count", field: "NumResidentialUnits", as: "units_recorded" }
      ],
      ...(field ? { groupBy: [field] } : {}),
      maxGroups: 1000
    });
    const groups = result.groups.map((g) => ({
      ...(field ? { [group_by!]: str(g[field]) } : {}),
      applications: typeof g.applications === "number" ? g.applications : 0,
      residential_units: typeof g.residential_units === "number" ? g.residential_units : 0,
      units_recorded: typeof g.units_recorded === "number" ? g.units_recorded : 0
    }));
    const totals = groups.reduce(
      (t, g) => ({ applications: t.applications + g.applications, residential_units: t.residential_units + g.residential_units, units_recorded: t.units_recorded + g.units_recorded }),
      { applications: 0, residential_units: 0, units_recorded: 0 }
    );
    return envelope(planningInfo, {
      data: { ...totals, ...(field ? { group_by } : {}), groups, note: "residential_units sums NumResidentialUnits as recorded by each council. units_recorded counts applications with that field filled in. Some councils leave it blank or enter 0 for every application, so a total of 0 can mean unknown, not none." },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated: result.exceeded
    });
  }
});

const getTool = defineTool({
  name: "planning_get",
  title: "Get planning application by reference",
  description: "Find NPAD record(s) for a planning application reference. Application numbers can repeat across councils, so council is optional but recommended.",
  example: { application_ref: "20289", council: "Carlow County Council" },
  inputSchema: {
    application_ref: z.string().min(1).max(40).regex(/^[A-Za-z0-9_./-]+$/),
    council: z.string().min(2).max(80).optional()
  },
  handler: async ({ application_ref, council }, ctx) => {
    const result = await queryLayer(ctx, ARCGIS_LAYERS.planningPoints, {
      where: andWhere([fieldEq("ApplicationNumber", application_ref), council ? fieldEq("PlanningAuthority", council) : null]),
      outFields: fields,
      resultRecordCount: 10,
      returnGeometry: false
    });
    const applications = result.features.map((f) => row(f.attributes));
    if (!applications.length) throw new ToolError("NOT_FOUND", `No NPAD planning application found for ${application_ref}.`);
    return envelope(planningInfo, { data: { count: applications.length, applications }, url: result.url, cached: result.cached, stale: result.stale });
  }
});

export const planningModule: SourceModule = {
  info: planningInfo,
  summary: "Planning applications by location, council, text, date or reference.",
  domain: "places/property", card: planningCard,
  coverage: "Republic of Ireland planning application point layer from the Department of Housing ArcGIS Hub.",
  tools: [searchTool, statsTool, getTool]
};
