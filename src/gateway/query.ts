/**
 * ireland_query: server-side filter, join, derive, aggregate, rank and sort over table handles.
 * A small typed JSON pipeline, not SQL: no code is evaluated, no regular expressions come from callers,
 * every step is charged against a deterministic work budget, and rows, cells and joins are capped.
 */
import { z } from "zod";
import { MAX_MAX_TOKENS } from "./envelope.js";
import { ToolError } from "./errors.js";
import { cellsEqual, compareCells, evaluate, exprSize, normText, orderCells, parseExpr, toNum, type Expr } from "./expr.js";
import type { SourceModule, ToolContext } from "./module.js";
import { columnTypes, loadTable, parseTableId, resolveTool, type Cell, type LoadedTable, type Row, type TableRef } from "./table.js";

export const QUERY_LIMITS = {
  /** Tables per query. */
  maxTables: 4,
  /** Pipeline steps per query (main steps), and per table. */
  maxSteps: 20,
  /** Steps across the main pipeline and every table's own steps. */
  maxTotalSteps: 30,
  /** Rows across all loaded tables. */
  maxInputRows: 20_000,
  /** Rows at any point in the pipeline, checked before a join is built. */
  maxRows: 50_000,
  /** Rows × columns at any point in the pipeline. */
  maxCells: 1_000_000,
  /** Columns at any point in the pipeline. */
  maxColumns: 64,
  /** Rows returned. */
  maxOutputRows: 500,
  defaultOutputRows: 50,
  /** Deterministic work units (row × step cost) per query. */
  maxWork: 5_000_000,
  /** Wall-clock backstop for computation, after loading. */
  computeMs: 3_000,
  /** Wall-clock limit for loading every table. */
  loadMs: 25_000,
  /** ireland_query calls running at once on one instance. */
  maxConcurrent: 4,
  maxConditionNodes: 100,
  maxConditionDepth: 8,
  maxInValues: 500,
  maxDerivePerStep: 10,
  maxAggregatesPerStep: 12,
  maxGroupBy: 6,
  maxJoinKeys: 3,
  defaultMaxTokens: 3000
} as const;

const STEP_KINDS = ["filter", "join", "union", "derive", "aggregate", "select", "sort", "limit", "rank", "pct_of_total", "distinct"] as const;
type StepKind = (typeof STEP_KINDS)[number];
const FILTER_OPS = ["=", "==", "eq", "!=", "ne", ">", "gt", ">=", "gte", "<", "lt", "<=", "lte", "in", "not_in", "contains", "starts_with", "is_null", "not_null"] as const;
const AGG_FNS = ["count", "count_distinct", "sum", "avg", "min", "max", "median", "weighted_avg", "first"] as const;
type AggFn = (typeof AGG_FNS)[number];
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const ALIAS = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;

export const tableInputSchema = z.object({
  alias: z.string().regex(ALIAS),
  table_id: z.string().max(4000).optional(),
  source: z.string().max(40).optional(),
  operation: z.string().max(60).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).max(QUERY_LIMITS.maxSteps).optional().describe("Steps run on this table alone before the main steps (no join or union).")
});

export const queryInputShape = {
  tables: z.array(tableInputSchema).min(1).max(QUERY_LIMITS.maxTables),
  from: z.string().max(31).optional().describe("Start alias (default first)."),
  steps: z
    .array(z.record(z.string(), z.unknown()))
    .max(QUERY_LIMITS.maxSteps)
    .optional()
    .describe("Steps, in order."),
  limit: z.number().int().min(1).max(QUERY_LIMITS.maxOutputRows).optional().describe(`Rows out (default ${QUERY_LIMITS.defaultOutputRows}).`),
  max_tokens: z.number().int().min(500).max(MAX_MAX_TOKENS).optional().describe(`Token budget (default ${QUERY_LIMITS.defaultMaxTokens}).`)
};
const queryInput = z.object(queryInputShape);
export type QueryInput = z.infer<typeof queryInput>;

const bad = (message: string, hint?: string) => new ToolError("BAD_ARGS", message, hint ? { hint } : {});
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class Budget {
  private used = 0;
  private readonly deadline: number;
  constructor(
    private readonly max: number,
    ms: number,
    private readonly clock: () => number = Date.now
  ) {
    this.deadline = clock() + ms;
  }
  charge(units: number) {
    const before = this.used;
    this.used += Math.max(1, Math.ceil(units));
    if (this.used > this.max) {
      throw bad(`Query needs more than ${this.max.toLocaleString("en-IE")} work units.`, "Filter or aggregate earlier, select fewer columns, or narrow the source arguments.");
    }
    if (Math.floor(before / 8192) !== Math.floor(this.used / 8192) && this.clock() > this.deadline) {
      throw bad(`Query took longer than ${QUERY_LIMITS.computeMs} ms to compute.`, "Filter or aggregate earlier, or narrow the source arguments.");
    }
  }
  get units() {
    return this.used;
  }
}

interface State {
  rows: Row[];
  columns: string[];
}

