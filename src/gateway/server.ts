import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  cardMatches,
  compactCard,
  GEO_LEVELS,
  hasFilter,
  JOIN_KEYS,
  normaliseGeoLevel,
  normaliseJoinKey,
  normaliseTopic,
  operationCard,
  textWords,
  TOPICS,
  type CardFilter
} from "./cards.js";
import { exampleArgs, listOperations, operationSchema, shortDescription, type Operation } from "./catalogue.js";
import { applyBudget, DEFAULT_MAX_TOKENS, MAX_MAX_TOKENS } from "./envelope.js";
import { ToolError, toToolError } from "./errors.js";
import { DOMAINS, type AnyTool, type SourceModule, type ToolContext } from "./module.js";
import { QUERY_LIMITS, queryInputShape, runQuery } from "./query.js";
import { tableId } from "./table.js";
import { noopSink, type TelemetrySink } from "./telemetry.js";
import { ALL_TOOLSETS, resolveToolsets } from "./toolsets.js";

export const SERVER_NAME = "ireland-mcp";
export const SERVER_VERSION = "1.2.0";
export const HOSTED_URL = "https://mcp.irishopendata.ie";
export const REPO_URL = "https://github.com/c-mongan/ireland-mcp";

export const INSTRUCTIONS = [
  "Read-only Irish public data (CSO, Oireachtas, Met Éireann, transport, property, energy and more).",
  "Workflow: ireland_call's description indexes every source and operation; when one fits, call ireland_call with {source, operation, args} directly (bad args return the schema).",
  "Otherwise ireland_catalogue finds datasets (filter by topic, geo_level, join_key, has_time_series or text; results carry dataset cards); ireland_describe gives the full card and an operation's schema.",
  "search/fetch is keyword discovery (CSO tables, bills, acts, datasets, tenders). nearby covers boundaries, small area code, forecast, monuments and protected sites at a lat/lon only.",
  "Counts, sums, joins or rankings over many rows: ireland_query (computed on the server from table_ids).",
  "Use ireland_call for live readings (weather observations, river levels, buoys, bikes), populations (cso_area_profile, census_small_area_at) and place names (geohive_locate).",
  "Cite `source`, `url`, `licence` and `attribution` from each result.",
  "If `stale` is true the cached copy was served; say so.",
  "If `truncated` is true, narrow the request or raise max_tokens (≤8000).",
  "Typed tools per source: ?toolsets=<id>,… (HTTP) or --toolsets (stdio)."
].join(" ");

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const OUTPUT_SCHEMA = z.object({}).passthrough();
const maxTokensSchema = z
  .number()
  .int()
  .min(100)
  .max(MAX_MAX_TOKENS)
  .optional()
  .describe(`Result budget in tokens (default ${DEFAULT_MAX_TOKENS}).`);

export interface BuildServerOptions {
  modules: SourceModule[];
  /** Always-listed tools outside any source module (the ChatGPT search/fetch pair). */
  extraTools?: AnyTool[];
  context: ToolContext;
  telemetry?: TelemetrySink;
  /** Comma list of source ids (or "all") whose typed tools are listed next to the meta tools. */
  toolsets?: string;
}

export function allTools(modules: SourceModule[], extraTools: AnyTool[] = []): Array<{ tool: AnyTool; source: string }> {
  return [...listOperations(modules), ...extraTools.map((tool) => ({ tool, source: "cross" }))];
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function ok(value: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    ...(isPlainObject(value) ? { structuredContent: value } : {})
  };
}

function fail(body: unknown): ToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

/** Compact "source: op, op; source: op" index of every operation, for the ireland_call description. */
function operationIndex(operations: readonly Operation[]): string {
  const bySource = new Map<string, string[]>();
  for (const { source, tool } of operations) bySource.set(source, [...(bySource.get(source) ?? []), tool.name]);
  return [...bySource].map(([source, names]) => `${source}: ${names.join(", ")}`).join("; ");
}

