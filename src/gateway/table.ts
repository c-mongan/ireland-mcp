/**
 * Table handles. A handle is a readable, reproducible descriptor of the source call that produced a
 * table: `source/operation?{canonical JSON args}`. Nothing is stored: ireland_query re-runs the call
 * (upstream reads are already cached) and pages it in full. A handle grants nothing beyond what
 * ireland_call with the same arguments already allows, and its arguments are re-validated every time.
 */
import { z } from "zod";
import type { Envelope } from "./envelope.js";
import { MAX_LIMIT } from "./envelope.js";
import { ToolError } from "./errors.js";
import type { AnyTool, SourceModule, TableLoad, ToolContext } from "./module.js";

/** Rows one table may hold once loaded. CSO's 10,000-cell cap fits exactly. */
export const MAX_TABLE_ROWS = 10_000;
/** Handler calls (upstream pages) one table may take to load. */
export const MAX_TABLE_PAGES = 25;
/** Columns kept per row after flattening. */
export const MAX_COLUMNS = 64;
/** Longest string kept in a cell. */
export const MAX_CELL_CHARS = 2_000;
/** Longest accepted table_id. */
export const MAX_TABLE_ID_CHARS = 4_000;

/** Arguments the loader controls; they are not part of a table's identity. */
const PAGING_ARGS = new Set(["limit", "offset", "page", "max_tokens"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type ColumnType = "number" | "string" | "boolean" | "null" | "mixed";

export interface TableRef {
  source: string;
  operation: string;
  args: Record<string, unknown>;
}

export interface LoadedTable {
  table_id: string;
  source: string;
  operation: string;
  args: Record<string, unknown>;
  rows: Row[];
  columns: Array<{ name: string; type: ColumnType }>;
  provenance: {
    source: string;
    url: string;
    urls_read: number;
    licence: string;
    attribution: string;
    retrieved_at: string;
    cached: boolean;
    stale: boolean;
    pages: number;
  };
  /** Columns dropped because the row had more than MAX_COLUMNS. */
  dropped_columns?: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with sorted keys, so equal arguments always give the same handle. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function identityArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (!PAGING_ARGS.has(k) && !FORBIDDEN_KEYS.has(k) && v !== undefined) out[k] = v;
  return out;
}

export function tableId(source: string, operation: string, args: Record<string, unknown>): string {
  return `${source}/${operation}?${canonicalJson(identityArgs(args))}`;
}

/** Parses a table_id back into its source call. Syntax only; resolveTool validates the call. */
export function parseTableId(id: string): TableRef {
  if (id.length > MAX_TABLE_ID_CHARS) throw new ToolError("BAD_ARGS", `table_id is longer than ${MAX_TABLE_ID_CHARS} characters.`);
  const q = id.indexOf("?");
  const head = q < 0 ? id : id.slice(0, q);
  const match = /^([a-z0-9-]{1,40})\/([a-z0-9_]{1,60})$/.exec(head);
  if (!match) {
    throw new ToolError("BAD_ARGS", `"${head.slice(0, 80)}" is not a table_id.`, {
      hint: 'A table_id looks like \'planning/planning_search?{"council":"Galway City Council"}\'. Or pass {source, operation, args} instead.'
    });
  }
  let args: unknown = {};
  if (q >= 0 && id.length > q + 1) {
    try {
      args = JSON.parse(id.slice(q + 1));
    } catch {
      throw new ToolError("BAD_ARGS", "The arguments part of the table_id is not valid JSON.");
    }
  }
  if (!isPlainObject(args)) throw new ToolError("BAD_ARGS", "The arguments part of the table_id must be a JSON object.");
  return { source: match[1]!, operation: match[2]!, args };
}

/** Finds a table-capable operation and validates its arguments exactly as ireland_call would. */
export function resolveTool(modules: SourceModule[], ref: TableRef): { tool: AnyTool; module: SourceModule; args: Record<string, unknown> } {
  const module = modules.find((m) => m.info.id === ref.source);
  const tool = module?.tools.find((t) => t.name === ref.operation);
  if (!module || !tool) {
    throw new ToolError("NOT_FOUND", `No operation ${ref.source}/${ref.operation}.`, { hint: `Table-capable operations: ${tableOperations(modules).join(", ")}.` });
  }
  if (!tool.table) {
    throw new ToolError("BAD_ARGS", `${ref.source}/${ref.operation} does not return a table ireland_query can load.`, {
      hint: `Table-capable operations: ${tableOperations(modules).join(", ")}.`
    });
  }
  const args = identityArgs(ref.args);
  const valid = Object.keys(tool.inputSchema);
  const unknown = Object.keys(ref.args).filter((k) => !PAGING_ARGS.has(k) && !valid.includes(k));
  if (unknown.length) {
    throw new ToolError("BAD_ARGS", `Unknown argument${unknown.length > 1 ? "s" : ""} for ${tool.name}: ${unknown.slice(0, 5).join(", ")}. Valid arguments: ${valid.join(", ")}.`);
  }
  const parsed = z.object(tool.inputSchema).safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ToolError("BAD_ARGS", `Invalid arguments for ${tool.name}: ${detail}`.slice(0, 400), { hint: `ireland_describe("${module.info.id}", "${tool.name}") shows the schema.` });
  }
  return { tool, module, args };
}

export function tableOperations(modules: SourceModule[]): string[] {
  return modules.flatMap((m) => m.tools.filter((t) => t.table).map((t) => `${m.info.id}/${t.name}`));
}

export function getPath(value: unknown, path: string): unknown {
  let node = value;
  for (const part of path.split(".")) {
    if (!isPlainObject(node) || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

/** Pages a handler until its envelope is no longer truncated. */
async function pageHandler(tool: AnyTool, args: Record<string, unknown>, ctx: ToolContext, maxRows: number): Promise<TableLoad> {
  const spec = tool.table!;
  const pageSize = Math.min(spec.pageSize ?? MAX_LIMIT, MAX_LIMIT);
  const hasOffset = "offset" in tool.inputSchema;
  const hasLimit = "limit" in tool.inputSchema;
  const schema = z.object(tool.inputSchema);
  const rows: unknown[] = [];
  const urls: string[] = [];
  let first: Envelope | undefined;
  let cached = true;
  let stale = false;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_TABLE_PAGES) throw tooLarge(tool, `it needs more than ${MAX_TABLE_PAGES} upstream pages`);
    const callArgs = schema.parse({ ...args, ...(hasLimit ? { limit: pageSize } : {}), ...(hasOffset ? { offset: rows.length } : {}) });
    const env = (await tool.handler(callArgs, ctx)) as Envelope;
    if (!isPlainObject(env) || !("data" in env)) throw new ToolError("UPSTREAM_DOWN", `${tool.name} returned no envelope.`);
    first ??= env;
    if (!urls.includes(env.url)) urls.push(env.url);
    cached &&= env.cached;
    stale ||= Boolean(env.stale);
    if (page === 0 && spec.total) {
      const total = getPath(env.data, spec.total);
      if (typeof total === "number" && total > maxRows) throw tooLarge(tool, `it has ${total} rows`, maxRows);
    }
    const pageRows = getPath(env.data, spec.rows);
    if (!Array.isArray(pageRows)) {
      throw new ToolError("BAD_ARGS", `This ${tool.name} call returns no table.`, { hint: tool.name === "ireland_resolve_place" ? "Add list (e.g. list: 'ed') to get a table of areas." : "Check the arguments with ireland_describe." });
    }
    rows.push(...pageRows);
    if (rows.length > maxRows) throw tooLarge(tool, `it has more than ${maxRows} rows`, maxRows);
    if (!env.truncated) break;
    if (!hasOffset || pageRows.length === 0) throw tooLarge(tool, "the source cannot page past its first result page");
  }
  return { rows, envelope: { ...first!, cached, ...(stale ? { stale: true } : {}) }, urls, pages: urls.length || 1 };
}

function tooLarge(tool: AnyTool, why: string, maxRows = MAX_TABLE_ROWS): ToolError {
  return new ToolError("BAD_ARGS", `Cannot load ${tool.name} as a table: ${why} (limit ${maxRows} rows).`, {
    hint: "Narrow the source arguments (council, dates, filters, codes) so the table is smaller. ireland_query never computes over a partial table."
  });
}

function cell(value: unknown): Cell | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value;
  return undefined;
}

/** Flattens one row: nested objects become dotted columns (two levels), scalar arrays are joined with "; ". */
export function flattenRow(value: unknown, maxColumns = MAX_COLUMNS): { row: Row; dropped: number } {
  const row = Object.create(null) as Row;
  let count = 0;
  let dropped = 0;
  const put = (key: string, v: Cell) => {
    if (count >= maxColumns) {
      dropped += 1;
      return;
    }
    row[key] = v;
    count += 1;
  };
  const visit = (node: Record<string, unknown>, prefix: string, depth: number) => {
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      const v = node[key];
      const name = prefix ? `${prefix}.${key}` : key;
      const scalar = cell(v);
      if (scalar !== undefined) put(name, scalar);
      else if (Array.isArray(v)) {
        if (v.every((x) => cell(x) !== undefined)) put(name, cell(v.map((x) => String(x ?? "")).join("; ")) ?? null);
      } else if (isPlainObject(v) && depth < 2) visit(v, name, depth + 1);
    }
  };
  if (isPlainObject(value)) visit(value, "", 0);
  return { row, dropped };
}