function resolver(columns: readonly string[]) {
  return (name: unknown): string => {
    if (typeof name !== "string" || !name) throw bad("Column names must be non-empty strings.");
    if (columns.includes(name)) return name;
    const lower = name.toLowerCase();
    const ci = columns.filter((c) => c.toLowerCase() === lower);
    if (ci.length === 1) return ci[0]!;
    const near = columns.filter((c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase())).slice(0, 5);
    throw bad(
      `Unknown column "${name.slice(0, 80)}".${near.length ? ` Did you mean ${near.map((c) => `"${c}"`).join(", ")}?` : ""}`,
      `Columns here: ${columns.slice(0, 40).join(", ")}${columns.length > 40 ? ", …" : ""}.`
    );
  };
}

function checkName(name: string, what: string): string {
  if (typeof name !== "string" || !name.trim() || name.length > 64 || FORBIDDEN.has(name) || [...name].some((c) => c < " ")) {
    throw bad(`Invalid ${what} name "${String(name).slice(0, 40)}".`, "Use 1–64 printable characters.");
  }
  return name;
}

function checkSize(state: State) {
  if (state.rows.length > QUERY_LIMITS.maxRows) throw bad(`The pipeline reached ${state.rows.length} rows; the limit is ${QUERY_LIMITS.maxRows}.`, "Filter or aggregate earlier.");
  if (state.columns.length > QUERY_LIMITS.maxColumns) throw bad(`The pipeline reached ${state.columns.length} columns; the limit is ${QUERY_LIMITS.maxColumns}.`, "Use select to keep fewer columns before joining.");
  if (state.rows.length * state.columns.length > QUERY_LIMITS.maxCells) {
    throw bad(`The pipeline reached ${state.rows.length * state.columns.length} cells; the limit is ${QUERY_LIMITS.maxCells}.`, "Select fewer columns or filter earlier.");
  }
}

// ---------- conditions ----------

type Pred = (row: Row) => boolean;

const keyOf = (v: Cell): string => {
  const n = toNum(v);
  return n !== null && typeof v !== "boolean" ? `n:${n}` : `s:${v === null ? "" : String(v)}`;
};

function compileCond(cond: unknown, resolve: (n: unknown) => string, budget: Budget, counter = { nodes: 0 }, depth = 0): { pred: Pred; cost: number } {
  counter.nodes += 1;
  if (counter.nodes > QUERY_LIMITS.maxConditionNodes) throw bad(`A condition has more than ${QUERY_LIMITS.maxConditionNodes} parts.`);
  if (depth > QUERY_LIMITS.maxConditionDepth) throw bad(`A condition is nested more than ${QUERY_LIMITS.maxConditionDepth} levels.`);
  if (Array.isArray(cond)) {
    if (cond.length < 2 || cond.length > 3) throw bad('A condition array is [column, op, value], e.g. ["residential_units", ">", 0].');
    return compileCompare(cond[0], cond[1], cond[2], cond.length === 3, resolve, budget);
  }
  if (!isPlainObject(cond)) throw bad("A condition is [column, op, value], {col, op, value}, {and: [...]}, {or: [...]} or {not: ...}.");
  if ("and" in cond || "or" in cond) {
    const list = cond.and ?? cond.or;
    if (!Array.isArray(list) || list.length === 0) throw bad("and/or take a non-empty list of conditions.");
    const parts = list.map((c) => compileCond(c, resolve, budget, counter, depth + 1));
    const cost = parts.reduce((t, p) => t + p.cost, 0);
    const preds = parts.map((p) => p.pred);
    return { pred: "and" in cond ? (r) => preds.every((p) => p(r)) : (r) => preds.some((p) => p(r)), cost };
  }
  if ("not" in cond) {
    const inner = compileCond(cond.not, resolve, budget, counter, depth + 1);
    return { pred: (r) => !inner.pred(r), cost: inner.cost };
  }
  return compileCompare(cond.col ?? cond.column, cond.op, cond.value, "value" in cond, resolve, budget);
}

function compileCompare(colName: unknown, opRaw: unknown, value: unknown, hasValue: boolean, resolve: (n: unknown) => string, budget: Budget): { pred: Pred; cost: number } {
  const col = resolve(colName);
  const op = typeof opRaw === "string" ? opRaw.toLowerCase() : "";
  if (!(FILTER_OPS as readonly string[]).includes(op)) throw bad(`Unknown filter op "${String(opRaw).slice(0, 20)}".`, `Ops: ${FILTER_OPS.join(", ")}.`);
  const get = (r: Row): Cell => (Object.hasOwn(r, col) ? r[col]! : null);
  if (op === "is_null") return { pred: (r) => get(r) === null || get(r) === "", cost: 1 };
  if (op === "not_null") return { pred: (r) => get(r) !== null && get(r) !== "", cost: 1 };
  if (!hasValue) throw bad(`Filter "${op}" on ${col} needs a value.`);
  if (op === "in" || op === "not_in") {
    if (!Array.isArray(value) || value.length > QUERY_LIMITS.maxInValues) throw bad(`"${op}" takes a list of up to ${QUERY_LIMITS.maxInValues} values.`);
    const set = new Set(value.map((v) => keyOf(scalar(v))));
    return { pred: op === "in" ? (r) => set.has(keyOf(get(r))) : (r) => !set.has(keyOf(get(r))), cost: 2 };
  }
  const v = scalar(value);
  if (op === "contains" || op === "starts_with") {
    if (typeof v !== "string" || v.length === 0 || v.length > 200) throw bad(`"${op}" takes text of 1–200 characters.`);
    const needle = v.toLowerCase();
    return {
      pred: (r) => {
        const cell = get(r);
        if (cell === null) return false;
        const s = String(cell);
        budget.charge(s.length / 64);
        const hay = s.toLowerCase();
        return op === "contains" ? hay.includes(needle) : hay.startsWith(needle);
      },
      cost: 2
    };
  }
  if (op === "=" || op === "==" || op === "eq") return { pred: (r) => cellsEqual(get(r), v), cost: 1 };
  if (op === "!=" || op === "ne") return { pred: (r) => !cellsEqual(get(r), v), cost: 1 };
  const test = op === ">" || op === "gt" ? (c: number) => c > 0 : op === ">=" || op === "gte" ? (c: number) => c >= 0 : op === "<" || op === "lt" ? (c: number) => c < 0 : (c: number) => c <= 0;
  return {
    pred: (r) => {
      const c = orderCells(get(r), v);
      return c !== null && test(c);
    },
    cost: 1
  };
}

