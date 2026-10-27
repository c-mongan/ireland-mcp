import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeFetch } from "../../test/helpers/fakeFetch.js";
import { connectClient } from "../../test/helpers/mcpClient.js";
import { createContext } from "./context.js";
import { envelope } from "./envelope.js";
import { ToolError } from "./errors.js";
import { parseExpr, evaluate } from "./expr.js";
import { defineTool, type SourceModule } from "./module.js";
import { QUERY_LIMITS, runQuery, runningQueries } from "./query.js";
import { buildServer } from "./server.js";
import { flattenRow, loadTable, MAX_TABLE_PAGES, parseTableId, tableId } from "./table.js";

const info = { id: "demo", name: "Demo", licence: "CC BY 4.0", attribution: "Demo data.", homepage: "https://example.ie" };
const ctx = createContext({ fetch: fakeFetch([]) });

type Item = Record<string, unknown>;
const people: Item[] = [
  { name: "Ann", county: "Galway", age: 30, score: 10, pop: 100 },
  { name: "Bob", county: "Galway", age: 40, score: 20, pop: 300 },
  { name: "Cáit", county: "Cork", age: 50, score: null, pop: 50 },
  { name: "Dan", county: "Cork", age: "60", score: 40, pop: 50 },
  { name: "Eve", county: "Mayo", age: 25, score: 5, pop: 10 }
];
const counties: Item[] = [
  { county: "galway", region: "West", seats: 9 },
  { county: "CORK", region: "South", seats: 18 },
  { county: "Kerry", region: "South", seats: 5 }
];

/** A paged in-memory table tool, like paygap or kohesio. */
function pagedTool(name: string, rows: () => Item[], extra: { pageSize?: number } = {}) {
  return defineTool({
    name,
    title: name,
    description: "Rows.",
    inputSchema: {
      n: z.number().int().min(0).max(100_000).optional(),
      kind: z.string().max(20).optional(),
      limit: z.number().int().min(1).max(500).default(20),
      offset: z.number().int().min(0).max(1_000_000).default(0)
    },
    table: { rows: "items", total: "total", ...(extra.pageSize ? { pageSize: extra.pageSize } : {}) },
    handler: async ({ n, limit, offset }) => {
      const all = n === undefined ? rows() : Array.from({ length: n }, (_, i) => ({ i, k: i % 7, g: "x" }));
      const items = all.slice(offset, offset + limit);
      return envelope(info, { data: { total: all.length, items }, url: `https://example.ie/${name}?o=${offset}`, cached: true, truncated: offset + items.length < all.length });
    }
  });
}

const peopleTool = pagedTool("demo_people", () => people);
const countiesTool = pagedTool("demo_counties", () => counties);
const bigTool = pagedTool("demo_big", () => []);
const tinyPages = pagedTool("demo_tiny", () => []);
tinyPages.table = { rows: "items", pageSize: 1 };
const noOffset = defineTool({
  name: "demo_nooffset",
  title: "No offset",
  description: "Truncated without paging.",
  inputSchema: { limit: z.number().int().min(1).max(500).default(20) },
  table: { rows: "items" },
  handler: async () => envelope(info, { data: { items: [{ a: 1 }] }, url: "https://example.ie/n", truncated: true })
});
const notTable = defineTool({ name: "demo_plain", title: "Plain", description: "Not a table.", inputSchema: {}, handler: async () => envelope(info, { data: { x: 1 }, url: "https://example.ie/p" }) });
const releases: Array<() => void> = [];
const slowTool = defineTool({
  name: "demo_slow",
  title: "Slow",
  description: "Waits.",
  inputSchema: { limit: z.number().int().min(1).max(500).default(20) },
  table: { rows: "items" },
  handler: async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return envelope(info, { data: { items: [{ a: 1 }] }, url: "https://example.ie/s" });
  }
});
const evilTool = defineTool({
  name: "demo_evil",
  title: "Evil",
  description: "Hostile keys.",
  inputSchema: { limit: z.number().int().min(1).max(500).default(20) },
  table: { rows: "items" },
  handler: async () =>
    envelope(info, { data: { items: [JSON.parse('{"__proto__": {"polluted": 1}, "constructor": "x", "ok": 1, "nested": {"__proto__": {"p": 2}, "v": 3}}')] }, url: "https://example.ie/e" })
});