/** Names the dispatched operation in an ireland_call result, so transcripts and evals can attribute the call. */
function tagOperation(result: ToolResult, source: string, operation: string, table?: string): ToolResult {
  const prefix = `"operation":${JSON.stringify(operation)},${table ? `"table_id":${JSON.stringify(table)},` : ""}`;
  const content = result.content.map((part, i) =>
    i === 0 && part.text.startsWith("{") && part.text !== "{}" ? { ...part, text: `{${prefix}${part.text.slice(1)}` } : part
  );
  return {
    ...result,
    content,
    ...(result.structuredContent ? { structuredContent: { operation, ...(table ? { table_id: table } : {}), ...result.structuredContent } } : {}),
    _meta: { ...result._meta, "ireland/source": source, "ireland/operation": operation }
  };
}

export function buildServer(options: BuildServerOptions): McpServer {
  const { modules, context } = options;
  const extraTools = options.extraTools ?? [];
  const sink = options.telemetry ?? noopSink;
  const operations = listOperations(modules);
  const enabled = new Set(
    resolveToolsets(
      options.toolsets,
      modules.map((m) => m.info.id)
    )
  );

  const seen = new Set<string>(["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about", "ireland_query"]);
  for (const { tool } of allTools(modules, extraTools)) {
    if (seen.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
  }

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS, capabilities: { resources: {}, prompts: {} } }
  );
  registerMetaTools(server, modules, operations, context, sink);

  for (const tool of extraTools) registerTyped(server, tool, "cross", context, sink);
  for (const { tool, source } of operations) {
    if (tool.pinned || enabled.has(source)) registerTyped(server, tool, source, context, sink);
  }

  registerResources(server, modules);
  registerPrompts(server);
  portableToolSchemas(server);
  return server;
}

type Handler = (request: unknown, extra: unknown) => Promise<unknown>;

/**
 * Zod spells "any extra keys" as `additionalProperties: {}`, which schema linters (MCP Inspector's
 * portability check) flag as untyped. Rewrites it to the equivalent, portable `true` in tools/list.
 */
function portableToolSchemas(server: McpServer) {
  const handlers = (server.server as unknown as { _requestHandlers?: Map<string, Handler> })._requestHandlers;
  const list = handlers?.get("tools/list");
  if (!handlers || !list) return;
  handlers.set("tools/list", async (request, extra) => openObjects(await list(request, extra)));
}

function openObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openObjects);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = key === "additionalProperties" && isPlainObject(child) && Object.keys(child).length === 0 ? true : openObjects(child);
  }
  return out;
}

function registerTyped(server: McpServer, tool: AnyTool, source: string, context: ToolContext, sink: TelemetrySink) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: { ...tool.inputSchema, max_tokens: maxTokensSchema },
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: tool.title, ...ANNOTATIONS }
    },
    async (args: unknown) => runTool(tool, source, args, context, sink)
  );
}

export interface CatalogueArgs {
  domain?: string;
  topic?: string;
  geo_level?: string;
  has_time_series?: boolean;
  join_key?: string;
  text?: string;
}

function parseFilter(args: CatalogueArgs): CardFilter {
  const pick = <T>(value: string | undefined, normalise: (v: string) => T | undefined, field: string, valid: readonly string[]): T | undefined => {
    if (value === undefined || value.trim() === "") return undefined;
    const found = normalise(value);
    if (!found) throw new ToolError("BAD_ARGS", `Unknown ${field} "${value}".`, { hint: `Valid ${field} values: ${valid.join(", ")}.` });
    return found;
  };
  const topic = pick(args.topic, normaliseTopic, "topic", TOPICS);
  const geoLevel = pick(args.geo_level, normaliseGeoLevel, "geo_level", GEO_LEVELS);
  const joinKey = pick(args.join_key, normaliseJoinKey, "join_key", JOIN_KEYS);
  const words = args.text ? textWords(args.text) : [];
  return {
    ...(topic ? { topic } : {}),
    ...(geoLevel ? { geo_level: geoLevel } : {}),
    ...(joinKey ? { join_key: joinKey } : {}),
    ...(args.has_time_series !== undefined ? { has_time_series: args.has_time_series } : {}),
    ...(words.length ? { words } : {})
  };
}

/** Free text an operation is searched by, besides its card. */
function operationText(module: SourceModule, tool: AnyTool): string {
  return [module.info.id, module.info.name, module.summary, module.coverage ?? "", tool.name, tool.title, shortDescription(tool.description, 400)].join(" ");
}

