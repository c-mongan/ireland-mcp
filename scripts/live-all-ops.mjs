#!/usr/bin/env node
// Live all-operations proof. Uses a real MCP client transport against stdio dist/src/cli.js
// or a deployed Streamable HTTP endpoint (--url https://.../mcp), and calls every catalogue operation via ireland_call.
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { appModules } from "../dist/src/registry.js";

const DEPLOYED_URL = "https://func-ireland-mcp-aofsjpwgy4hva.azurewebsites.net/mcp";
const DEFAULT_TOOLS = ["search", "fetch", "nearby", "ireland_catalogue", "ireland_describe", "ireland_about", "ireland_call"];
const TODAY = new Date().toISOString().slice(0, 10);
const REPORT_PATH = new URL("../docs/live-all-ops.md", import.meta.url);
let REQUEST_DELAY_MS = 0;

const SAMPLE_ARGS = {
  "oireachtas/ oireachtas_search_members": { name: "Harris", limit: 3 },
  "oireachtas/ oireachtas_search_bills": { query: "housing", year: "2024", limit: 3 },
  "oireachtas/ oireachtas_get_debates": { chamber: "dail", limit: 2, max_sections: 5 },
  "oireachtas/ oireachtas_search_questions": { type: "written", limit: 2 },
  "oireachtas/ oireachtas_get_votes": { chamber: "dail", limit: 2 },
  "world-bank/ worldbank_get_indicator": { indicator: "SP.POP.TOTL", country: "IRL", last: 2 },
  "world-bank/ worldbank_ireland_profile": { last: 1 },
  "pobal/ pobal_deprivation_search": { query: "Galvone", limit: 3 },
  "cro/ cro_search_datasets": { query: "company", limit: 3 },
  "cro/ cro_get_dataset": { id: "companies" },
  "cro/ cro_query_datastore": { resource_id: "3fef41bc-b8f4-4b10-8434-ce51c29b1bba", limit: 3 },
  "kohesio/ kohesio_search_projects": { query: "Galway", limit: 3 },
  "kohesio/ kohesio_get_project": { id: "Q232198" },
  "geohive/ geohive_boundaries_at_point": { lat: 53.3498, lon: -6.2603 },
  "geohive/ geohive_list_layers": { query: "county", limit: 5 },
  "data-gov-ie/ datagov_search_datasets": { query: "population", limit: 3 },
  "data-gov-ie/ datagov_get_dataset": { id: "moby-bikes" },
  "smart-dublin/ smartdublin_search_datasets": { query: "bike", limit: 3 },
  "smart-dublin/ smartdublin_get_dataset": { id: "moby-bikes" },
  "met-eireann/ met_get_forecast": { lat: 53.3498, lon: -6.2603, hours: 3 },
  "met-eireann/ met_get_observations": { station: "Dublin Airport" },
  "met-eireann/ met_get_warnings": {},
  "nta/ nta_get_realtime_summary": { limit: 3 },
  "nta/ nta_get_trip_updates": { limit: 3 },
  "legislation/ legislation_list_acts": { year: 2018, limit: 3 },
  "legislation/ legislation_get_act": { year: 2018, number: 7 },
  "legislation/ legislation_get_section": { year: 2018, number: 7, section: "2" },
  "ppr/ ppr_price_stats": { county: "Galway" },
  "irish-rail/ rail_find_station": { query: "Pearse" },
  "irish-rail/ rail_get_departures": { station: "Dublin Connolly", minutes: 90 },
  "luas/ luas_get_forecast": { stop: "St. Stephen's Green" },
  "luas/ luas_list_stops": {},
  "eirgrid/ grid_get_status": { region: "ALL" },
  "marine/ marine_get_buoys": {},
  "opw-water/ water_find_stations": { query: "Athlone", limit: 5 },
  "opw-water/ water_get_level": { station: "Athlone", hours: 24 },
  "ted/ ted_search_tenders": { text: "bicycle", limit: 3 },
  "bikes/ bikes_networks": {},
  "bikes/ bikes_stations_near": { lat: 53.3498, lon: -6.2603, radius: 1000, network: "dublinbikes" },
  "epa/ epa_wfd_search": { query: "Suir", limit: 3 },
  "epa/ epa_wfd_waterbody": { code: "IE_SE_16B020080" },
  "cross/ list_sources": {},
  "cross/ nearby": { lat: 53.3498, lon: -6.2603, hours: 3 }
};