function scalar(v: unknown): Cell {
  if (v === null || typeof v === "number" || typeof v === "boolean") return v === null || typeof v !== "number" || Number.isFinite(v) ? (v as Cell) : null;
  if (typeof v === "string") {
    if (v.length > 1000) throw bad("Condition values are limited to 1,000 characters.");
    return v;
  }
  throw bad("Condition values must be text, numbers, booleans or null.");
}

// ---------- steps ----------

function stepKind(step: Record<string, unknown>): StepKind {
  const kinds = STEP_KINDS.filter((k) => Object.hasOwn(step, k));
  if (kinds.length !== 1) {
    throw bad(`Each step needs exactly one of: ${STEP_KINDS.join(", ")}.`, 'e.g. {"filter": ["year", "=", 2024]}, {"aggregate": {"n": "count"}, "group_by": ["county"]}.');
  }
  return kinds[0]!;
}

function filterStep(state: State, cond: unknown, budget: Budget): State {
  const { pred, cost } = compileCond(cond, resolver(state.columns), budget);
  const rows: Row[] = [];
  for (const r of state.rows) {
    budget.charge(cost);
    if (pred(r)) rows.push(r);
  }
  return { rows, columns: state.columns };
}

function joinPairs(on: unknown, leftCols: readonly string[], rightCols: readonly string[]): Array<[string, string]> {
  let pairs: unknown[];
  if (typeof on === "string") pairs = [[on, on]];
  else if (Array.isArray(on) && on.length === 2 && on.every((x) => typeof x === "string")) pairs = [on];
  else if (Array.isArray(on)) pairs = on;
  else throw bad('join "on" is a column name, [left, right], or [[left, right], ...].');
  if (pairs.length === 0 || pairs.length > QUERY_LIMITS.maxJoinKeys) throw bad(`A join takes 1–${QUERY_LIMITS.maxJoinKeys} key pairs.`);
  const l = resolver(leftCols);
  const r = resolver(rightCols);
  return pairs.map((p) => {
    if (typeof p === "string") return [l(p), r(p)];
    if (!Array.isArray(p) || p.length !== 2) throw bad("Each join key pair is [left_column, right_column].");
    return [l(p[0]), r(p[1])];
  });
}

function joinStep(state: State, step: Record<string, unknown>, tables: Map<string, LoadedTable>, budget: Budget): State {
  const alias = String(step.join);
  const right = tables.get(alias);
  if (!right) throw bad(`join: no table with alias "${alias.slice(0, 31)}".`, `Aliases: ${[...tables.keys()].join(", ")}.`);
  const type = step.type === undefined ? "inner" : step.type;
  if (type !== "inner" && type !== "left") throw bad('join type is "inner" (default) or "left".');
  const normalize = step.normalize === true;
  const rightCols = right.columns.map((c) => c.name);
  let rightRows = right.rows;
  if (step.where !== undefined) rightRows = filterStep({ rows: rightRows, columns: rightCols }, step.where, budget).rows;
  const pairs = joinPairs(step.on, state.columns, rightCols);
  const key = (row: Row, side: 0 | 1): string | null => {
    const parts: string[] = [];
    for (const p of pairs) {
      const v = Object.hasOwn(row, p[side]) ? row[p[side]]! : null;
      if (v === null || v === "") return null;
      parts.push(normalize ? normText(String(v)) : String(v));
    }
    return parts.join("\u0001");
  };
  const buckets = new Map<string, Row[]>();
  for (const r of rightRows) {
    budget.charge(1);
    const k = key(r, 1);
    if (k === null) continue;
    const b = buckets.get(k);
    if (b) b.push(r);
    else buckets.set(k, [r]);
  }
  // Right columns that would clash take the alias as a prefix; a right key with the same name as its left key is dropped.
  const dropRight = new Set(pairs.filter(([a, b]) => a === b).map(([, b]) => b));
  const rename = new Map<string, string>();
  for (const c of rightCols) {
    if (dropRight.has(c)) continue;
    rename.set(c, state.columns.includes(c) ? `${alias}.${c}` : c);
  }
  const columns = [...state.columns, ...[...rename.values()].filter((c) => !state.columns.includes(c))];
  // Size the result before building it, so a many-to-many join cannot exhaust memory.
  const keys: Array<string | null> = [];
  let estimate = 0;
  for (const l of state.rows) {
    budget.charge(1);
    const k = key(l, 0);
    keys.push(k);
    const n = k === null ? 0 : (buckets.get(k)?.length ?? 0);
    estimate += n === 0 ? (type === "left" ? 1 : 0) : n;
  }
  if (estimate > QUERY_LIMITS.maxRows || estimate * columns.length > QUERY_LIMITS.maxCells) {
    throw bad(`That join would produce ${estimate} rows × ${columns.length} columns; the limits are ${QUERY_LIMITS.maxRows} rows and ${QUERY_LIMITS.maxCells} cells.`, "Join on a more specific key, filter both sides first (join where:), or aggregate before joining.");
  }
  const rows: Row[] = [];
  state.rows.forEach((l, i) => {
    const k = keys[i]!;
    const matches = k === null ? undefined : buckets.get(k);
    if (!matches) {
      if (type === "left") {
        const out = Object.assign(Object.create(null) as Row, l);
        for (const c of rename.values()) if (!Object.hasOwn(out, c)) out[c] = null;
        rows.push(out);
      }
      return;
    }
    for (const m of matches) {
      budget.charge(columns.length / 8);
      const out = Object.assign(Object.create(null) as Row, l);
      for (const [from, to] of rename) out[to] = Object.hasOwn(m, from) ? m[from]! : null;
      rows.push(out);
    }
  });
  return { rows, columns };
}

