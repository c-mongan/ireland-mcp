// Shared plumbing for the multi-step benchmark: an MCP connection, a recording `call` helper that
// goes through ireland_call exactly as an agent would, and the capability-gap vocabulary.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { setTimeout as sleep } from "node:timers/promises";

// First-party checks are tagged so hosted usage metrics count only real clients (same header as live-all-ops).
const SYNTHETIC = { requestInit: { headers: { "x-ireland-mcp-synthetic": "1" } } };

/**
 * Capability-gap tags. Each maps to the north-star pillar that would unlock it.
 * "Blocking" gaps make an item unanswerable today; "workaround" gaps mean the reference only works
 * through client-side hacks (hand-written name maps, many pages, hard-coded table codes).
 */
export const GAP_PILLARS = {
  "dataset-card": "Pillar 1: dataset cards in ireland_catalogue / ireland_describe",
  "crosswalk": "Pillar 2: place crosswalk (ireland_resolve_place / ireland_crosswalk)",
  "server-query": "Pillar 3: table handles + ireland_query (server-side join/aggregate)",
  "knowledge": "Pillar 4: knowledge indexes (Citizens Information, law full text)",
  "source": "New source: data not in the catalogue at all"
};

export function pillarOf(tag) {
  return tag.split(":")[0];
}

/** A missing capability: the reference cannot be computed with today's catalogue. */
export class GapError extends Error {
  constructor(tag, evidence) {
    super(`capability gap ${tag}: ${evidence}`);
    this.name = "GapError";
    this.tag = tag;
    this.evidence = evidence;
  }
}

/** An upstream failure (HTTP 403/5xx, timeout): not a benchmark signal, retry another day. */
export class UpstreamError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "UpstreamError";
    this.code = code;
  }
}

export async function connect({ url, cwd = process.cwd() } = {}) {
  const client = new Client({ name: "ireland-mcp-multistep", version: "1.0.0" });
  const transport = url
    ? new StreamableHTTPClientTransport(new URL(url), SYNTHETIC)
    : new StdioClientTransport({ command: process.execPath, args: ["dist/src/cli.js"], cwd, stderr: "ignore" });
  await client.connect(transport);
  return client;
}

function envelopeOf(result) {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
  const text = (result.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

const UPSTREAM_CODES = new Set(["UPSTREAM_DOWN", "UPSTREAM_ERROR", "TIMEOUT", "RATE_LIMITED", "UPSTREAM_TIMEOUT", "NOT_CONFIGURED"]);

/**
 * Builds the per-item reference context. Every call is recorded (source, operation, args, url,
 * retrieved_at) so references are pinned with the exact tool calls used.
 */
export function makeContext(client, { delayMs = 0, catalogue } = {}) {
  const calls = [];
  const workarounds = new Set();
  async function call(source, operation, args = {}, { allowTruncated = false } = {}) {
    if (delayMs) await sleep(delayMs);
    let result;
    for (let attempt = 0; ; attempt++) {
      result = await client.callTool({ name: "ireland_call", arguments: { source, operation, args, max_tokens: 8000 } });
      const env = envelopeOf(result);
      const code = env?.error?.code;
      // One patient retry for flaky upstreams (ECB timeouts), more for rate limits.
      if (result.isError && ((code === "RATE_LIMITED" && attempt < 3) || (code === "UPSTREAM_DOWN" && attempt < 1))) {
        await sleep(3000 * 2 ** attempt);
        continue;
      }
      const record = { source, operation, args, url: env?.url ?? null, retrieved_at: env?.retrieved_at ?? null, truncated: Boolean(env?.truncated) };
      calls.push(record);
      if (result.isError) {
        const message = `${source}/${operation}: ${code ?? "ERROR"} ${env?.error?.message ?? JSON.stringify(env).slice(0, 200)}`;
        if (UPSTREAM_CODES.has(code)) throw new UpstreamError(message, code);
        throw new Error(message);
      }
      // Silently computing over partial data is the biggest correctness trap, so truncation is fatal
      // unless the reference only needs the first rows (and says so).
      if (env?.truncated && !allowTruncated) throw new Error(`${source}/${operation} returned truncated:true; narrow the reference query`);
      return env.data;
    }
  }
  return {
    call,
    calls,
    workarounds,
    /** Marks that the reference needed a client-side workaround that a pillar would remove. */
    workaround(tag) {
      workarounds.add(tag);
    },
    /** True when an operation (by name) or argument exists in today's catalogue. */
    hasOperation(name) {
      return catalogue?.operations.has(name) ?? false;
    },
    catalogue
  };
}

/** Lists operations and the meta-tool argument names so gap probes can see what exists today. */
export async function loadCatalogue(client) {
  const { tools } = await client.listTools();
  const operations = new Set(tools.map((t) => t.name));
  const toolArgs = Object.fromEntries(tools.map((t) => [t.name, Object.keys(t.inputSchema?.properties ?? {})]));
  const res = await client.callTool({ name: "ireland_catalogue", arguments: {} });
  const cat = envelopeOf(res);
  const sources = new Set();
  for (const d of cat.domains ?? []) {
    for (const s of d.sources ?? []) {
      sources.add(s.id);
      for (const op of s.operations ?? []) operations.add(op);
    }
  }
  return { operations, sources, toolArgs };
}

/**
 * Probes for each pillar. When a probe turns true, items blocked by that pillar flip to
 * "capability now present: write a reference" instead of staying a silent, self-fulfilling gap.
 */
export function pillarProbes(catalogue) {
  const ops = [...catalogue.operations];
  return {
    crosswalk: ops.some((o) => /resolve_place|crosswalk/.test(o)),
    "dataset-card": (catalogue.toolArgs.ireland_catalogue ?? []).some((a) => /geo_level|topic|dimension/.test(a)),
    "server-query": ops.some((o) => /^ireland_query$|_query_tables?$/.test(o)),
    // Statistics about Citizens Information (cib_*) are data, not a searchable guidance or law index.
    knowledge: ops.some((o) => /citizens_info_search|legal_search|law_search|^legislation_search/.test(o))
  };
}

export const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
