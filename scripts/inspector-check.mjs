#!/usr/bin/env node
// MCP conformance check: drives the built stdio server through the official MCP Inspector CLI.
// Run `npm run build` first. Uses no upstream network calls (list_sources and argument validation only).
import { execFileSync } from "node:child_process";

const INSPECTOR = "@modelcontextprotocol/inspector@2.9.0";
const NAME = /^[a-z][a-z0-9_]{2,63}$/;
const CROSS = ["search", "fetch", "list_sources", "ireland_snapshot", "nearby", "ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about"];
const SOURCES = ["cso", "oireachtas", "geohive", "datagov", "smartdublin", "met", "nta", "legislation", "ppr"];

function inspect(...args) {
  let out;
  try {
    // toolsets=all so the typed tools are checked too; the default surface is covered by the vitest budget test.
    out = execFileSync("npx", ["-y", INSPECTOR, "--cli", "node", "dist/src/cli.js", ...args, "-e", "IRELAND_MCP_TOOLSETS=all"], {
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    // The Inspector CLI exits non-zero when a tool returns isError; the result is still on stdout.
    if (!error.stdout) throw error;
    out = error.stdout;
  }
  return JSON.parse(out);
}

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

const { tools } = inspect("--method", "tools/list");
const names = tools.map((t) => t.name);
check(new Set(names).size === names.length, "tool names are unique");
for (const name of CROSS) check(names.includes(name), `cross-source tool ${name} is registered`);
for (const prefix of SOURCES) check(names.some((n) => n.startsWith(`${prefix}_`)), `at least one ${prefix}_* tool is registered`);
for (const t of tools) {
  check(NAME.test(t.name), `${t.name}: name matches ${NAME}`);
  check(t.description && t.description.length >= 20, `${t.name}: has a useful description`);
  check(t.inputSchema?.type === "object", `${t.name}: inputSchema is an object`);
  check(t.outputSchema?.type === "object", `${t.name}: outputSchema is an object`);
  check(t.annotations?.readOnlyHint === true, `${t.name}: readOnlyHint`);
  check(t.annotations?.openWorldHint === true, `${t.name}: openWorldHint`);
  check(t.annotations?.destructiveHint === false, `${t.name}: not destructive`);
  const limit = t.inputSchema?.properties?.limit;
  if (limit) check(limit.maximum <= 500, `${t.name}: limit capped at 500`);
}

const listed = inspect("--method", "tools/call", "--tool-name", "list_sources");
const envelope = JSON.parse(listed.content[0].text);
check(!listed.isError && envelope.data.sources.length >= 9, "list_sources returns every source");
check(envelope.data.sources.every((s) => s.licence && s.attribution), "every source declares licence and attribution");

const bad = inspect("--method", "tools/call", "--tool-name", "cso_get_data", "--tool-arg", "table_code=population");
check(bad.isError === true && JSON.parse(bad.content[0].text).error?.code === "BAD_ARGS", "a non-table code returns a typed BAD_ARGS error");
const schema = inspect("--method", "tools/call", "--tool-name", "cso_get_data", "--tool-arg", "table_code=x");
check(schema.isError === true, "schema-invalid arguments are rejected");

if (failures.length) {
  console.error(`MCP conformance FAILED (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`MCP conformance OK: ${tools.length} tools, ${envelope.data.sources.length} sources.`);