function unionStep(state: State, alias: unknown, tables: Map<string, LoadedTable>, budget: Budget): State {
  const t = tables.get(String(alias));
  if (!t) throw bad(`union: no table with alias "${String(alias).slice(0, 31)}".`);
  budget.charge(t.rows.length);
  const columns = [...state.columns, ...t.columns.map((c) => c.name).filter((c) => !state.columns.includes(c))];
  return { rows: [...state.rows, ...t.rows], columns };
}

function deriveStep(state: State, spec: unknown, budget: Budget): State {
  if (!isPlainObject(spec) || Object.keys(spec).length === 0 || Object.keys(spec).length > QUERY_LIMITS.maxDerivePerStep) {
    throw bad(`derive takes {new_column: "expression"} with 1–${QUERY_LIMITS.maxDerivePerStep} columns.`, 'e.g. {"derive": {"per_1000": "completions / population * 1000"}}.');
  }
  const columns = [...state.columns];
  const compiled: Array<[string, Expr, number]> = [];
  for (const [name, src] of Object.entries(spec)) {
    checkName(name, "column");
    if (typeof src !== "string" && typeof src !== "number") throw bad(`derive ${name}: the expression must be text.`);
    const expr = parseExpr(String(src), resolver(columns));
    compiled.push([name, expr, exprSize(expr)]);
    if (!columns.includes(name)) columns.push(name);
  }
  const rows = state.rows.map((r) => {
    const out = Object.assign(Object.create(null) as Row, r);
    for (const [name, expr, size] of compiled) {
      const v = evaluate(expr, out);
      budget.charge(size + (typeof v === "string" ? v.length / 4 : 0));
      out[name] = v;
    }
    return out;
  });
  return { rows, columns };
}

interface AggSpec {
  name: string;
  fn: AggFn;
  col?: string;
  weight?: string;
}

function parseAgg(name: string, spec: unknown, resolve: (n: unknown) => string): AggSpec {
  checkName(name, "aggregate");
  let fn: unknown;
  let col: unknown;
  let weight: unknown;
  if (typeof spec === "string") [fn, col, weight] = spec.split(":");
  else if (isPlainObject(spec)) ({ fn, col, weight } = spec);
  else throw bad(`aggregate ${name}: use "count", "sum:column", "weighted_avg:column:weight" or {fn, col, weight}.`);
  if (typeof fn !== "string" || !(AGG_FNS as readonly string[]).includes(fn)) throw bad(`aggregate ${name}: unknown function "${String(fn).slice(0, 20)}".`, `Functions: ${AGG_FNS.join(", ")}.`);
  if (fn !== "count" && (col === undefined || col === "")) throw bad(`aggregate ${name}: ${fn} needs a column, e.g. "${fn}:value".`);
  if (fn === "weighted_avg" && !weight) throw bad(`aggregate ${name}: weighted_avg needs a weight column, e.g. "weighted_avg:score:population".`);
  return { name, fn: fn as AggFn, ...(col ? { col: resolve(col) } : {}), ...(weight ? { weight: resolve(weight) } : {}) };
}

