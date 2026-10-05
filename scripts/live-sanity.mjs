#!/usr/bin/env node
// Live sanity check: one real upstream call per source. Not run in unit tests; used locally and by the nightly live-smoke workflow.
// Usage: npm run build && npm run live:sanity [-- --json]
// Surface: by default every case goes through the lean meta tools (ireland_call {source, operation, args});
// EVAL_TOOLSETS=all calls the typed tools directly instead. Either way it is a real MCP client round trip.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createContext } from "../dist/src/gateway/context.js";
import { createAppServer } from "../dist/src/registry.js";

const year = new Date().getUTCFullYear();
const CASES = [
  ["cso", "cso_area_profile", { area: "Galway" }, (d) => d.census?.length > 0],
  ["oireachtas", "oireachtas_search_bills", { query: "housing", limit: 3 }, (d) => JSON.stringify(d).length > 50],
  ["geohive", "geohive_boundaries_at_point", { lat: 53.3498, lon: -6.2603 }, (d) => d.county?.name],
  ["data-gov-ie", "datagov_search_datasets", { query: "population", limit: 3 }, (d) => d.total > 0],
  ["smart-dublin", "smartdublin_search_datasets", { query: "bike", limit: 3 }, (d) => d.total > 0],
  ["met-eireann", "met_get_forecast", { lat: 53.3498, lon: -6.2603, hours: 3 }, (d) => d.forecast?.length === 3],
  ["met-eireann", "met_get_warnings", {}, (d) => Array.isArray(d.warnings)],
  ["nta", "nta_get_realtime_summary", { limit: 3 }, (d) => d.entities > 0 || d.trip_updates > 0, { needsEnv: "NTA_API_KEY" }],
  ["legislation", "legislation_list_acts", { year: year - 1, limit: 3 }, (d) => JSON.stringify(d).includes("title")],
  ["ppr", "ppr_price_stats", { county: "Galway" }, (d) => d.count > 0],
  ["irish-rail", "rail_get_departures", { station: "Dublin Connolly", minutes: 90 }, (d) => d.station?.code === "CNLLY"],
  ["luas", "luas_get_forecast", { stop: "Heuston" }, (d) => d.stop?.code && Array.isArray(d.inbound)],
  ["eirgrid", "grid_get_status", { region: "ALL" }, (d) => d.demand_mw > 0],
  ["marine", "marine_get_buoys", {}, (d) => d.count > 0],
  ["opw-water", "water_get_level", { station: "Athlone" }, (d) => d.station?.level_m !== null && d.history?.readings > 0],
  ["planning", "planning_search", { lat: 53.3498, lon: -6.2603, radius_m: 1000, text: "apartments", from: "2024-01-01", limit: 2 }, (d) => d.count > 0],
  ["planning", "planning_get", { application_ref: "WEB1741/25" }, (d) => d.count > 0],
  ["census-areas", "census_small_area_at", { lat: 53.3498, lon: -6.2603 }, (d) => d.area?.small_area?.population > 0],
  ["heritage", "heritage_monuments_near", { lat: 53.3498, lon: -6.2603, radius_m: 1000, limit: 2 }, (d) => d.count > 0],
  ["environment-sites", "protected_sites_near", { lat: 53.33, lon: -6.16, radius_m: 5000, limit: 4 }, (d) => d.count > 0],
  ["cross", "search", { query: "population" }, (d) => d.results?.length > 0, { raw: true }],
  ["cross", "ireland_snapshot", { place: "Galway" }, (d) => d.population?.area && d.boundaries?.county]
];

const toolsets = process.env.EVAL_TOOLSETS?.trim() || undefined;
const server = createAppServer(createContext(), undefined, toolsets);
const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: "live-sanity", version: "1.0.0" });
await client.connect(clientSide);
const listed = new Set((await client.listTools()).tools.map((t) => t.name));
// Typed tools listed on this surface are called directly; everything else goes through ireland_call.
const call = (source, name, args) =>
  listed.has(name)
    ? client.callTool({ name, arguments: args })
    : client.callTool({ name: "ireland_call", arguments: { source, operation: name, args } });
const results = [];

for (const [source, name, args, ok, opts = {}] of CASES) {
  if (opts.needsEnv && !process.env[opts.needsEnv]) {
    results.push({ source, tool: name, status: "SKIP", ms: 0, note: `${opts.needsEnv} not set` });
    continue;
  }
  const started = Date.now();
  try {
    const r = await call(source, name, args);
    const body = JSON.parse(r.content[0].text);
    const data = opts.raw ? body : body.data;
    const pass = !r.isError && Boolean(ok(data ?? {}));
    results.push({
      source,
      tool: name,
      status: pass ? "PASS" : "FAIL",
      ms: Date.now() - started,
      note: r.isError ? `${body.error?.code}: ${body.error?.message}` : body.stale ? "served stale" : ""
    });
  } catch (error) {
    results.push({ source, tool: name, status: "FAIL", ms: Date.now() - started, note: String(error?.message ?? error) });
  }
}

await client.close();
if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 2));
else {
  console.log(`Surface: ${toolsets ? `toolsets=${toolsets}` : "default (meta tools)"}, ${listed.size} tools listed.\n`);
  console.log(`| Source | Tool | Result | ms | Note |\n|---|---|---|---|---|`);
  for (const r of results) console.log(`| ${r.source} | ${r.tool} | ${r.status} | ${r.ms} | ${r.note.replace(/\|/g, "/").slice(0, 120)} |`);
}
process.exit(results.some((r) => r.status === "FAIL") ? 1 : 0);