const demo: SourceModule = { info, summary: "Demo.", domain: "stats", tools: [peopleTool, countiesTool, bigTool, tinyPages, noOffset, notTable, slowTool, evilTool] };
const modules = [demo];
const t = (alias: string, operation: string, args: Record<string, unknown> = {}, steps?: unknown[]) => ({ alias, source: "demo", operation, args, ...(steps ? { steps } : {}) });
const q = (input: Record<string, unknown>) => runQuery(modules, input, ctx) as Promise<{ data: { rows: Item[]; row_count: number; columns: string[]; warnings?: string[]; tables?: Item[] }; truncated: boolean; inputs: Item[]; query: Item; hint?: string }>;
const fails = async (input: Record<string, unknown>, message: RegExp) => {
  const error = await q(input).then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ToolError);
  expect((error as ToolError).message).toMatch(message);
  return error as ToolError;
};

describe("table handles", () => {
  it("are readable, canonical and round-trip, without paging arguments", () => {
    const id = tableId("planning", "planning_search", { to: "2024-12-31", council: "Galway City Council", limit: 5, offset: 10 });
    expect(id).toBe('planning/planning_search?{"council":"Galway City Council","to":"2024-12-31"}');
    expect(parseTableId(id)).toEqual({ source: "planning", operation: "planning_search", args: { council: "Galway City Council", to: "2024-12-31" } });
    expect(parseTableId("cso/cso_get_data")).toEqual({ source: "cso", operation: "cso_get_data", args: {} });
  });

  it("rejects malformed or oversized handles", () => {
    expect(() => parseTableId("https://evil.example/x?{}")).toThrow(/not a table_id/);
    expect(() => parseTableId("demo/demo_people?{not json")).toThrow(/not valid JSON/);
    expect(() => parseTableId("demo/demo_people?[1,2]")).toThrow(/JSON object/);
    expect(() => parseTableId(`demo/demo_people?${JSON.stringify({ kind: "x".repeat(5000) })}`)).toThrow(/longer than/);
  });

  it("re-validates a forged handle exactly like ireland_call: unknown args, bad values and non-table operations fail", async () => {
    await expect(loadTable(modules, parseTableId('demo/demo_people?{"url":"https://evil.example"}'), ctx)).rejects.toThrow(/Unknown argument/);
    await expect(loadTable(modules, parseTableId('demo/demo_people?{"kind":123}'), ctx)).rejects.toThrow(/Invalid arguments/);
    await expect(loadTable(modules, parseTableId("demo/demo_plain"), ctx)).rejects.toThrow(/does not return a table/);
    await expect(loadTable(modules, parseTableId("demo/nope"), ctx)).rejects.toThrow(/No operation/);
  });

  it("pages a handler to the end and keeps provenance", async () => {
    const table = await loadTable(modules, { source: "demo", operation: "demo_big", args: { n: 1234 } }, ctx);
    expect(table.rows).toHaveLength(1234);
    expect(table.provenance).toMatchObject({ source: "Demo", licence: "CC BY 4.0", attribution: "Demo data.", pages: 3, urls_read: 3, cached: true });
    expect(table.columns).toEqual([
      { name: "i", type: "number" },
      { name: "k", type: "number" },
      { name: "g", type: "string" }
    ]);
  });

  it("refuses tables over the row cap before paging, and never returns a partial table", async () => {
    await expect(loadTable(modules, { source: "demo", operation: "demo_big", args: { n: 10_001 } }, ctx)).rejects.toThrow(/10001 rows/);
    await expect(loadTable(modules, { source: "demo", operation: "demo_big", args: { n: 100 } }, ctx, 50)).rejects.toThrow(/limit 50 rows/);
    await expect(loadTable(modules, { source: "demo", operation: "demo_nooffset", args: {} }, ctx)).rejects.toThrow(/cannot page/);
    await expect(loadTable(modules, { source: "demo", operation: "demo_tiny", args: { n: MAX_TABLE_PAGES + 1 } }, ctx)).rejects.toThrow(/upstream pages/);
  });

  it("flattens nested rows and drops prototype keys", () => {
    const { row } = flattenRow(JSON.parse('{"a":1,"b":{"c":"x","d":{"e":2,"f":{"g":3}}},"list":[1,"two"],"objs":[{"x":1}],"__proto__":{"p":1},"long":"' + "y".repeat(3000) + '"}'));
    expect(Object.getPrototypeOf(row)).toBeNull();
    expect(row).toMatchObject({ a: 1, "b.c": "x", "b.d.e": 2, list: "1; two" });
    expect(Object.keys(row)).not.toContain("b.d.f.g");
    expect(Object.keys(row)).not.toContain("objs");
    expect(Object.keys(row)).not.toContain("__proto__");
    expect((row.long as string).length).toBe(2000);
    const wide = flattenRow(Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`c${i}`, i])));
    expect(Object.keys(wide.row)).toHaveLength(64);
    expect(wide.dropped).toBe(16);
  });
});

