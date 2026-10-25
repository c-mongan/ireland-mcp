#!/usr/bin/env node
// Bounded, read-only live proof over local stdio or an explicitly supplied hosted MCP endpoint.
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const { values } = parseArgs({ options: { url: { type: "string" } } });
const endpoint = values.url ? new URL(values.url) : undefined;
if (endpoint) assert.ok(["https:", "http:"].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, "Use a plain HTTP(S) MCP URL without credentials, query or fragment");
const client = new Client({ name: "ireland-civic-live-check", version: "1.0.0" });
const transport = endpoint ? new StreamableHTTPClientTransport(endpoint) : new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../dist/src/cli.js", import.meta.url))],
  env: { ...process.env, IRELAND_MCP_TOOLSETS: "" },
  stderr: "ignore"
});
let firstLobbyingId;
const checks = [
  ["geohive", "geohive_list_layers", { service: "Cadastral_Parcels_Freehold" }, (d) => d.layers.some((layer) => layer.id === 12)],
  ["geohive", "geohive_query_layer", { service: "Cadastral_Parcels_Freehold", out_fields: "SP_ID", limit: 1 }, (d) => d.layer_id === 12 && d.features.length === 1 && Number.isSafeInteger(d.features[0].SP_ID)],
  ["lobbying", "lobbying_search_returns", { limit: 1 }, (d) => {
    firstLobbyingId = d.returns[0]?.id;
    return d.returns.length === 1 && typeof d.date_from === "string" && typeof d.date_to === "string" && /^\d+$/.test(firstLobbyingId)
      && /^\d{4}-\d{2}-\d{2}$/.test(d.returns[0].submitted_date);
  }],
  ["lobbying", "lobbying_search_returns", { limit: 1, page: 2 }, (d) => d.returns.length === 1 && d.returns[0].id !== firstLobbyingId],
  ["paygap", "paygap_search_reports", { year: 2025, limit: 1 }, (d) => d.total_reports > 0 && d.reports.length === 1 && d.reports[0].report_year === 2025 && d.metric_unit === "percent"],
  ["council-budgets", "council_budgets_list_years", {}, (d) => d.years.some((year) => year.year === 2026 && year.supported) && d.years.some((year) => year.year === 2013 && !year.supported)],
  ["council-budgets", "council_budgets_get", { year: 2026, authority: "Carlow County Council", division: "A", limit: 1 }, (d) => d.amount_unit === "EUR" && d.rows.length === 1 && d.rows[0].amount === 4309186.99],
  ["council-budgets", "council_budgets_get", { year: 2016, authority: "Carlow County Council", division: "A", limit: 1 }, (d) => d.amount_unit === "EUR" && d.rows.length === 1 && d.rows[0].amount === 1753628.36]
];
const results = [];
try {
  await client.connect(transport);
  for (const [source, operation, args, accepts] of checks) {
    const started = Date.now();
    let failureReason = "transport_or_protocol_error";
    try {
      const result = await client.callTool({ name: "ireland_call", arguments: { source, operation, args, max_tokens: 4000 } }, undefined, { timeout: 60_000 });
      const body = JSON.parse(result.content.find((part) => part.type === "text")?.text ?? "");
      if (result.isError || body.error) {
        const code = body.error?.code;
        failureReason = typeof code === "string" && /^[A-Z_]{2,40}$/.test(code) ? code : "operation_error";
        assert.fail("Operation returned an error");
      }
      failureReason = "missing_source_evidence";
      for (const field of ["source", "url", "licence", "attribution", "retrieved_at"]) assert.ok(typeof body[field] === "string" && body[field].length > 0, `missing ${field}`);
      failureReason = "stale_source_result";
      assert.notEqual(body.stale, true, "stale result is not current-source proof");
      failureReason = "semantic_check_failed";
      assert.ok(accepts(body.data), "semantic check failed");
      results.push({ source, operation, ...(args.year ? { year: args.year } : {}), passed: true, cached: body.cached, ms: Date.now() - started });
    } catch {
      results.push({ source, operation, ...(args.year ? { year: args.year } : {}), passed: false, reason: failureReason, ms: Date.now() - started });
    }
  }
  const passed = results.every((result) => result.passed);
  console.log(JSON.stringify({ proof: endpoint ? "hosted-live-sources-over-http" : "local-build-live-sources-over-stdio",
    target: endpoint?.href ?? "local-stdio", checked_at: new Date().toISOString(), passed, results }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await client.close();
  await transport.close();
}