function aggregateStep(state: State, step: Record<string, unknown>, budget: Budget, warnings: string[]): State {
  const resolve = resolver(state.columns);
  const spec = step.aggregate;
  if (!isPlainObject(spec) || Object.keys(spec).length === 0 || Object.keys(spec).length > QUERY_LIMITS.maxAggregatesPerStep) {
    throw bad(`aggregate takes {name: "fn:column"} with 1–${QUERY_LIMITS.maxAggregatesPerStep} entries.`, 'e.g. {"aggregate": {"applications": "count", "units": "sum:residential_units"}, "group_by": ["council"]}.');
  }
  const groupRaw = step.group_by === undefined ? [] : typeof step.group_by === "string" ? [step.group_by] : step.group_by;
  if (!Array.isArray(groupRaw) || groupRaw.length > QUERY_LIMITS.maxGroupBy) throw bad(`group_by takes up to ${QUERY_LIMITS.maxGroupBy} columns.`);
  const groupBy = groupRaw.map(resolve);
  const aggs = Object.entries(spec).map(([n, s]) => parseAgg(n, s, resolve));
  const names = new Set<string>(groupBy);
  for (const a of aggs) {
    if (names.has(a.name)) throw bad(`aggregate: "${a.name}" is used twice.`);
    names.add(a.name);
  }
  const groups = new Map<string, Row[]>();
  for (const r of state.rows) {
    budget.charge(1 + groupBy.length);
    const k = groupBy.map((c) => keyOf(Object.hasOwn(r, c) ? r[c]! : null)).join("\u0001");
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  if (groupBy.length === 0 && groups.size === 0) groups.set("", []);
  const skipped = new Map<string, number>();
  const rows: Row[] = [];
  for (const members of groups.values()) {
    const out = Object.create(null) as Row;
    for (const c of groupBy) out[c] = members[0] && Object.hasOwn(members[0], c) ? members[0][c]! : null;
    for (const a of aggs) {
      budget.charge(members.length);
      const cells = a.col ? members.map((m) => (Object.hasOwn(m, a.col!) ? m[a.col!]! : null)) : [];
      const numbers = (): number[] => {
        const xs: number[] = [];
        for (const c of cells) {
          const n = c === null || c === "" ? null : toNum(c);
          if (n === null) skipped.set(a.name, (skipped.get(a.name) ?? 0) + 1);
          else xs.push(n);
        }
        return xs;
      };
      out[a.name] = aggregate(a, members, cells, numbers, budget);
    }
    rows.push(out);
  }
  for (const [name, n] of skipped) warnings.push(`${name}: skipped ${n} empty or non-numeric cell${n === 1 ? "" : "s"}.`);
  return { rows, columns: [...groupBy, ...aggs.map((a) => a.name)] };
}

function aggregate(a: AggSpec, members: Row[], cells: Cell[], numbers: () => number[], budget: Budget): Cell {
  switch (a.fn) {
    case "count":
      return a.col ? cells.filter((c) => c !== null && c !== "").length : members.length;
    case "count_distinct":
      return new Set(cells.filter((c) => c !== null && c !== "").map(keyOf)).size;
    case "first":
      return cells.find((c) => c !== null) ?? null;
    case "min":
    case "max": {
      const present = cells.filter((c): c is Exclude<Cell, null> => c !== null && c !== "");
      if (!present.length) return null;
      return present.reduce((best, c) => ((a.fn === "min" ? compareCells(c, best) < 0 : compareCells(c, best) > 0) ? c : best));
    }
    case "sum":
    case "avg":
    case "median": {
      const xs = numbers();
      if (!xs.length) return null;
      if (a.fn === "sum") return round(xs.reduce((t, x) => t + x, 0));
      if (a.fn === "avg") return round(xs.reduce((t, x) => t + x, 0) / xs.length);
      budget.charge(xs.length * Math.log2(xs.length + 1));
      const sorted = [...xs].sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      return round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
    }
    case "weighted_avg": {
      let num = 0;
      let den = 0;
      members.forEach((m) => {
        const x = toNum(Object.hasOwn(m, a.col!) ? m[a.col!]! : null);
        const w = toNum(Object.hasOwn(m, a.weight!) ? m[a.weight!]! : null);
        if (x !== null && w !== null) {
          num += x * w;
          den += w;
        }
      });
      return den === 0 ? null : round(num / den);
    }
  }
}

/** Rounds float noise (0.1 + 0.2, sums of cents) to 12 significant digits. */
const round = (x: number): number | null => (Number.isFinite(x) ? Number(x.toPrecision(12)) : null);

function selectStep(state: State, spec: unknown, budget: Budget): State {
  const resolve = resolver(state.columns);
  const size = Array.isArray(spec) ? spec.length : isPlainObject(spec) ? Object.keys(spec).length : -1;
  if (size < 1 || size > QUERY_LIMITS.maxColumns) throw bad(`select takes 1–${QUERY_LIMITS.maxColumns} columns as ["col", ...] or {"new_name": "col", ...}.`);
  const named = new Map<string, string>();
  if (Array.isArray(spec)) for (const c of spec) named.set(resolve(c), resolve(c));
  else for (const [to, from] of Object.entries(spec as Record<string, unknown>)) named.set(checkName(to, "column"), resolve(from));
  const pairs = [...named];
  budget.charge(state.rows.length * pairs.length);
  const rows = state.rows.map((r) => {
    const out = Object.create(null) as Row;
    for (const [to, from] of pairs) out[to] = Object.hasOwn(r, from) ? r[from]! : null;
    return out;
  });
  return { rows, columns: pairs.map(([to]) => to) };
}

function sortKeys(spec: unknown, resolve: (n: unknown) => string): Array<{ col: string; desc: boolean }> {
  const list = Array.isArray(spec) ? spec : [spec];
  if (list.length === 0 || list.length > 5) throw bad("sort takes 1–5 keys.");
  return list.map((k) => {
    if (typeof k === "string") return k.startsWith("-") ? { col: resolve(k.slice(1)), desc: true } : { col: resolve(k), desc: false };
    if (isPlainObject(k)) return { col: resolve(k.col ?? k.column), desc: k.desc === true || k.order === "desc" };
    throw bad('sort keys are "col", "-col" (descending) or {col, desc}.');
  });
}

function compareRows(keys: Array<{ col: string; desc: boolean }>) {
  return (x: Row, y: Row): number => {
    for (const { col, desc } of keys) {
      const a = Object.hasOwn(x, col) ? x[col]! : null;
      const b = Object.hasOwn(y, col) ? y[col]! : null;
      // Empty values sort last in either direction.
      if (a === null || b === null) {
        if (a === b) continue;
        return a === null ? 1 : -1;
      }
      const c = compareCells(a, b);
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  };
}

function sortStep(state: State, spec: unknown, budget: Budget): State {
  const keys = sortKeys(spec, resolver(state.columns));
  budget.charge(state.rows.length * Math.log2(state.rows.length + 1) * keys.length);
  return { rows: [...state.rows].sort(compareRows(keys)), columns: state.columns };
}

/** Groups row indexes by the partition columns, in first-seen order. */
function partitions(rows: Row[], by: string[]): number[][] {
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const k = by.map((c) => keyOf(Object.hasOwn(r, c) ? r[c]! : null)).join("\u0001");
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  return [...groups.values()];
}

function partitionBy(spec: Record<string, unknown>, resolve: (n: unknown) => string): string[] {
  const raw = spec.partition_by === undefined ? [] : typeof spec.partition_by === "string" ? [spec.partition_by] : spec.partition_by;
  if (!Array.isArray(raw) || raw.length > QUERY_LIMITS.maxGroupBy) throw bad(`partition_by takes up to ${QUERY_LIMITS.maxGroupBy} columns.`);
  return raw.map(resolve);
}

function rankStep(state: State, spec: unknown, budget: Budget): State {
  if (!isPlainObject(spec)) throw bad('rank takes {"by": "col", "desc": true, "name": "rank", "partition_by": [...]}.');
  const resolve = resolver(state.columns);
  const by = resolve(spec.by);
  const desc = spec.desc !== false;
  const name = checkName(typeof spec.name === "string" ? spec.name : "rank", "column");
  const parts = partitionBy(spec, resolve);
  budget.charge(state.rows.length * Math.log2(state.rows.length + 1));
  const out: Row[] = state.rows.map((r) => Object.assign(Object.create(null) as Row, r));
  const cmp = compareRows([{ col: by, desc }]);
  for (const group of partitions(state.rows, parts)) {
    const sorted = [...group].sort((x, y) => cmp(state.rows[x]!, state.rows[y]!) || x - y);
    sorted.forEach((idx, i) => {
      const r = state.rows[idx]!;
      const v = Object.hasOwn(r, by) ? r[by]! : null;
      const prevIdx = i > 0 ? sorted[i - 1]! : undefined;
      const same = prevIdx !== undefined && cmp(state.rows[prevIdx]!, r) === 0;
      out[idx]![name] = v === null ? null : same ? out[prevIdx!]![name]! : i + 1;
    });
  }
  return { rows: out, columns: state.columns.includes(name) ? state.columns : [...state.columns, name] };
}

function pctStep(state: State, spec: unknown, budget: Budget): State {
  if (!isPlainObject(spec)) throw bad('pct_of_total takes {"col": "value", "name": "pct", "partition_by": [...]}.');
  const resolve = resolver(state.columns);
  const col = resolve(spec.col ?? spec.column);
  const name = checkName(typeof spec.name === "string" ? spec.name : `${col}_pct`, "column");
  const parts = partitionBy(spec, resolve);
  budget.charge(state.rows.length * 2);
  const out: Row[] = state.rows.map((r) => Object.assign(Object.create(null) as Row, r));
  const val = (r: Row) => toNum(Object.hasOwn(r, col) ? r[col]! : null);
  for (const group of partitions(state.rows, parts)) {
    const total = group.reduce((t, i) => t + (val(state.rows[i]!) ?? 0), 0);
    for (const i of group) {
      const x = val(state.rows[i]!);
      out[i]![name] = x === null || total === 0 ? null : round((x / total) * 100);
    }
  }
  return { rows: out, columns: state.columns.includes(name) ? state.columns : [...state.columns, name] };
}

function distinctStep(state: State, spec: unknown, budget: Budget): State {
  const resolve = resolver(state.columns);
  const list = Array.isArray(spec) ? spec : [spec];
  if (list.length < 1 || list.length > QUERY_LIMITS.maxColumns) throw bad(`distinct takes 1–${QUERY_LIMITS.maxColumns} columns.`);
  const cols = [...new Set(list.map(resolve))];
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const r of state.rows) {
    budget.charge(cols.length);
    const k = cols.map((c) => keyOf(Object.hasOwn(r, c) ? r[c]! : null)).join("\u0001");
    if (seen.has(k)) continue;
    seen.add(k);
    const o = Object.create(null) as Row;
    for (const c of cols) o[c] = Object.hasOwn(r, c) ? r[c]! : null;
    rows.push(o);
  }
  return { rows, columns: cols };
}

function runSteps(initial: State, steps: Array<Record<string, unknown>>, tables: Map<string, LoadedTable>, budget: Budget, warnings: string[], label: string, allowJoins = true): State {
  let state = initial;
  steps.forEach((step, i) => {
    try {
      const kind = stepKind(step);
      if (!allowJoins && (kind === "join" || kind === "union")) throw bad(`${kind} is only allowed in the main steps.`);
      switch (kind) {
        case "filter":
          state = filterStep(state, step.filter, budget);
          break;
        case "join":
          state = joinStep(state, step, tables, budget);
          break;
        case "union":
          state = unionStep(state, step.union, tables, budget);
          break;
        case "derive":
          state = deriveStep(state, step.derive, budget);
          break;
        case "aggregate":
          state = aggregateStep(state, step, budget, warnings);
          break;
        case "select":
          state = selectStep(state, step.select, budget);
          break;
        case "sort":
          state = sortStep(state, step.sort, budget);
          break;
        case "limit": {
          const n = step.limit;
          if (typeof n !== "number" || !Number.isInteger(n) || n < 0) throw bad("limit takes a whole number.");
          state = { rows: state.rows.slice(0, n), columns: state.columns };
          break;
        }
        case "rank":
          state = rankStep(state, step.rank, budget);
          break;
        case "pct_of_total":
          state = pctStep(state, step.pct_of_total, budget);
          break;
        case "distinct":
          state = distinctStep(state, step.distinct, budget);
          break;
      }
      checkSize(state);
    } catch (error) {
      if (error instanceof ToolError) throw new ToolError(error.code, `${label} ${i + 1}: ${error.message}`, { hint: error.hint });
      throw error;
    }
  });
  return state;
}

// ---------- execution ----------

let running = 0;

/** Exposed for tests. */
export function runningQueries(): number {
  return running;
}

function refOf(t: z.infer<typeof tableInputSchema>): TableRef {
  if (t.table_id !== undefined) {
    if (t.source !== undefined || t.operation !== undefined || t.args !== undefined) throw bad(`Table "${t.alias}": give table_id or {source, operation, args}, not both.`);
    return parseTableId(t.table_id);
  }
  if (!t.source || !t.operation) throw bad(`Table "${t.alias}" needs a table_id or source and operation.`);
  return { source: t.source, operation: t.operation, args: t.args ?? {} };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError("UPSTREAM_DOWN", `Loading the tables took longer than ${ms / 1000} s.`, { hint: "Narrow the source arguments, or try again: upstream pages are cached once read." })), ms);
    timer.unref?.();
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const PREVIEW_ROWS = 5;