describe("ireland_query pipeline", () => {
  it("describes tables when there are no steps", async () => {
    const r = await q({ tables: [t("p", "demo_people")] });
    expect(r.data.tables![0]).toMatchObject({ alias: "p", row_count: 5, columns: { name: "string", age: "mixed" } });
    expect((r.data.tables![0]!.preview as unknown[]).length).toBe(5);
  });

  it("filters with typed comparisons, lists, text and boolean logic", async () => {
    const names = async (filter: unknown) => (await q({ tables: [t("p", "demo_people")], steps: [{ filter }] })).data.rows.map((r) => r.name);
    expect(await names(["age", ">", 35])).toEqual(["Bob", "Cáit", "Dan"]);
    expect(await names(["age", "=", "60"])).toEqual(["Dan"]);
    expect(await names({ col: "county", op: "in", value: ["Cork", "Mayo"] })).toEqual(["Cáit", "Dan", "Eve"]);
    expect(await names(["name", "contains", "A"])).toEqual(["Ann", "Dan"]);
    expect(await names(["score", "is_null"])).toEqual(["Cáit"]);
    expect(await names({ or: [["county", "=", "Mayo"], { and: [["county", "=", "Galway"], { not: ["age", "<", 35] }] }] })).toEqual(["Bob", "Eve"]);
  });

  it("joins inner and left, normalising keys and prefixing clashing columns", async () => {
    const inner = await q({ tables: [t("p", "demo_people"), t("c", "demo_counties")], steps: [{ join: "c", on: "county", normalize: true }, { select: ["name", "region"] }] });
    expect(inner.data.rows).toEqual([
      { name: "Ann", region: "West" },
      { name: "Bob", region: "West" },
      { name: "Cáit", region: "South" },
      { name: "Dan", region: "South" }
    ]);
    const left = await q({ tables: [t("p", "demo_people"), t("c", "demo_counties")], steps: [{ join: "c", on: ["county", "county"], type: "left", where: ["seats", ">", 10] }] });
    expect(left.data.rows.map((r) => r.region)).toEqual([null, null, null, null, null]);
    const clash = await q({ tables: [t("p", "demo_people"), t("c", "demo_counties")], steps: [{ derive: { region: "'x'" } }, { join: "c", on: "county", normalize: true }] });
    expect(clash.data.columns).toContain("c.region");
  });

  it("rejects a join that would explode before building it", async () => {
    const e = await fails({ tables: [t("a", "demo_big", { n: 300 }), t("b", "demo_big", { n: 300, kind: "b" })], steps: [{ join: "b", on: "g" }] }, /90000 rows/);
    expect(e.hint).toMatch(/specific key/);
  });

  it("aggregates with and without groups, skipping and reporting empty cells", async () => {
    const r = await q({
      tables: [t("p", "demo_people")],
      steps: [{ aggregate: { n: "count", total: "sum:score", avg: "avg:age", med: "median:age", w: "weighted_avg:score:pop", d: "count_distinct:county", lo: "min:name" } }]
    });
    expect(r.data.rows).toEqual([{ n: 5, total: 75, avg: 41, med: 40, w: 19.6739130435, d: 3, lo: "Ann" }]);
    expect(r.data.warnings).toEqual(["total: skipped 1 empty or non-numeric cell."]);
    const g = await q({ tables: [t("p", "demo_people")], steps: [{ aggregate: { n: "count", pop: "sum:pop" }, group_by: "county" }, { sort: ["-pop", "county"] }] });
    expect(g.data.rows).toEqual([
      { county: "Galway", n: 2, pop: 400 },
      { county: "Cork", n: 2, pop: 100 },
      { county: "Mayo", n: 1, pop: 10 }
    ]);
    const empty = await q({ tables: [t("p", "demo_people")], steps: [{ filter: ["age", ">", 1000] }, { aggregate: { n: "count", s: "sum:age" } }] });
    expect(empty.data.rows).toEqual([{ n: 0, s: null }]);
  });

  it("derives, ranks with ties, computes shares, sorts nulls last and selects", async () => {
    const r = await q({
      tables: [t("p", "demo_people")],
      steps: [
        { derive: { per: "round(score / pop * 1000, 1)", label: "concat(upper(substr(name, 0, 1)), '-', norm(county))", zero: "score / 0" } },
        { rank: { by: "per" } },
        { pct_of_total: { col: "pop", name: "pop_pct", partition_by: ["county"] } },
        { sort: "-per" },
        { select: { who: "name", per: "per", rank: "rank", label: "label", zero: "zero", pop_pct: "pop_pct" } }
      ]
    });
    expect(r.data.rows.map((x) => [x.who, x.per, x.rank])).toEqual([
      ["Dan", 800, 1],
      ["Eve", 500, 2],
      ["Ann", 100, 3],
      ["Bob", 66.7, 4],
      ["Cáit", null, null]
    ]);
    expect(r.data.rows[4]).toMatchObject({ label: "C-cork", zero: null, pop_pct: 50 });
    const ties = await q({ tables: [t("p", "demo_people")], steps: [{ rank: { by: "county", desc: false } }, { select: ["name", "rank"] }] });
    expect(ties.data.rows.map((x) => x.rank)).toEqual([3, 3, 1, 1, 5]);
  });

  it("supports per-table steps, union, distinct and limit, and loads a self-join once", async () => {
    const r = await q({
      tables: [t("a", "demo_people", {}, [{ filter: ["county", "=", "Cork"] }]), t("b", "demo_people", {}, [{ filter: ["county", "=", "Mayo"] }])],
      steps: [{ union: "b" }, { distinct: ["county"] }, { limit: 1 }]
    });
    expect(r.data.rows).toEqual([{ county: "Cork" }]);
    expect(r.inputs).toHaveLength(2);
    await fails({ tables: [t("a", "demo_people", {}, [{ join: "a", on: "name" }])], steps: [{ limit: 1 }] }, /only allowed in the main steps/);
  });

  it("echoes the query with resolved table_ids and per-input provenance", async () => {
    const r = await q({ tables: [t("p", "demo_people", { kind: "x", limit: 3 })], steps: [{ limit: 2 }], limit: 1 });
    expect(r.query).toEqual({ tables: [{ alias: "p", table_id: 'demo/demo_people?{"kind":"x"}' }], steps: [{ limit: 2 }], limit: 1 });
    expect(r.inputs[0]).toMatchObject({ alias: "p", rows: 5, source: "Demo", licence: "CC BY 4.0", attribution: "Demo data.", url: "https://example.ie/demo_people?o=0" });
    expect(r.data).toMatchObject({ row_count: 2, returned: 1 });
    expect(r.truncated).toBe(true);
  });

  it("accepts a table_id and refuses mixing it with source/operation", async () => {
    const r = await q({ tables: [{ alias: "p", table_id: "demo/demo_people" }], steps: [{ aggregate: { n: "count" } }] });
    expect(r.data.rows).toEqual([{ n: 5 }]);
    await fails({ tables: [{ alias: "p", table_id: "demo/demo_people", source: "demo" }] }, /not both/);
  });

  it("gives clear errors for unknown columns, steps and functions", async () => {
    const e = await fails({ tables: [t("p", "demo_people")], steps: [{ filter: ["cuonty", "=", "x"] }] }, /Step 1: Unknown column "cuonty"/);
    expect(e.hint).toMatch(/county/);
    expect((await q({ tables: [t("p", "demo_people")], steps: [{ filter: ["COUNTY", "=", "Mayo"] }] })).data.rows).toHaveLength(1);
    await fails({ tables: [t("p", "demo_people")], steps: [{ explode: 1 }] }, /exactly one of/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ filter: ["age", "~", 1] }] }, /Unknown filter op/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ derive: { x: "eval('1')" } }] }, /Unknown function/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ aggregate: { n: "explode:age" } }] }, /unknown function/);
  });
});