export function catalogueOf(modules: SourceModule[], args: CatalogueArgs = {}) {
  const filter = parseFilter(args);
  const filtering = hasFilter(filter);
  const sourceEntry = (m: SourceModule) => {
    const tools = filtering
      ? m.tools.filter((t) => m.card && cardMatches(operationCard(m.card, t.name), filter, operationText(m, t)))
      : m.tools;
    if (tools.length === 0) return undefined;
    return {
      id: m.info.id,
      name: m.info.name,
      summary: m.summary,
      operations: tools.map((t) => t.name),
      ...(filtering && m.card ? { card: compactCard(m.card) } : {})
    };
  };
  const domains = DOMAINS.filter((d) => !args.domain || d === args.domain)
    .map((d) => ({
      domain: d,
      sources: modules
        .filter((m) => m.domain === d)
        .map(sourceEntry)
        .filter((s) => s !== undefined)
    }))
    .filter((d) => d.sources.length > 0);
  if (!filtering) {
    return { domains, next: "ireland_describe(source, operation) for arguments, then ireland_call. Filter with topic, geo_level, join_key, has_time_series or text to get dataset cards." };
  }
  const count = domains.reduce((n, d) => n + d.sources.length, 0);
  return {
    filters: {
      ...(args.domain ? { domain: args.domain } : {}),
      ...(filter.topic ? { topic: filter.topic } : {}),
      ...(filter.geo_level ? { geo_level: filter.geo_level } : {}),
      ...(filter.join_key ? { join_key: filter.join_key } : {}),
      ...(filter.has_time_series !== undefined ? { has_time_series: filter.has_time_series } : {}),
      ...(filter.words ? { text: filter.words.join(" ") } : {})
    },
    count,
    domains,
    next:
      count > 0
        ? "ireland_describe(source) for the full card, ireland_describe(source, operation) for arguments, then ireland_call. A source-level card can be broader than an operation's; only matching operations are listed."
        : "Nothing matched. Drop a filter, try a related topic, or use search for keywords."
  };
}

function findOperation(modules: SourceModule[], source: string, operation: string): Operation {
  const module = findSource(modules, source);
  const tool = module.tools.find((t) => t.name === operation);
  if (!tool) {
    throw new ToolError("NOT_FOUND", `Source "${source}" has no operation "${operation}".`, {
      hint: `Operations for ${source}: ${module.tools.map((t) => t.name).join(", ")}.`
    });
  }
  return { tool, source };
}

function describeOperation(module: SourceModule, { tool, source }: Operation) {
  return {
    source,
    operation: tool.name,
    title: tool.title,
    description: tool.description,
    input_schema: operationSchema(tool),
    example: exampleArgs(tool),
    call: { tool: "ireland_call", arguments: { source, operation: tool.name, args: exampleArgs(tool) } },
    ...(module.card ? { card: { ...operationCard(module.card, tool.name), ...(tool.table ? { table_handle: true } : {}), licence: module.info.licence } } : {})
  };
}

function findSource(modules: SourceModule[], source: string): SourceModule {
  const module = modules.find((m) => m.info.id === source);
  if (!module) {
    throw new ToolError("NOT_FOUND", `Unknown source "${source}".`, {
      hint: `Valid sources: ${modules.map((m) => m.info.id).join(", ")}. Call ireland_catalogue to browse.`
    });
  }
  return module;
}

/** The full dataset card of a source, with its licence and each operation's differences. */
function describeSource(module: SourceModule) {
  const { operations: overrides, ...card } = module.card ?? ({} as NonNullable<SourceModule["card"]>);
  return {
    source: module.info.id,
    name: module.info.name,
    domain: module.domain ?? null,
    summary: module.summary,
    coverage: module.coverage ?? module.summary,
    licence: module.info.licence,
    attribution: module.info.attribution,
    homepage: module.info.homepage,
    ...(module.card ? { card } : {}),
    operations: module.tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: shortDescription(t.description),
      ...(t.table ? { table_handle: true } : {}),
      ...(overrides?.[t.name] ? { card_differences: overrides[t.name] } : {})
    })),
    next: "ireland_describe(source, operation) for an operation's arguments, then ireland_call."
  };
}