export interface QueryOptions {
  now?: () => Date;
  clock?: () => number;
  loadMs?: number;
}

/** Runs one ireland_query. Returns a plain result object; errors are thrown as ToolError. */
export async function runQuery(modules: SourceModule[], rawInput: unknown, ctx: ToolContext, options: QueryOptions = {}): Promise<Record<string, unknown>> {
  const parsed = queryInput.safeParse(rawInput);
  if (!parsed.success) {
    throw bad(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`.slice(0, 400));
  }
  const input = parsed.data;
  if (running >= QUERY_LIMITS.maxConcurrent) {
    throw new ToolError("RATE_LIMITED", "Too many ireland_query calls are running on this server.", { retryAfterSeconds: 2 });
  }
  running += 1;
  // A timed-out load keeps its slot until its upstream reads actually settle, so timeouts cannot pile up background work.
  const loads: { pending?: Promise<unknown> } = {};
  try {
    return await execute(modules, input, ctx, options, loads);
  } finally {
    if (loads.pending) void loads.pending.then(release, release);
    else release();
  }
}

function release() {
  running -= 1;
}

async function execute(modules: SourceModule[], input: QueryInput, ctx: ToolContext, options: QueryOptions, loads: { pending?: Promise<unknown> }): Promise<Record<string, unknown>> {
  const aliases = new Set<string>();
  for (const t of input.tables) {
    if (aliases.has(t.alias)) throw bad(`Alias "${t.alias}" is used twice.`);
    aliases.add(t.alias);
  }
  const refs = input.tables.map((t) => ({ alias: t.alias, ref: refOf(t) }));
  // Validate every table before any upstream read starts, so a bad table cannot leave others loading.
  for (const { ref } of refs) resolveTool(modules, ref);
  // Identical calls (a self-join) load once.
  const unique = new Map<string, Promise<LoadedTable>>();
  const loadAll = Promise.all(
    refs.map(({ ref }) => {
      const k = JSON.stringify([ref.source, ref.operation, ref.args]);
      if (!unique.has(k)) unique.set(k, loadTable(modules, ref, ctx));
      return unique.get(k)!;
    })
  );
  // The slot is held until every load settles, even after the first failure or the timeout.
  loads.pending = Promise.allSettled(unique.values());
  const loaded = await withTimeout(loadAll, options.loadMs ?? QUERY_LIMITS.loadMs);
  const totalRows = [...new Set(loaded)].reduce((t, l) => t + l.rows.length, 0);
  if (totalRows > QUERY_LIMITS.maxInputRows) {
    throw bad(`The tables hold ${totalRows} rows together; the limit is ${QUERY_LIMITS.maxInputRows}.`, "Narrow the source arguments.");
  }
  const totalSteps = (input.steps?.length ?? 0) + input.tables.reduce((t, x) => t + (x.steps?.length ?? 0), 0);
  if (totalSteps > QUERY_LIMITS.maxTotalSteps) throw bad(`The query has ${totalSteps} steps; the limit is ${QUERY_LIMITS.maxTotalSteps}.`);
  const budget = new Budget(QUERY_LIMITS.maxWork, QUERY_LIMITS.computeMs, options.clock);
  const warnings: string[] = [];
  const tables = new Map<string, LoadedTable>();
  input.tables.forEach((t, i) => {
    const base = loaded[i]!;
    if (!t.steps?.length) {
      tables.set(t.alias, base);
      return;
    }
    const out = runSteps({ rows: base.rows, columns: base.columns.map((c) => c.name) }, t.steps, tables, budget, warnings, `Table ${t.alias} step`, false);
    const types = new Map(columnTypes(out.rows).map((c) => [c.name, c.type]));
    tables.set(t.alias, { ...base, rows: out.rows, columns: out.columns.map((name) => ({ name, type: types.get(name) ?? "null" })) });
  });
  const inputs = refs.map(({ alias }, i) => {
    const t = loaded[i]!;
    return { alias, table_id: t.table_id, rows: t.rows.length, ...t.provenance, ...(t.dropped_columns ? { dropped_columns: t.dropped_columns } : {}) };
  });
  const echo = { tables: refs.map(({ alias }, i) => ({ alias, table_id: loaded[i]!.table_id, ...(input.tables[i]!.steps?.length ? { steps: input.tables[i]!.steps } : {}) })), ...(input.from ? { from: input.from } : {}), ...(input.steps ? { steps: input.steps } : {}), ...(input.limit ? { limit: input.limit } : {}) };
  const now = (options.now ?? ctx.now)();
  const evidence = {
    source: "ireland_query (computed on this server from the inputs listed)",
    licence: "Each input keeps its own licence; see inputs.",
    attribution: [...new Set(loaded.map((t) => t.provenance.attribution))].join(" "),
    retrieved_at: now.toISOString(),
    cached: loaded.every((t) => t.provenance.cached),
    ...(loaded.some((t) => t.provenance.stale) ? { stale: true } : {})
  };
  const maxChars = (input.max_tokens ?? QUERY_LIMITS.defaultMaxTokens) * 4;

  if (!input.steps || input.steps.length === 0) {
    if (input.from !== undefined && !tables.has(input.from)) throw bad(`from: no table with alias "${input.from}".`);
    const described = refs.map(({ alias }) => {
      const t = tables.get(alias)!;
      return { alias, table_id: t.table_id, row_count: t.rows.length, columns: Object.fromEntries(t.columns.map((c) => [c.name, c.type])), preview: t.rows.slice(0, PREVIEW_ROWS) };
    });
    return fit({ data: { tables: described, next: 'Add steps, e.g. [{"filter": ["col", ">", 0]}, {"aggregate": {"n": "count"}, "group_by": ["col"]}, {"sort": "-n"}].' }, ...evidence, truncated: false, inputs, query: echo }, maxChars, "data.tables");
  }

  const from = input.from ?? refs[0]!.alias;
  const start = tables.get(from);
  if (!start) throw bad(`from: no table with alias "${from.slice(0, 31)}".`, `Aliases: ${[...tables.keys()].join(", ")}.`);
  const state = runSteps({ rows: start.rows, columns: start.columns.map((c) => c.name) }, input.steps, tables, budget, warnings, "Step");
  const limit = input.limit ?? QUERY_LIMITS.defaultOutputRows;
  const rows = state.rows.slice(0, limit).map((r) => {
    const o: Record<string, Cell> = {};
    for (const c of state.columns) o[c] = Object.hasOwn(r, c) ? r[c]! : null;
    return o;
  });
  const result = {
    data: {
      columns: state.columns,
      row_count: state.rows.length,
      returned: rows.length,
      rows,
      ...(warnings.length ? { warnings } : {}),
      work_units: budget.units
    },
    ...evidence,
    truncated: rows.length < state.rows.length,
    inputs,
    query: echo
  };
  return fit(result, maxChars, "data.rows");
}

/** Keeps whole rows (never cut strings) until the result fits the budget, and says what was dropped. */
function fit(result: Record<string, unknown> & { data: Record<string, unknown> }, maxChars: number, path: "data.rows" | "data.tables"): Record<string, unknown> {
  const size = (v: unknown) => JSON.stringify(v).length;
  if (size(result) <= maxChars) return result;
  if (path === "data.tables") {
    const tables = result.data.tables as Array<Record<string, unknown>>;
    const trimmed = { ...result, data: { ...result.data, tables: tables.map((t) => ({ ...t, preview: (t.preview as unknown[]).slice(0, 1) })) } };
    if (size(trimmed) <= maxChars) return trimmed;
    throw bad("The table descriptions do not fit the result budget.", "Pass max_tokens (up to 8000) or describe fewer tables at once.");
  }
  const all = result.data.rows as unknown[];
  const empty = { ...result, data: { ...result.data, rows: [] as unknown[] } };
  let used = size(empty) + 200;
  if (used > maxChars) throw bad("The query echo and inputs alone exceed the result budget.", "Pass max_tokens (up to 8000).");
  const kept: unknown[] = [];
  for (const r of all) {
    const n = size(r) + 1;
    if (used + n > maxChars) break;
    kept.push(r);
    used += n;
  }
  return {
    ...result,
    data: { ...result.data, rows: kept, returned: kept.length },
    truncated: true,
    hint: `Only ${kept.length} of ${result.data.row_count as number} rows fit ~${Math.round(maxChars / 4)} tokens. Add select (fewer columns), aggregate, a smaller limit, or pass max_tokens (up to ${MAX_MAX_TOKENS}).`
  };
}
