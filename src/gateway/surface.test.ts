import { describe, expect, it } from "vitest";
import { z } from "zod";
import { connectClient } from "../../test/helpers/mcpClient.js";
import { fakeFetch } from "../../test/helpers/fakeFetch.js";
import { createAppServer, sourceModules } from "../registry.js";
import { DOMAINS, listOperations, exampleArgs } from "./catalogue.js";
import { createContext } from "./context.js";
import { applyBudget, envelope } from "./envelope.js";
import { handleMcpHttp } from "./httpHandler.js";
import { defineTool, type SourceModule } from "./module.js";
import { buildServer } from "./server.js";
import { resolveToolsets, toolsetsFromArgs, toolsetsFromUrl, UnknownToolsetError } from "./toolsets.js";

const META = ["ireland_catalogue", "ireland_describe", "ireland_call", "ireland_about", "search", "fetch", "nearby"];
const TOOLS_LIST_BUDGET_CHARS = 16_000;
const ctx = createContext({ fetch: fakeFetch([]) });

const text = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);

async function listTools(toolsets?: string) {
  const client = await connectClient(createAppServer(ctx, undefined, toolsets));
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const info = { id: "demo", name: "Demo Source", licence: "CC BY 4.0", attribution: "Demo", homepage: "https://example.ie" };
const rowsTool = defineTool({
  name: "demo_rows",
  title: "Rows",
  description: "Returns n padded rows.",
  inputSchema: { n: z.number().int().min(1).max(5000).describe("How many rows, e.g. 3.") },
  handler: async ({ n }) =>
    envelope(info, { data: { items: Array.from({ length: n }, (_, i) => ({ i, pad: "x".repeat(60) })) }, url: "https://example.ie" })
});
const demoModule: SourceModule = { info, summary: "Demo rows.", domain: "stats", tools: [rowsTool] };

describe("default lean surface", () => {
  it("lists only the meta tools and stays inside the tools/list budget", async () => {
    const tools = await listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...META].sort());
    const size = JSON.stringify({ tools }).length;
    process.stderr.write(`default tools/list: ${tools.length} tools, ${size} chars (≈${Math.round(size / 4)} tokens)\n`);
    expect(size).toBeLessThan(TOOLS_LIST_BUDGET_CHARS);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.description!.length).toBeGreaterThan(15);
    }
  });

  it("keeps nearby cheap enough to stay top level (<300 tokens)", async () => {
    const nearby = (await listTools()).find((t) => t.name === "nearby");
    expect(JSON.stringify(nearby).length / 4).toBeLessThan(300);
  });

  it("lists the domains statically in the catalogue description and sets short instructions", async () => {
    const client = await connectClient(createAppServer(ctx));
    const { tools } = await client.listTools();
    const catalogue = tools.find((t) => t.name === "ireland_catalogue")!;
    for (const d of DOMAINS) expect(catalogue.description).toContain(d);
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("ireland_catalogue");
    expect(instructions).toContain("ireland_call");
    expect(instructions.length / 4).toBeLessThanOrEqual(300);
    await client.close();
  });
});

