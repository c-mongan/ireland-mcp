import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnyTool, SourceModule, ToolContext } from "./gateway/module.js";
import { buildServer } from "./gateway/server.js";
import type { TelemetrySink } from "./gateway/telemetry.js";

export const sourceModules: SourceModule[] = [];

export function crossSourceTools(_modules: SourceModule[]): AnyTool[] {
  return [];
}

export function createAppServer(context: ToolContext, telemetry?: TelemetrySink): McpServer {
  return buildServer({
    modules: sourceModules,
    extraTools: crossSourceTools(sourceModules),
    context,
    ...(telemetry ? { telemetry } : {})
  });
}