function registerMetaTools(
  server: McpServer,
  modules: SourceModule[],
  operations: Operation[],
  context: ToolContext,
  sink: TelemetrySink
) {
  const guarded = (fn: () => unknown): ToolResult => {
    try {
      return ok(fn());
    } catch (error) {
      return fail(toToolError(error).toJSON());
    }
  };

  server.registerTool(
    "ireland_catalogue",
    {
      title: "Catalogue of Irish data sources",
      description: `List sources and their operations, grouped by domain: ${DOMAINS.join(", ")}. Start here. Filter by topic, geo_level (${GEO_LEVELS.join(", ")}), join_key, has_time_series or text to get matching operations with compact dataset cards (geography, time coverage, cadence, join keys).`,
      inputSchema: {
        domain: z.enum(DOMAINS).optional().describe("Only this domain."),
        topic: z.string().max(40).optional().describe("Topic, e.g. housing, population, labour, transport, law. Related topics also match."),
        geo_level: z.string().max(40).optional().describe("Geography level the data is broken down by, e.g. county, local_authority, lea, ed, small_area, constituency, point."),
        join_key: z.string().max(40).optional().describe("Key the results expose for joining, e.g. county_name, lea_name, ed_code, member_code, eli, lat_lon."),
        has_time_series: z.boolean().optional().describe("true: data over several periods; false: current or single-period data."),
        text: z.string().max(100).optional().describe("Words that must all appear in the source, operation or card.")
      },
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "Catalogue of Irish data sources", ...ANNOTATIONS }
    },
    async (args) => guarded(() => catalogueOf(modules, args))
  );

  server.registerTool(
    "ireland_describe",
    {
      title: "Describe a source or operation",
      description: "With source only: the full dataset card (topics, geography levels, time coverage, cadence, dimensions, join keys, freshness, licence, auth, example questions). With operation too: its argument JSON schema, an example and its card.",
      inputSchema: {
        source: z.string().describe("Source id, e.g. 'cso'."),
        operation: z.string().optional().describe("Operation, e.g. 'cso_get_data'. Omit for the source's card.")
      },
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "Describe a source or operation", ...ANNOTATIONS }
    },
    async ({ source, operation }) =>
      guarded(() => (operation === undefined ? describeSource(findSource(modules, source)) : describeOperation(findSource(modules, source), findOperation(modules, source, operation))))
  );

  server.registerTool(
    "ireland_call",
    {
      title: "Call an operation",
      description: `Run a source operation with args. Bad args return the expected schema and an example. Operations by source: ${operationIndex(operations)}.`,
      inputSchema: {
        source: z.string().describe("Source id."),
        operation: z.string().describe("Operation name."),
        args: z.record(z.string(), z.unknown()).optional().describe("Operation arguments."),
        // Models often write `arguments` (the MCP field name); without this alias the filters were silently dropped.
        arguments: z.record(z.string(), z.unknown()).optional().describe("Alias of args."),
        max_tokens: maxTokensSchema
      },
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "Call an operation", ...ANNOTATIONS }
    },
    async ({ source, operation, args: argsField, arguments: argumentsAlias, max_tokens }) => {
      if (argsField && argumentsAlias) {
        return fail(new ToolError("BAD_ARGS", "Pass operation arguments in `args` or `arguments`, not both.").toJSON());
      }
      const args = argsField ?? argumentsAlias;
      let op: Operation;
      try {
        op = findOperation(modules, source, operation);
      } catch (error) {
        return fail(toToolError(error).toJSON());
      }
      const valid = Object.keys(op.tool.inputSchema);
      const unknown = Object.keys(args ?? {}).filter((key) => key !== "max_tokens" && !valid.includes(key));
      if (unknown.length > 0) {
        const failure = fail({
          ...new ToolError(
            "BAD_ARGS",
            `Unknown argument${unknown.length > 1 ? "s" : ""} for ${op.tool.name}: ${unknown.join(", ")}. Valid arguments: ${valid.join(", ") || "(none)"}.`
          ).toJSON(),
          expected_schema: operationSchema(op.tool),
          example: exampleArgs(op.tool)
        });
        return tagOperation(failure, op.source, op.tool.name);
      }
      const parsed = z.object(op.tool.inputSchema).safeParse(args ?? {});
      if (!parsed.success) {
        const failure = fail({
          ...badArgs(parsed.error).toJSON(),
          expected_schema: operationSchema(op.tool),
          example: exampleArgs(op.tool)
        });
        return tagOperation(failure, op.source, op.tool.name);
      }
      const result = await runTool(op.tool, op.source, { ...(args ?? {}), ...(max_tokens ? { max_tokens } : {}) }, context, sink);
      // Table-capable results carry a handle that ireland_query can load in full.
      const table = op.tool.table && !result.isError ? tableId(op.source, op.tool.name, args ?? {}) : undefined;
      return tagOperation(result, op.source, op.tool.name, table && table.length <= 1000 ? table : undefined);
    }
  );

  server.registerTool(
    "ireland_query",
    {
      title: "Query tables on the server",
      description: [
        "Filter, join, aggregate, rank and sort whole tables on the server; returns only the answer rows, each input's provenance and the query echo.",
        "tables: {alias, table_id} (from an ireland_call result) or {alias, source, operation, args}, each with optional own steps (no joins); put source filters (council, dates, codes) in args.",
        "No steps: columns, row count and preview per table. Steps run in order:",
        '{"filter": ["col", ">", 0]} (= != > >= < <= in not_in contains starts_with is_null not_null; {"and"|"or": [..]}, {"not": ..});',
        '{"join": "alias", "on": "col"|["l","r"], "type": "left", "normalize": true};',
        '{"union": "alias"}; {"derive": {"rate": "a / [Col B] * 1000"}} (round abs min max coalesce if lower norm concat substr split_part replace number year pct_change …);',
        '{"aggregate": {"n": "count", "u": "sum:units", "d": "weighted_avg:score:pop"}, "group_by": ["county"]} (count count_distinct sum avg min max median weighted_avg first);',
        '{"select": [..]|{"new": "old"}}; {"sort": "-n"}; {"limit": 10}; {"rank": {"by": "n"}}; {"pct_of_total": {"col": "n"}}; {"distinct": [..]}.',
        `Limits: ${QUERY_LIMITS.maxTables} tables, 10,000 rows each, ${QUERY_LIMITS.maxRows.toLocaleString("en-IE")} rows after a join, ${QUERY_LIMITS.maxSteps} steps. Partial tables are an error, never computed.`
      ].join(" "),
      inputSchema: queryInputShape,
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "Query tables on the server", ...ANNOTATIONS }
    },
    async (args) => {
      const started = Date.now();
      try {
        const result = await runQuery(modules, args, context);
        sink({ tool: "ireland_query", source: "query", durationMs: Date.now() - started, outcome: "ok", cached: result.cached === true });
        return ok(result);
      } catch (error) {
        const toolError = toToolError(error);
        sink({ tool: "ireland_query", source: "query", durationMs: Date.now() - started, outcome: "error", errorCode: toolError.code });
        return fail(toolError.toJSON());
      }
    }
  );

  server.registerTool(
    "ireland_about",
    {
      title: "About this server",
      description: "Licence, attribution, status URL and how to enable typed toolsets.",
      inputSchema: {},
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "About this server", ...ANNOTATIONS }
    },
    async () =>
      ok({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        licence: "MIT (server code). Data stays under each source's own licence; see sources.",
        repository: REPO_URL,
        status_url: `${HOSTED_URL}/healthz`,
        toolsets: {
          default: "Meta tools only (ireland_catalogue, ireland_describe, ireland_call, ireland_query, ireland_about, search, fetch, nearby, ireland_resolve_place).",
          http_query: `${HOSTED_URL}/mcp?toolsets=cso,irish-rail`,
          http_path: `${HOSTED_URL}/mcp/x/{source}`,
          all: `${HOSTED_URL}/mcp?toolsets=${ALL_TOOLSETS}`,
          stdio: "ireland-mcp --toolsets=cso,irish-rail (or IRELAND_MCP_TOOLSETS)",
          ids: [ALL_TOOLSETS, ...modules.map((m) => m.info.id)]
        },
        sources: modules.map((m) => ({ id: m.info.id, name: m.info.name, licence: m.info.licence, attribution: m.info.attribution }))
      })
  );
}