describe("ireland_query limits", () => {
  it("caps tables, steps and output rows through the schema", async () => {
    await fails({ tables: Array.from({ length: QUERY_LIMITS.maxTables + 1 }, (_, i) => t(`t${i}`, "demo_people")) }, /Invalid arguments/);
    await fails({ tables: [t("p", "demo_people")], steps: Array.from({ length: QUERY_LIMITS.maxSteps + 1 }, () => ({ limit: 1 })) }, /Invalid arguments/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ limit: 1 }], limit: QUERY_LIMITS.maxOutputRows + 1 }, /Invalid arguments/);
    await fails(
      { tables: [t("p", "demo_people", {}, Array.from({ length: 15 }, () => ({ limit: 9 })))], steps: Array.from({ length: 16 }, () => ({ limit: 9 })) },
      /31 steps/
    );
  });

  it("caps rows across all input tables", async () => {
    await fails({ tables: [t("a", "demo_big", { n: 10_000 }), t("b", "demo_big", { n: 10_000, kind: "b" }), t("c", "demo_big", { n: 1, kind: "c" })] }, /20001 rows/);
  });

  it("caps columns in the pipeline", async () => {
    const derive = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`d${i}`, "1"]));
    await fails({ tables: [t("p", "demo_people")], steps: Array.from({ length: 7 }, (_, s) => ({ derive: Object.fromEntries(Object.entries(derive).map(([k, v]) => [`${k}_${s}`, v])) })) }, /65 columns/);
  });

  it("caps conditions: nodes, depth and in-list size", async () => {
    const wide = { or: Array.from({ length: QUERY_LIMITS.maxConditionNodes + 1 }, () => ["age", ">", 1]) };
    await fails({ tables: [t("p", "demo_people")], steps: [{ filter: wide }] }, /more than 100 parts/);
    let deep: unknown = ["age", ">", 1];
    for (let i = 0; i < 12; i += 1) deep = { not: deep };
    await fails({ tables: [t("p", "demo_people")], steps: [{ filter: deep }] }, /nested more than/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ filter: ["age", "in", Array.from({ length: 501 }, (_, i) => i)] }] }, /up to 500 values/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ filter: ["name", "contains", "x".repeat(201)] }] }, /1–200 characters/);
  });

  it("charges a deterministic work budget", async () => {
    const heavy = "(" + Array.from({ length: 60 }, () => "k").join(" + ") + ")";
    const steps = Array.from({ length: 6 }, (_, i) => ({ derive: { [`h${i}`]: heavy } }));
    await fails({ tables: [t("a", "demo_big", { n: 10_000 })], steps }, /work units/);
  });

  it("stops computation at the wall-clock backstop", async () => {
    let now = 0;
    const clock = () => (now += 5000);
    const error = await runQuery(modules, { tables: [t("a", "demo_big", { n: 10_000 })], steps: [{ derive: { x: "k * 2" } }] }, ctx, { clock }).catch((e: unknown) => e);
    expect((error as ToolError).message).toMatch(/longer than 3000 ms/);
  });

  it("times out slow loads and limits concurrent queries", async () => {
    const slow = { tables: [{ alias: "s", source: "demo", operation: "demo_slow", args: {} }] };
    const pending = Array.from({ length: QUERY_LIMITS.maxConcurrent }, () => runQuery(modules, slow, ctx, { loadMs: 50 }).catch((e: unknown) => e));
    expect(runningQueries()).toBe(QUERY_LIMITS.maxConcurrent);
    const blocked = await runQuery(modules, slow, ctx).catch((e: unknown) => e);
    expect((blocked as ToolError).code).toBe("RATE_LIMITED");
    const results = await Promise.all(pending);
    for (const r of results) expect((r as ToolError).message).toMatch(/took longer than/);
    // Timed-out loads hold their slots until the upstream work settles.
    expect(runningQueries()).toBe(QUERY_LIMITS.maxConcurrent);
    for (const r of releases.splice(0)) r();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runningQueries()).toBe(0);
  });

  it("caps select and distinct lists and charges them to the budget", async () => {
    await fails({ tables: [t("p", "demo_people")], steps: [{ select: Array.from({ length: 65 }, () => "name") }] }, /1–64 columns/);
    await fails({ tables: [t("p", "demo_people")], steps: [{ distinct: Array.from({ length: 65 }, () => "name") }] }, /1–64 columns/);
    const r = await q({ tables: [t("p", "demo_people")], steps: [{ select: ["name", "name", "NAME"] }] });
    expect(r.data.columns).toEqual(["name"]);
  });

  it("validates every table before loading any, so a bad table starts no upstream work", async () => {
    const before = releases.length;
    await fails({ tables: [{ alias: "bad", source: "demo", operation: "nope" }, { alias: "s", source: "demo", operation: "demo_slow" }] }, /No operation/);
    expect(releases.length).toBe(before);
    expect(runningQueries()).toBe(0);
  });

  it("holds the slot until every load settles when one table fails mid-load", async () => {
    const pending = runQuery(modules, { tables: [{ alias: "n", source: "demo", operation: "demo_nooffset" }, { alias: "s", source: "demo", operation: "demo_slow" }] }, ctx).catch((e: unknown) => e);
    expect(((await pending) as ToolError).message).toMatch(/cannot page/);
    expect(runningQueries()).toBe(1);
    for (const r of releases.splice(0)) r();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runningQueries()).toBe(0);
  });

  it("fits the result budget with whole rows and says so", async () => {
    const r = await runQuery(modules, { tables: [t("a", "demo_big", { n: 500 })], steps: [{ derive: { pad: "concat('x', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')" } }], limit: 500, max_tokens: 1000 }, ctx);
    const data = r.data as { rows: Item[]; returned: number; row_count: number };
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(4000);
    expect(data.returned).toBe(data.rows.length);
    expect(data.row_count).toBe(500);
    expect(r.truncated).toBe(true);
    expect(r.hint).toMatch(/Only \d+ of 500 rows/);
    expect(data.rows.every((x) => x.pad === "x" + "x".repeat(48))).toBe(true);
  });

  it("is not polluted by hostile keys in rows or step names", async () => {
    const r = await q({ tables: [t("e", "demo_evil")], steps: [{ derive: { y: "ok + 1" } }] });
    expect(r.data.rows).toEqual([{ ok: 1, "nested.v": 3, y: 2 }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    await fails({ tables: [t("e", "demo_evil")], steps: [{ derive: JSON.parse('{"__proto__": "1"}') }] }, /derive takes|Invalid column/);
    await fails({ tables: [t("e", "demo_evil")], steps: [{ aggregate: JSON.parse('{"constructor": "count"}') }] }, /Invalid aggregate name/);
    await fails({ tables: [t("e", "demo_evil")], steps: [{ select: { prototype: "ok" } }] }, /Invalid column name/);
  });
});

