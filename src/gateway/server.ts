import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exampleArgs, listOperations, operationSchema, shortDescription, type Operation } from "./catalogue.js";
import { applyBudget, DEFAULT_MAX_TOKENS, MAX_MAX_TOKENS } from "./envelope.js";
import { ToolError, toToolError } from "./errors.js";
import { DOMAINS, type AnyTool, type SourceModule, type ToolContext } from "./module.js";
import { noopSink, type TelemetrySink } from "./telemetry.js";
import { ALL_TOOLSETS, resolveToolsets } from "./toolsets.js";

export const SERVER_NAME = "ireland-mcp";
export const SERVER_VERSION = "1.1.1";
export const HOSTED_URL = "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net";
export const REPO_URL = "https://github.com/c-mongan/ireland-mcp";

export const INSTRUCTIONS = [
  "Read-only Irish public data (CSO, Oireachtas, Met Éireann, transport, property, energy and more).",
  "Workflow: ireland_call's description indexes every source and operation; when one fits, call ireland_call with {source, operation, args} directly (bad args return the schema and an example).",
  "Otherwise use ireland_catalogue to browse, and ireland_describe for an operation's argument schema.",
  "search/fetch is keyword discovery (CSO tables, bills, acts, datasets, tenders). nearby covers boundaries, small area code, forecast, monuments and protected sites at a lat/lon only.",
  "Use ireland_call for live readings (weather observations, river levels, buoys, bikes), populations (cso_area_profile, census_small_area_at) and place names (geohive_locate).",
  "Cite `source`, `url`, `licence` and `attribution` from each result.",
  "If `stale` is true the cached copy was served; say so.",
  "If `truncated` is true, narrow the request or pass max_tokens (up to 8000).",
  "Typed tools per source can be enabled with ?toolsets=<id>,… (HTTP) or --toolsets (stdio)."
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
function tagOperation(result: ToolResult, source: string, operation: string): ToolResult {
  const content = result.content.map((part, i) =>
    i === 0 && part.text.startsWith("{") && part.text !== "{}"
      ? { ...part, text: `{"operation":${JSON.stringify(operation)},${part.text.slice(1)}` }
      : part
  );
  return {
    ...result,
    content,
    ...(result.structuredContent ? { structuredContent: { operation, ...result.structuredContent } } : {}),
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

  const seen = new Set<string>(["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about"]);
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

function catalogueOf(modules: SourceModule[], domain?: string) {
  return {
    domains: DOMAINS.filter((d) => !domain || d === domain)
      .map((d) => ({
        domain: d,
        sources: modules
          .filter((m) => m.domain === d)
          .map((m) => ({ id: m.info.id, name: m.info.name, summary: m.summary, operations: m.tools.map((t) => t.name) }))
      }))
      .filter((d) => d.sources.length > 0),
    next: "ireland_describe(source, operation) for arguments, then ireland_call."
  };
}

function findOperation(modules: SourceModule[], source: string, operation: string): Operation {
  const module = modules.find((m) => m.info.id === source);
  if (!module) {
    throw new ToolError("NOT_FOUND", `Unknown source "${source}".`, {
      hint: `Valid sources: ${modules.map((m) => m.info.id).join(", ")}. Call ireland_catalogue to browse.`
    });
  }
  const tool = module.tools.find((t) => t.name === operation);
  if (!tool) {
    throw new ToolError("NOT_FOUND", `Source "${source}" has no operation "${operation}".`, {
      hint: `Operations for ${source}: ${module.tools.map((t) => t.name).join(", ")}.`
    });
  }
  return { tool, source };
}

function describeOperation({ tool, source }: Operation) {
  return {
    source,
    operation: tool.name,
    title: tool.title,
    description: tool.description,
    input_schema: operationSchema(tool),
    example: exampleArgs(tool),
    call: { tool: "ireland_call", arguments: { source, operation: tool.name, args: exampleArgs(tool) } }
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
      description: `List sources and their operations, grouped by domain: ${DOMAINS.join(", ")}. Start here.`,
      inputSchema: { domain: z.enum(DOMAINS).optional().describe("Only this domain.") },
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "Catalogue of Irish data sources", ...ANNOTATIONS }
    },
    async ({ domain }) => guarded(() => catalogueOf(modules, domain))
  );

  server.registerTool(
    "ireland_describe",
    {
      title: "Describe an operation",
      description: "Argument JSON schema, description and an example for one source operation.",
      inputSchema: { source: z.string().describe("Source id, e.g. 'cso'."), operation: z.string().describe("Operation, e.g. 'cso_get_data'.") },
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: "Describe an operation", ...ANNOTATIONS }
    },
    async ({ source, operation }) => guarded(() => describeOperation(findOperation(modules, source, operation)))
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
      return tagOperation(result, op.source, op.tool.name);
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
          default: "Meta tools only (ireland_catalogue, ireland_describe, ireland_call, ireland_about, search, fetch, nearby).",
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