function badArgs(error: z.ZodError): ToolError {
  const detail = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  return new ToolError("BAD_ARGS", `Invalid arguments: ${detail}`);
}

function sourceDoc(module: SourceModule) {
  return {
    id: module.info.id,
    name: module.info.name,
    domain: module.domain ?? null,
    summary: module.summary,
    coverage: module.coverage ?? module.summary,
    licence: module.info.licence,
    attribution: module.info.attribution,
    homepage: module.info.homepage,
    searchable: Boolean(module.search),
    operations: module.tools.map((t) => ({ name: t.name, title: t.title, description: shortDescription(t.description) }))
  };
}

function registerResources(server: McpServer, modules: SourceModule[]) {
  server.registerResource(
    "source",
    new ResourceTemplate("ireland://sources/{id}", {
      list: async () => ({
        resources: modules.map((m) => ({
          uri: `ireland://sources/${m.info.id}`,
          name: m.info.id,
          title: m.info.name,
          description: m.summary,
          mimeType: "application/json"
        }))
      })
    }),
    { title: "Irish data source", description: "Licence, attribution, coverage and operations for one source.", mimeType: "application/json" },
    async (uri, { id }) => {
      const module = modules.find((m) => m.info.id === id);
      if (!module) throw new Error(`Unknown source "${String(id)}".`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(sourceDoc(module), null, 2) }] };
    }
  );
}