describe("expressions", () => {
  const cols = (name: string) => name;
  const run = (src: string, row: Record<string, unknown> = {}) => evaluate(parseExpr(src, cols), row as never);
  it("evaluates arithmetic, comparisons and functions without eval", () => {
    expect(run("1 + 2 * 3 - -4 / 2")).toBe(9);
    expect(run("(a - b) / b * 100", { a: 120, b: 100 })).toBe(20);
    expect(run("[Col Name] * 2", { "Col Name": 4 })).toBe(8);
    expect(run("if(a >= 2, 'big', 'small')", { a: 3 })).toBe("big");
    expect(run("pct_change(100, 150)")).toBe(50);
    expect(run("year('2024-03-05') + month('2024-03-05')")).toBe(2027);
    expect(run("split_part('Tuam, Galway County', ',', 2)")).toBe(" Galway County");
    expect(run("replace('Galway County Council', ' Council', '')")).toBe("Galway County");
    expect(run("coalesce(null, x, 3)", { x: null })).toBe(3);
    expect(run("1 / 0")).toBeNull();
    expect([run("round(-2.5)"), run("round(2.5)"), run("round(-3.85, 1)"), run("round(1.005, 2)")]).toEqual([-3, 3, -3.9, 1.01]);
    expect(run("norm('Co. Dún Laoghaire–Rathdown')")).toBe("dun laoghaire rathdown");
  });

  it("bounds expression size, nesting and string growth", () => {
    expect(() => parseExpr("1+".repeat(300) + "1", cols)).toThrow(/longer than|too many|too complex/);
    expect(() => parseExpr("(".repeat(40) + "1" + ")".repeat(40), cols)).toThrow(/nested too deeply/);
    expect(() => parseExpr("a +", cols)).toThrow(/ended early/);
    expect(() => parseExpr("a ; b", cols)).toThrow(/Unexpected character/);
    expect(() => parseExpr("constructor()", cols)).toThrow(/Unknown function/);
    expect(String(run("concat(a, a, a, a, a, a)", { a: "z".repeat(900) })).length).toBe(1000);
    expect(run("replace(a, 'z', b)", { a: "z".repeat(2000), b: "y".repeat(200) })).toBeNull();
  });
});