function key(source, operation) {
  return `${source}/ ${operation}`;
}

function localExamples() {
  const { modules } = appModules();
  const examples = new Map();
  for (const m of modules) {
    for (const tool of m.tools) {
      if (tool.example) examples.set(key(m.info.id, tool.name), tool.example);
    }
  }
  return { examples };
}

function parseArgs() {
  const out = { url: null, json: false, delayMs: null };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--deployed") out.url = DEPLOYED_URL;
    else if (arg === "--url") out.url = process.argv[++i] ?? DEPLOYED_URL;
    else if (arg.startsWith("--url=")) out.url = arg.slice("--url=".length) || DEPLOYED_URL;
    else if (arg === "--delay-ms") out.delayMs = Number(process.argv[++i] ?? "0");
    else if (arg.startsWith("--delay-ms=")) out.delayMs = Number(arg.slice("--delay-ms=".length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function connect(url) {
  const make = () => {
    const client = new Client({ name: "live-all-ops", version: "1.0.0" });
    const transport = url
      ? new StreamableHTTPClientTransport(new URL(url))
      : new StdioClientTransport({ command: process.execPath, args: ["dist/src/cli.js"], stderr: "pipe", cwd: process.cwd(), maxBufferSize: 30 * 1024 * 1024 });
    return { client, transport };
  };
  let pair = make();
  try {
    await pair.client.connect(pair.transport);
  } catch (error) {
    if (url && /RATE_LIMITED|too many requests/i.test(String(error?.message ?? error))) {
      await sleep(65_000);
      pair = make();
      await pair.client.connect(pair.transport);
    } else {
      throw error;
    }
  }
  return pair;
}

function bodyOf(result) {
  try {
    return JSON.parse(result.content?.[0]?.text ?? "{}");
  } catch {
    return { raw: result.content?.[0]?.text ?? "" };
  }
}

function statusOf(result) {
  const body = bodyOf(result);
  if (!result.isError) return { status: "PASS", body };
  const code = body.error?.code ?? "ERROR";
  if (code === "NOT_CONFIGURED") return { status: "NOT_CONFIGURED", body };
  if (
    body.operation?.startsWith("kohesio_") &&
    code === "UPSTREAM_DOWN" &&
    (/HTTP 403/.test(body.error?.message ?? "") || /Kohesio blocks some cloud-hosted IPs/.test(body.error?.hint ?? ""))
  ) {
    return { status: "HOSTED_BLOCKED", body };
  }
  return { status: "FAIL", body };
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return null;
  for (const k of ["count", "total", "total_cells", "entities", "trips", "sources"]) {
    const v = value[k];
    if (typeof v === "number") return v;
    if (Array.isArray(v)) return v.length;
  }
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v)) return `${v.length} ${k}`;
  }
  return null;
}

function summarise(result) {
  const body = bodyOf(result);
  if (result.isError) {
    const e = body.error ?? {};
    return `${e.code ?? "ERROR"}: ${e.message ?? "Unknown error"}${e.hint ? ` Hint: ${e.hint}` : ""}`;
  }
  const data = body.data ?? body;
  const rows = countRows(data);
  if (rows !== null) return `rows=${rows}${body.stale ? "; stale cache" : ""}${body.truncated ? "; truncated" : ""}`;
  if (data && typeof data === "object") return `${Object.keys(data).slice(0, 6).join(", ") || "ok"}${body.stale ? "; stale cache" : ""}`;
  return String(data).slice(0, 160);
}

async function timed(label, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return { label, ms: Date.now() - started, result, ...statusOf(result), summary: summarise(result) };
  } catch (error) {
    return { label, ms: Date.now() - started, status: "FAIL", body: {}, summary: String(error?.message ?? error) };
  }
}

