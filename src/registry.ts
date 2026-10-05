import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnyTool, SourceModule, ToolContext } from "./gateway/module.js";
import { buildServer } from "./gateway/server.js";
import type { TelemetrySink } from "./gateway/telemetry.js";
import { csoModule } from "./sources/cso/index.js";
import { dataGovIeModule } from "./sources/data-gov-ie/index.js";
import { geohiveModule } from "./sources/geohive/index.js";
import { legislationModule } from "./sources/legislation/index.js";
import { metModule } from "./sources/met-eireann/index.js";
import { ntaModule } from "./sources/nta/index.js";
import { pprModule } from "./sources/ppr/index.js";
import { oireachtasModule } from "./sources/oireachtas/index.js";
import { smartDublinModule } from "./sources/smart-dublin/index.js";

export const sourceModules: SourceModule[] = [csoModule, oireachtasModule, geohiveModule, dataGovIeModule, smartDublinModule, metModule, ntaModule, legislationModule, pprModule];

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