function registerPrompts(server: McpServer) {
  const user = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });
  server.registerPrompt(
    "area_profile",
    { title: "Area profile", description: "Profile an Irish place: population, boundaries, weather and property.", argsSchema: { place: z.string() } },
    ({ place }) =>
      user(
        `Build a short profile of ${place}, Ireland. Use ireland_call with cross/ireland_snapshot (place) for population, boundaries and weather, then ppr/ppr_price_stats (county) for property prices. Cite every source with its licence.`
      )
  );
  server.registerPrompt(
    "commute_check",
    { title: "Commute check", description: "Live departures and disruption for a rail or Luas station.", argsSchema: { station: z.string() } },
    ({ station }) =>
      user(
        `Check the commute from ${station}. Use ireland_call with irish-rail/rail_find_station then rail_get_departures; if it is a Luas stop use luas/luas_get_forecast (stop). Summarise the next departures and any delays.`
      )
  );
  server.registerPrompt(
    "compare_counties",
    {
      title: "Compare counties",
      description: "Compare Irish counties on one metric using CSO data.",
      argsSchema: { metric: z.string(), counties: z.string() }
    },
    ({ metric, counties }) =>
      user(
        `Compare these Irish counties on ${metric}: ${counties}. Use ireland_catalogue (domain stats), then cso/cso_search_tables to find a table, ireland_describe and ireland_call cso_get_data filtered to those counties. Present a small table and cite the CSO table code.`
      )
  );
}

/**
 * Runs a typed tool: validates args (an optional `max_tokens` is taken out first), calls the handler,
 * caps the result at the token budget and returns it as text plus structuredContent.
 */
export async function runTool(
  tool: AnyTool,
  source: string,
  args: unknown,
  context: ToolContext,
  sink: TelemetrySink = noopSink
): Promise<ToolResult> {
  const started = Date.now();
  try {
    const { max_tokens: maxTokens, ...rest } = (isPlainObject(args) ? args : {}) as Record<string, unknown>;
    const parsed = z.object(tool.inputSchema).safeParse(rest);
    if (!parsed.success) throw badArgs(parsed.error);
    const result = await tool.handler(parsed.data, context);
    const flags = (result ?? {}) as { cached?: boolean; stale?: boolean };
    sink({
      tool: tool.name,
      source,
      durationMs: Date.now() - started,
      outcome: "ok",
      ...(typeof flags.cached === "boolean" ? { cached: flags.cached } : {}),
      ...(flags.stale ? { stale: true } : {})
    });
    const budget = typeof maxTokens === "number" ? maxTokens : tool.raw ? MAX_MAX_TOKENS : DEFAULT_MAX_TOKENS;
    return ok(applyBudget(result, budget, { annotate: !tool.raw }));
  } catch (error) {
    const toolError = toToolError(error);
    sink({ tool: tool.name, source, durationMs: Date.now() - started, outcome: "error", errorCode: toolError.code });
    return fail(toolError.toJSON());
  }
}