function catalogueOps(catalogueBody) {
  const ops = [];
  for (const domain of catalogueBody.domains ?? []) {
    for (const source of domain.sources ?? []) {
      for (const operation of source.operations ?? []) ops.push({ source: source.id, operation });
    }
  }
  return ops;
}

async function callTool(client, name, args) {
  let result;
  try {
    result = await client.callTool({ name, arguments: args });
  } catch (error) {
    if (REQUEST_DELAY_MS > 0 && /RATE_LIMITED|too many requests/i.test(String(error?.message ?? error))) {
      await sleep(65_000);
      result = await client.callTool({ name, arguments: args });
    } else {
      throw error;
    }
  }
  if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  return result;
}

async function listTools(client) {
  let result;
  try {
    result = await client.listTools();
  } catch (error) {
    if (REQUEST_DELAY_MS > 0 && /RATE_LIMITED|too many requests/i.test(String(error?.message ?? error))) {
      await sleep(65_000);
      result = await client.listTools();
    } else {
      throw error;
    }
  }
  if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);
  return result;
}

async function callOperation(client, op, sample) {
  const args = { source: op.source, operation: op.operation, args: sample, max_tokens: 4000 };
  const first = await callTool(client, "ireland_call", args);
  const { status, body } = statusOf(first);
  if (op.source === "wikidata" && status === "FAIL" && body.error?.code === "UPSTREAM_DOWN") {
    await sleep(1500);
    const second = await callTool(client, "ireland_call", args);
    if (!second.isError) {
      const parsed = bodyOf(second);
      parsed.live_all_note = "Passed after retry; Wikidata Query Service is occasionally slow.";
      second.content[0].text = JSON.stringify(parsed);
    }
    return second;
  }
  return first;
}

async function exerciseDefaultTools(client) {
  const listed = (await listTools(client)).tools.map((t) => t.name).sort();
  const missing = DEFAULT_TOOLS.filter((name) => !listed.includes(name));
  if (missing.length || listed.length !== DEFAULT_TOOLS.length) {
    throw new Error(`Default tools mismatch. Listed=${listed.join(", ")} missing=${missing.join(", ")}`);
  }
  const checks = [
    ["ireland_catalogue", {}],
    ["ireland_about", {}],
    ["search", { query: "population" }],
    ["fetch", { id: "cso:F1001" }],
    ["nearby", { lat: 53.3498, lon: -6.2603, hours: 1 }],
    ["ireland_describe", { source: "cso", operation: "cso_area_profile" }],
    ["ireland_call", { source: "cso", operation: "cso_area_profile", args: { area: "Galway" } }]
  ];
  const rows = [];
  for (const [name, args] of checks) rows.push(await timed(name, () => callTool(client, name, args)));
  return rows;
}