describe("typed toolsets", () => {
  it("toolsets=all returns every typed tool plus the meta tools", async () => {
    const tools = await listTools("all");
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(41 + 4);
    for (const m of sourceModules) for (const t of m.tools) expect(names).toContain(t.name);
    for (const n of ["list_sources", "ireland_snapshot", ...META]) expect(names).toContain(n);
    const size = JSON.stringify({ tools }).length;
    process.stderr.write(`toolsets=all tools/list: ${tools.length} tools, ${size} chars (≈${Math.round(size / 4)} tokens)\n`);
  });

  it("toolsets=cso adds only the CSO tools to the meta tools", async () => {
    const names = (await listTools("cso")).map((t) => t.name).sort();
    const cso = sourceModules.find((m) => m.info.id === "cso")!.tools.map((t) => t.name);
    expect(names).toEqual([...META, ...cso].sort());
  });

  it("typed tools accept an optional max_tokens", async () => {
    const tools = await listTools("irish-rail");
    const rail = tools.find((t) => t.name === "rail_find_station")!;
    expect(Object.keys(rail.inputSchema.properties ?? {})).toContain("max_tokens");
  });

  it("parses toolsets from query, path, CLI flag and env, and rejects unknown ids", () => {
    const known = ["cso", "irish-rail", "cross"];
    expect(resolveToolsets(undefined, known)).toEqual([]);
    expect(resolveToolsets(" cso , irish-rail ", known)).toEqual(["cso", "irish-rail"]);
    expect(resolveToolsets("all", known)).toEqual(known);
    expect(() => resolveToolsets("cso,bogus", known)).toThrow(UnknownToolsetError);
    expect(() => resolveToolsets("bogus", known)).toThrow(/Valid toolsets: all, cso, irish-rail, cross/);
    expect(toolsetsFromUrl("https://h/mcp")).toBeUndefined();
    expect(toolsetsFromUrl("https://h/mcp?toolsets=cso,irish-rail")).toBe("cso,irish-rail");
    expect(toolsetsFromUrl("https://h/mcp/x/irish-rail")).toBe("irish-rail");
    expect(toolsetsFromUrl("https://h/mcp/x/%E0%A4%A")).toBe("%E0%A4%A");
    expect(toolsetsFromUrl("https://h/mcp/x/cso?toolsets=luas")).toBe("cso,luas");
    expect(toolsetsFromArgs(["--toolsets=cso"], {})).toBe("cso");
    expect(toolsetsFromArgs(["--toolsets", "luas"], {})).toBe("luas");
    expect(toolsetsFromArgs([], { IRELAND_MCP_TOOLSETS: "all" })).toBe("all");
    expect(toolsetsFromArgs([], {})).toBeUndefined();
  });

  it("serves toolsets over HTTP via ?toolsets= and /mcp/x/{source}, with a clear 400 for unknown ids", async () => {
    const createServer = (request?: Request) => createAppServer(ctx, undefined, toolsetsFromUrl(request?.url ?? ""));
    const post = (url: string) =>
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      });
    const names = async (url: string) =>
      ((await (await handleMcpHttp(post(url), { createServer })).json()).result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(await names("https://fn/mcp")).toHaveLength(META.length);
    expect(await names("https://fn/mcp/x/luas")).toContain("luas_get_forecast");
    expect(await names("https://fn/mcp?toolsets=cso,irish-rail")).toEqual(expect.arrayContaining(["cso_get_data", "rail_get_departures"]));
    const bad = await handleMcpHttp(post("https://fn/mcp/x/nope"), { createServer });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toMatch(/Unknown toolset "nope".*Valid toolsets: all, cso/);
  });
});

