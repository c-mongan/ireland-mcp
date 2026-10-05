import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolError, toToolError } from "./errors.js";
import type { AnyTool, SourceModule, ToolContext } from "./module.js";
import { noopSink, type TelemetrySink } from "./telemetry.js";

export const SERVER_NAME = "ireland-mcp";
export const SERVER_VERSION = "1.0.0";

const INSTRUCTIONS = [
  "Read-only access to Irish public data.",
  "Every result is an evidence envelope: cite `source`, `url`, `licence` and `attribution` when you use `data`.",
  "If `stale` is true the upstream was unavailable and the cached copy was served; say so.",
  "If `truncated` is true there were more rows than the limit; narrow the query or raise `limit` (max 500).",
  "Start with `list_sources` or `search` when unsure which source to use."
].join(" ");

export interface BuildServerOptions {
  modules: SourceModule[];
  extraTools?: AnyTool[];
  context: ToolContext;
  telemetry?: TelemetrySink;
}

export function allTools(modules: SourceModule[], extraTools: AnyTool[] = []): Array<{ tool: AnyTool; source: string }> {
  return [
    ...modules.flatMap((module) => module.tools.map((tool) => ({ tool, source: module.info.id }))),
    ...extraTools.map((tool) => ({ tool, source: "cross" }))
  ];
}

export function buildServer(options: BuildServerOptions): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const sink = options.telemetry ?? noopSink;
  const seen = new Set<string>();

  for (const { tool, source } of allTools(options.modules, options.extraTools)) {
    if (seen.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    seen.add(tool.name);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: tool.title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true
        }
      },
      async (args: unknown) => runTool(tool, source, args, options.context, sink)
    );
  }
  return server;
}

export async function runTool(
  tool: AnyTool,
  source: string,
  args: unknown,
  context: ToolContext,
  sink: TelemetrySink = noopSink
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const started = Date.now();
  try {
    const parsed = z.object(tool.inputSchema).safeParse(args ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new ToolError("BAD_ARGS", `Invalid arguments: ${detail}`);
    }
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
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    const toolError = toToolError(error);
    sink({ tool: tool.name, source, durationMs: Date.now() - started, outcome: "error", errorCode: toolError.code });
    return { isError: true, content: [{ type: "text", text: JSON.stringify(toolError.toJSON()) }] };
  }
}