async function main() {
  const args = parseArgs();
  REQUEST_DELAY_MS = args.delayMs ?? (args.url ? 1100 : 0);
  const target = args.url ? args.url : "local stdio dist/src/cli.js";
  const { examples } = localExamples();
  const { client } = await connect(args.url);
  const defaultRows = [];
  const opRows = [];
  const errors = [];
  try {
    defaultRows.push(...(await exerciseDefaultTools(client)));
    const catalogue = await callTool(client, "ireland_catalogue", {});
    const ops = catalogueOps(bodyOf(catalogue));
    if (!ops.length) throw new Error("ireland_catalogue returned no operations.");

    const missingSamples = ops.filter((op) => !examples.has(key(op.source, op.operation)) && !Object.hasOwn(SAMPLE_ARGS, key(op.source, op.operation)));
    if (missingSamples.length) {
      throw new Error(`Missing live:all sample args for: ${missingSamples.map((op) => key(op.source, op.operation)).join(", ")}`);
    }

    for (const op of ops) {
      const sample = SAMPLE_ARGS[key(op.source, op.operation)] ?? examples.get(key(op.source, op.operation));
      opRows.push(
        await timed(`${op.source}/${op.operation}`, () =>
          callOperation(client, op, sample)
        )
      );
    }

    const unknown = await timed("error/unknown-operation", () =>
      callTool(client, "ireland_call", { source: "cso", operation: "cso_nope", args: {} })
    );
    const unknownBody = bodyOf(unknown.result);
    if (unknown.status !== "FAIL" || !/cso_/.test(unknownBody.error?.hint ?? "")) {
      unknown.status = "FAIL";
      unknown.summary = `Unknown-op guard did not include valid operations hint: ${unknown.summary}`;
    } else {
      unknown.status = "PASS";
    }
    errors.push(unknown);

    const badArgs = await timed("error/bad-args", () =>
      callTool(client, "ireland_call", { source: "cso", operation: "cso_get_data", args: { table_code: "F1001", filters: { NOPE: ["x"] } } })
    );
    const badBody = bodyOf(badArgs.result);
    if (badArgs.status !== "FAIL" || badBody.error?.code !== "BAD_ARGS") {
      badArgs.status = "FAIL";
      badArgs.summary = `Bad-args guard did not return BAD_ARGS: ${badArgs.summary}`;
    } else {
      badArgs.status = "PASS";
    }
    errors.push(badArgs);
  } finally {
    await client.close();
  }

  const mdRows = opRows.map((row) => {
    const [source, operation] = row.label.split("/");
    return `| ${source} | ${operation} | ${row.status} | ${row.ms} | ${String(row.summary).replaceAll("|", "/").slice(0, 220)} | ${TODAY} |`;
  });
  const pass = opRows.filter((r) => r.status === "PASS").length;
  const notConfigured = opRows.filter((r) => r.status === "NOT_CONFIGURED").length;
  const hostedBlocked = opRows.filter((r) => r.status === "HOSTED_BLOCKED").length;
  const fail = opRows.filter((r) => r.status === "FAIL").length;
  const report = [
    "# Live all-operations report",
    "",
    `Target: ${target}`,
    `Generated: ${new Date().toISOString()}`,
    `Operations: ${pass} PASS, ${notConfigured} NOT_CONFIGURED, ${hostedBlocked} HOSTED_BLOCKED, ${fail} FAIL.`,
    "",
    "Known hosted limitation: Kohesio may return HTTP 403 from cloud-hosted IPs. If that happens, run Ireland MCP locally with npx/stdio for Kohesio.",
    "",
    "## Default tool exercise",
    "",
    "| Tool | Status | Latency ms | Summary |",
    "| --- | --- | ---: | --- |",
    ...defaultRows.map((row) => `| ${row.label} | ${row.status} | ${row.ms} | ${String(row.summary).replaceAll("|", "/").slice(0, 220)} |`),
    "",
    "## Error-path exercise",
    "",
    "| Check | Status | Latency ms | Summary |",
    "| --- | --- | ---: | --- |",
    ...errors.map((row) => `| ${row.label} | ${row.status} | ${row.ms} | ${String(row.summary).replaceAll("|", "/").slice(0, 220)} |`),
    "",
    "## Operations",
    "",
    "| Source | Operation | Status | Latency ms | Row count / summary | Date |",
    "| --- | --- | ---: | ---: | --- | --- |",
    ...mdRows,
    ""
  ].join("\n");
  await mkdir(new URL("../docs/", import.meta.url), { recursive: true });
  await writeFile(REPORT_PATH, report);

  const summary = { target, default: defaultRows, errors, operations: opRows, counts: { pass, notConfigured, hostedBlocked, fail }, report: "docs/live-all-ops.md" };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`Target: ${target}`);
    console.log(`Operations: ${pass} PASS, ${notConfigured} NOT_CONFIGURED, ${hostedBlocked} HOSTED_BLOCKED, ${fail} FAIL.`);
    console.log(`Default tools: ${defaultRows.filter((r) => r.status === "PASS").length}/${defaultRows.length} PASS.`);
    console.log(`Error paths: ${errors.filter((r) => r.status === "PASS").length}/${errors.length} PASS.`);
    console.log(`Report: docs/live-all-ops.md`);
  }
  if (fail || defaultRows.some((r) => r.status !== "PASS") || errors.some((r) => r.status !== "PASS")) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