describe("meta tools", () => {
  it("catalogue groups every source by domain with its operations", async () => {
    const client = await connectClient(createAppServer(ctx));
    const all = text(await client.callTool({ name: "ireland_catalogue", arguments: {} }));
    const ids = all.domains.flatMap((d: { sources: Array<{ id: string }> }) => d.sources.map((s) => s.id));
    for (const m of sourceModules) expect(ids).toContain(m.info.id);
    const transport = text(await client.callTool({ name: "ireland_catalogue", arguments: { domain: "transport" } }));
    expect(transport.domains).toHaveLength(1);
    const rail = transport.domains[0].sources.find((s: { id: string }) => s.id === "irish-rail");
    expect(rail.operations).toEqual(["rail_find_station", "rail_get_departures"]);
    expect(typeof rail.summary).toBe("string");
    await client.close();
  });

  it("every registered source declares a domain", () => {
    for (const m of sourceModules) expect(DOMAINS).toContain(m.domain);
  });

  it("describe returns the JSON schema, description and a valid example for every operation", async () => {
    const ops = listOperations(sourceModules);
    expect(ops.length).toBeGreaterThanOrEqual(36);
    for (const op of ops) {
      const parsed = z.object(op.tool.inputSchema).safeParse(exampleArgs(op.tool));
      expect(parsed.success, `${op.tool.name} example: ${JSON.stringify(exampleArgs(op.tool))}`).toBe(true);
    }
    const client = await connectClient(createAppServer(ctx));
    const d = text(await client.callTool({ name: "ireland_describe", arguments: { source: "cso", operation: "cso_get_data" } }));
    expect(d.input_schema.type).toBe("object");
    expect(d.input_schema.properties.table_code).toBeDefined();
    expect(d.description).toBeTruthy();
    expect(d.example).toBeTypeOf("object");
    const missing = await client.callTool({ name: "ireland_describe", arguments: { source: "cso", operation: "nope" } });
    expect(missing.isError).toBe(true);
    expect(text(missing).error.hint).toContain("cso_get_data");
    await client.close();
  });

  it("call dispatches to the typed handler and self-corrects bad args with the schema and an example", async () => {
    const client = await connectClient(buildServer({ modules: [demoModule], context: ctx }));
    const ok = await client.callTool({ name: "ireland_call", arguments: { source: "demo", operation: "demo_rows", args: { n: 2 } } });
    expect(ok.isError).toBeFalsy();
    expect(text(ok).data.items).toHaveLength(2);
    expect((ok.structuredContent as { data: { items: unknown[] } }).data.items).toHaveLength(2);
    // The operation is named in the result so transcripts (and evals) can attribute the call.
    expect(text(ok).operation).toBe("demo_rows");
    expect(ok._meta).toMatchObject({ "ireland/source": "demo", "ireland/operation": "demo_rows" });

    const bad = await client.callTool({ name: "ireland_call", arguments: { source: "demo", operation: "demo_rows", args: { n: "two" } } });
    expect(bad.isError).toBe(true);
    const body = text(bad);
    expect(body.error.code).toBe("BAD_ARGS");
    expect(body.expected_schema.properties.n).toBeDefined();
    expect(body.example).toEqual({ n: 3 });

    const unknownSource = await client.callTool({ name: "ireland_call", arguments: { source: "zzz", operation: "x", args: {} } });
    expect(unknownSource.isError).toBe(true);
    expect(text(unknownSource).error.hint).toContain("demo");
    await client.close();
  });

  it("call truncates large results to the default budget and honours max_tokens", async () => {
    const client = await connectClient(buildServer({ modules: [demoModule], context: ctx }));
    const big = await client.callTool({ name: "ireland_call", arguments: { source: "demo", operation: "demo_rows", args: { n: 2000 } } });
    const body = text(big);
    const size = (big.content as Array<{ text: string }>)[0]!.text.length;
    expect(size / 4).toBeLessThanOrEqual(2000);
    expect(body).toMatchObject({ truncated: true, total: 2000 });
    expect(body.returned).toBe(body.data.items.length);
    expect(body.hint).toMatch(/max_tokens/);
    expect(body.source).toBe("Demo Source");
    const bigger = text(
      await client.callTool({ name: "ireland_call", arguments: { source: "demo", operation: "demo_rows", args: { n: 2000 }, max_tokens: 8000 } })
    );
    expect(bigger.returned).toBeGreaterThan(body.returned * 3);
    await client.close();
  });

  it("about reports licence, attribution, status URL and how to enable toolsets", async () => {
    const client = await connectClient(createAppServer(ctx));
    const about = text(await client.callTool({ name: "ireland_about", arguments: {} }));
    expect(about.licence).toContain("MIT");
    expect(about.status_url).toMatch(/^https:\/\/.*\/healthz$/);
    expect(JSON.stringify(about.toolsets)).toContain("?toolsets=");
    expect(about.sources.length).toBe(sourceModules.length + 1);
    await client.close();
  });
});

describe("applyBudget", () => {
  it("leaves small values alone and cuts the largest array with returned/total/hint", () => {
    const small = { data: [1, 2, 3], truncated: false };
    expect(applyBudget(small)).toBe(small);
    const big = { data: { rows: Array.from({ length: 1000 }, (_, i) => ({ i, s: "y".repeat(40) })) }, truncated: false };
    const out = applyBudget(big, 500) as { data: { rows: unknown[] }; truncated: boolean; returned: number; total: number };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(2000);
    expect(out).toMatchObject({ truncated: true, total: 1000 });
    expect(out.data.rows.length).toBe(out.returned);
    expect(big.data.rows).toHaveLength(1000);
  });

  it("clamps max_tokens to 8000 and trims long strings when there is no array", () => {
    const huge = { id: "a", text: "z".repeat(100_000) };
    const out = applyBudget(huge, 50_000, { annotate: false }) as { id: string; text: string };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(32_000);
    expect(Object.keys(out)).toEqual(["id", "text"]);
    expect(out.text).toMatch(/truncated/);
  });
});

describe("resources and prompts", () => {
  it("exposes per-source docs as ireland://sources/{id} and three prompts", async () => {
    const client = await connectClient(createAppServer(ctx));
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("ireland://sources/irish-rail");
    expect(resources).toHaveLength(sourceModules.length + 1);
    const doc = await client.readResource({ uri: "ireland://sources/cso" });
    const body = JSON.parse((doc.contents[0] as { text: string }).text);
    expect(body).toMatchObject({ id: "cso", licence: expect.any(String), attribution: expect.any(String), coverage: expect.any(String) });
    expect(body.operations.map((o: { name: string }) => o.name)).toContain("cso_get_data");

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["area_profile", "commute_check", "compare_counties"]);
    const p = await client.getPrompt({ name: "compare_counties", arguments: { metric: "population", counties: "Mayo, Donegal" } });
    expect(JSON.stringify(p.messages)).toContain("Mayo, Donegal");
    await client.close();
  });
});
