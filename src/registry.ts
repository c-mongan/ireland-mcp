import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SourceModule, ToolContext } from "./gateway/module.js";
import { crossInfo, crossSourceTools } from "./cross/index.js";
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
import { irishRailModule } from "./sources/irish-rail/index.js";
import { luasModule } from "./sources/luas/index.js";
import { eirgridModule } from "./sources/eirgrid/index.js";
import { ecbModule } from "./sources/ecb/index.js";
import { eurostatModule } from "./sources/eurostat/index.js";
import { marineModule } from "./sources/marine/index.js";
import { opwWaterModule } from "./sources/opw-water/index.js";
import { planningModule } from "./sources/planning/index.js";
import { censusAreasModule } from "./sources/census-areas/index.js";
import { heritageModule } from "./sources/heritage/index.js";
import { environmentSitesModule } from "./sources/environment-sites/index.js";
import { tedModule } from "./sources/ted/index.js";
import { bikesModule } from "./sources/bikes/index.js";
import { wikidataModule } from "./sources/wikidata/index.js";

export const sourceModules: SourceModule[] = [
  csoModule,
  eurostatModule,
  ecbModule,
  oireachtasModule,
  geohiveModule,
  wikidataModule,
  dataGovIeModule,
  smartDublinModule,
  metModule,
  ntaModule,
  legislationModule,
  pprModule,
  irishRailModule,
  luasModule,
  eirgridModule,
  marineModule,
  opwWaterModule,
  planningModule,
  censusAreasModule,
  heritageModule,
  environmentSitesModule,
  tedModule,
  bikesModule
];

/**
 * The cross-source tools split in two: `search`/`fetch` stay top-level for the ChatGPT contract, while
 * list_sources, nearby and ireland_snapshot become operations of a "cross" source (nearby is also pinned).
 */
export function appModules(modules: SourceModule[] = sourceModules): { modules: SourceModule[]; extraTools: ReturnType<typeof crossSourceTools> } {
  const cross = crossSourceTools(modules);
  const raw = cross.filter((t) => t.raw);
  const crossModule: SourceModule = {
    info: crossInfo,
    summary: "Combined lookups: what is at a point (nearby), a one-call place snapshot, and the source list.",
    domain: "places/property",
    coverage: "Combines GeoHive boundaries, Met Éireann forecasts and warnings and CSO census population for any point or major place in Ireland.",
    tools: cross.filter((t) => !t.raw)
  };
  return { modules: [...modules, crossModule], extraTools: raw };
}

/** Builds the MCP server. `toolsets` is a comma list of source ids (or "all") whose typed tools are listed. */
export function createAppServer(context: ToolContext, telemetry?: TelemetrySink, toolsets?: string): McpServer {
  return buildServer({
    ...appModules(),
    context,
    ...(telemetry ? { telemetry } : {}),
    ...(toolsets ? { toolsets } : {})
  });
}