export function columnTypes(rows: readonly Row[]): Array<{ name: string; type: ColumnType }> {
  const types = new Map<string, ColumnType>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const v = row[key];
      const t: ColumnType = v === null ? "null" : (typeof v as ColumnType);
      const prev = types.get(key);
      if (prev === undefined || prev === "null") types.set(key, t);
      else if (t !== "null" && prev !== t) types.set(key, "mixed");
    }
  }
  return [...types].map(([name, type]) => ({ name, type }));
}

/** Loads a whole table, from a custom loader or by paging the handler, and flattens its rows. */
export async function loadTable(modules: SourceModule[], ref: TableRef, ctx: ToolContext, maxRows = MAX_TABLE_ROWS): Promise<LoadedTable> {
  const { tool, module, args } = resolveTool(modules, ref);
  const parsedArgs = z.object(tool.inputSchema).parse(args) as Record<string, unknown>;
  const loaded = tool.table!.load ? await tool.table!.load(parsedArgs, ctx, maxRows) : await pageHandler(tool, args, ctx, maxRows);
  if (loaded.rows.length > maxRows) throw tooLarge(tool, `it has ${loaded.rows.length} rows`, maxRows);
  let dropped = 0;
  const rows = loaded.rows.map((r) => {
    const flat = flattenRow(r);
    dropped = Math.max(dropped, flat.dropped);
    return flat.row;
  });
  const env = loaded.envelope;
  return {
    table_id: tableId(module.info.id, tool.name, args),
    source: module.info.id,
    operation: tool.name,
    args,
    rows,
    columns: columnTypes(rows),
    provenance: {
      source: env.source,
      url: loaded.urls[0] ?? env.url,
      urls_read: loaded.urls.length,
      licence: env.licence,
      attribution: env.attribution,
      retrieved_at: env.retrieved_at,
      cached: env.cached,
      stale: Boolean(env.stale),
      pages: loaded.pages
    },
    ...(dropped ? { dropped_columns: dropped } : {})
  };
}
