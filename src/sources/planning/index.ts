import { z } from "zod";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { assertInIreland } from "../geohive/index.js";
import { ARCGIS_LAYERS, andWhere, dateClause, fieldEq, fieldLike, orWhere, queryLayer } from "../arcgis/client.js";

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

const searchTool = defineTool({
  name: "planning_search",
  title: "Search planning applications",
  description: "Search NPAD planning applications by point+radius, council, free text and received-date range. Returns compact attributes and application-detail links.",
  example: { lat: 53.3498, lon: -6.2603, radius_m: 1000, text: "apartments", limit: 5 },
  inputSchema: {
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    radius_m: z.number().int().min(1).max(20_000).default(1000),
    council: z.string().min(2).max(80).optional().describe("Planning authority, e.g. Dublin City Council."),
    text: z.string().min(2).max(80).optional().describe("Words to match in development description or address."),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ReceivedDate lower bound, YYYY-MM-DD."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("ReceivedDate upper bound, YYYY-MM-DD."),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(20)
  },
  handler: async ({ lat, lon, radius_m, council, text, from, to, limit }, ctx) => {
    if ((lat === undefined) !== (lon === undefined)) throw new ToolError("BAD_ARGS", "Give both lat and lon, or neither.");
    if (!council && !text && lat === undefined && !from && !to) throw new ToolError("BAD_ARGS", "Give a location, council, text or date range.");
    if (lat !== undefined && lon !== undefined) assertInIreland(lat, lon);
    const where = andWhere([
      council ? fieldEq("PlanningAuthority", council) : null,
      text ? orWhere([fieldLike("DevelopmentDescription", text), fieldLike("DevelopmentAddress", text), fieldLike("ApplicationNumber", text)]) : null,
      ...dateRange(from, to)
    ]);
    const result = await queryLayer(ctx, ARCGIS_LAYERS.planningPoints, {
      where,
      geometry: lat !== undefined && lon !== undefined ? { type: "point", lat, lon, distance: radius_m } : undefined,
      outFields: fields,
      resultRecordCount: limit,
      returnGeometry: false,
      orderByFields: "ReceivedDate DESC"
    });
    const applications = result.features.slice(0, limit).map((f) => row(f.attributes));
    return envelope(planningInfo, {
      data: { count: applications.length, applications },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated: result.exceeded || result.features.length > limit
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
  domain: "places/property",
  coverage: "Republic of Ireland planning application point layer from the Department of Housing ArcGIS Hub.",
  tools: [searchTool, getTool]
};