describe("server wiring", () => {
  it("adds table_id to table-capable ireland_call results, marks them in describe, and runs ireland_query over MCP", async () => {
    const server = buildServer({ modules, context: ctx });
    const client = await connectClient(server);
    const text = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0]!.text);
    const call = text(await client.callTool({ name: "ireland_call", arguments: { source: "demo", operation: "demo_people", args: { kind: "x", limit: 2 } } }));
    expect(call.table_id).toBe('demo/demo_people?{"kind":"x"}');
    const plain = text(await client.callTool({ name: "ireland_call", arguments: { source: "demo", operation: "demo_plain", args: {} } }));
    expect(plain.table_id).toBeUndefined();
    const described = text(await client.callTool({ name: "ireland_describe", arguments: { source: "demo" } }));
    expect(described.operations.find((o: { name: string }) => o.name === "demo_people").table_handle).toBe(true);
    const result = await client.callTool({ name: "ireland_query", arguments: { tables: [{ alias: "p", table_id: call.table_id }], steps: [{ aggregate: { n: "count" } }] } });
    expect(text(result).data.rows).toEqual([{ n: 5 }]);
    const error = await client.callTool({ name: "ireland_query", arguments: { tables: [{ alias: "p", table_id: "demo/demo_plain" }] } });
    expect(error.isError).toBe(true);
    expect(text(error).error.code).toBe("BAD_ARGS");
    await client.close();
  });
});
