/**
 * Expressions for ireland_query `derive` steps: a small recursive-descent parser over numbers, quoted
 * strings, column names and whitelisted functions. It builds an AST and never evaluates code, uses no
 * regular expressions on user input, and is bounded in length, tokens, nodes and nesting.
 */
import { ToolError } from "./errors.js";
import type { Cell } from "./table.js";

export const MAX_EXPR_CHARS = 500;
const MAX_TOKENS = 300;
const MAX_NODES = 200;
const MAX_DEPTH = 24;
/** Longest string an expression may build (concat, lower, ...). */
export const MAX_STRING_CHARS = 1_000;

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "col"; name: string }
  | { k: "neg"; a: Expr }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr }
  | { k: "fn"; name: FnName; args: Expr[] };

type BinOp = "+" | "-" | "*" | "/" | "%" | ">" | ">=" | "<" | "<=" | "==" | "!=";
type Token = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

const FUNCTIONS = {
  round: [1, 2],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  min: [1, 10],
  max: [1, 10],
  coalesce: [1, 10],
  if: [3, 3],
  lower: [1, 1],
  upper: [1, 1],
  trim: [1, 1],
  norm: [1, 1],
  concat: [1, 10],
  substr: [2, 3],
  split_part: [3, 3],
  replace: [3, 3],
  len: [1, 1],
  number: [1, 1],
  text: [1, 1],
  year: [1, 1],
  month: [1, 1],
  pct_change: [2, 2]
} as const satisfies Record<string, readonly [number, number]>;
export type FnName = keyof typeof FUNCTIONS;
export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FnName[];

const bad = (message: string) => new ToolError("BAD_ARGS", message, { hint: `Expressions use + - * / %, comparisons, 'text', numbers, column names ([Name With Spaces] for spaces) and ${FUNCTION_NAMES.join(", ")}.` });

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isId = (c: string) => isIdStart(c) || isDigit(c) || c === ".";

function tokenize(src: string): Token[] {
  if (src.length > MAX_EXPR_CHARS) throw bad(`Expression longer than ${MAX_EXPR_CHARS} characters.`);
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    if (out.length > MAX_TOKENS) throw bad("Expression has too many tokens.");
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n") {
      i += 1;
    } else if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && (isDigit(src[j]!) || src[j] === ".")) j += 1;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw bad(`Bad number "${src.slice(i, j)}".`);
      out.push({ t: "num", v });
      i = j;
    } else if (c === "'" || c === '"') {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw bad("Unclosed string.");
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (c === "[") {
      const j = src.indexOf("]", i + 1);
      if (j < 0) throw bad("Unclosed [column name].");
      out.push({ t: "id", v: src.slice(i + 1, j).trim() });
      i = j + 1;
    } else if (isIdStart(c)) {
      let j = i;
      while (j < src.length && isId(src[j]!)) j += 1;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if ([">=", "<=", "==", "!="].includes(two)) {
        out.push({ t: "op", v: two });
        i += 2;
      } else if ("+-*/%(),<>".includes(c)) {
        out.push({ t: "op", v: c });
        i += 1;
      } else if (c === "=") {
        out.push({ t: "op", v: "==" });
        i += 1;
      } else {
        throw bad(`Unexpected character "${c}" in expression.`);
      }
    }
  }
  return out;
}

/** Parses an expression. `resolve` maps a written column name to the real column (or throws). */
export function parseExpr(src: string, resolve: (name: string) => string): Expr {
  const tokens = tokenize(src);
  let pos = 0;
  let nodes = 0;
  const node = <T extends Expr>(e: T): T => {
    nodes += 1;
    if (nodes > MAX_NODES) throw bad("Expression is too complex.");
    return e;
  };
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw bad(`Expected "${v}" in expression.`);
    pos += 1;
  };

  const comparison = (depth: number): Expr => {
    let left = additive(depth);
    while ([">", ">=", "<", "<=", "==", "!="].some(isOp)) {
      const op = (tokens[pos++] as { v: BinOp }).v;
      left = node({ k: "bin", op, a: left, b: additive(depth) });
    }
    return left;
  };
  const additive = (depth: number): Expr => {
    let left = term(depth);
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as { v: BinOp }).v;
      left = node({ k: "bin", op, a: left, b: term(depth) });
    }
    return left;
  };
  const term = (depth: number): Expr => {
    let left = unary(depth);
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (tokens[pos++] as { v: BinOp }).v;
      left = node({ k: "bin", op, a: left, b: unary(depth) });
    }
    return left;
  };
  const unary = (depth: number): Expr => {
    if (isOp("-")) {
      pos += 1;
      return node({ k: "neg", a: unary(depth + 1) });
    }
    return primary(depth);
  };
  const primary = (depth: number): Expr => {
    if (depth > MAX_DEPTH) throw bad("Expression is nested too deeply.");
    const tok = peek();
    if (!tok) throw bad("Expression ended early.");
    pos += 1;
    if (tok.t === "num") return node({ k: "num", v: tok.v });
    if (tok.t === "str") return node({ k: "str", v: tok.v });
    if (tok.t === "op" && tok.v === "(") {
      const inner = comparison(depth + 1);
      expect(")");
      return inner;
    }
    if (tok.t === "id") {
      if (isOp("(")) {
        const name = tok.v.toLowerCase();
        if (!Object.hasOwn(FUNCTIONS, name)) throw bad(`Unknown function "${tok.v}".`);
        pos += 1;
        const args: Expr[] = [];
        if (!isOp(")")) {
          args.push(comparison(depth + 1));
          while (isOp(",")) {
            pos += 1;
            args.push(comparison(depth + 1));
          }
        }
        expect(")");
        const [min, max] = FUNCTIONS[name as FnName];
        if (args.length < min || args.length > max) throw bad(`${name}() takes ${min === max ? min : `${min} to ${max}`} argument${max > 1 ? "s" : ""}.`);
        return node({ k: "fn", name: name as FnName, args });
      }
      // coalesce() with no arguments evaluates to null.
      if (tok.v === "null") return node({ k: "fn", name: "coalesce", args: [] });
      return node({ k: "col", name: resolve(tok.v) });
    }
    throw bad(`Unexpected "${tok.v}" in expression.`);
  };

  const expr = comparison(0);
  if (pos < tokens.length) throw bad(`Unexpected "${String((tokens[pos] as { v: unknown }).v)}" in expression.`);
  return expr;
}

/** Folds accents, case and punctuation, and drops a leading "Co." / "County", for matching place names. */
export function normText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(co|county) /, "");
}

const toNum = (v: Cell): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
};
const toStr = (v: Cell): string => (v === null ? "" : String(v));
const capStr = (s: string): string => (s.length > MAX_STRING_CHARS ? s.slice(0, MAX_STRING_CHARS) : s);
/** Drops infinities and float noise (0.1 + 0.2) beyond 15 significant digits. */
const finite = (n: number): number | null => (Number.isFinite(n) ? Number(n.toPrecision(15)) : null);

export function compareCells(a: Cell, b: Cell): number {
  const na = typeof a === "number" ? a : null;
  const nb = typeof b === "number" ? b : null;
  if (na !== null && nb !== null) return na - nb;
  const sa = toStr(a);
  const sb = toStr(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Equality used by filters: numbers compare numerically, a numeric string equals its number. */
export function cellsEqual(a: Cell, b: Cell): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" || typeof b === "number") {
    const na = toNum(a);
    const nb = toNum(b);
    return na !== null && nb !== null && na === nb;
  }
  return toStr(a) === toStr(b);
}

/** Ordering used by filters: numeric when either side is a number and the other parses as one. */
export function orderCells(a: Cell, b: Cell): number | null {
  if (a === null || b === null) return null;
  if (typeof a === "number" || typeof b === "number") {
    const na = toNum(a);
    const nb = toNum(b);
    return na === null || nb === null ? null : na - nb;
  }
  const sa = toStr(a);
  const sb = toStr(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

export function evaluate(e: Expr, row: Record<string, Cell>): Cell {
  switch (e.k) {
    case "num":
      return e.v;
    case "str":
      return e.v;
    case "col":
      return Object.hasOwn(row, e.name) ? row[e.name]! : null;
    case "neg": {
      const n = toNum(evaluate(e.a, row));
      return n === null ? null : -n;
    }
    case "bin": {
      const a = evaluate(e.a, row);
      const b = evaluate(e.b, row);
      if (e.op === "==") return cellsEqual(a, b);
      if (e.op === "!=") return !cellsEqual(a, b);
      if (e.op === ">" || e.op === ">=" || e.op === "<" || e.op === "<=") {
        const c = orderCells(a, b);
        if (c === null) return null;
        return e.op === ">" ? c > 0 : e.op === ">=" ? c >= 0 : e.op === "<" ? c < 0 : c <= 0;
      }
      if (e.op === "+" && (typeof a === "string" || typeof b === "string") && (toNum(a) === null || toNum(b) === null)) return capStr(toStr(a) + toStr(b));
      const x = toNum(a);
      const y = toNum(b);
      if (x === null || y === null) return null;
      switch (e.op) {
        case "+":
          return finite(x + y);
        case "-":
          return finite(x - y);
        case "*":
          return finite(x * y);
        case "/":
          return y === 0 ? null : finite(x / y);
        case "%":
          return y === 0 ? null : finite(x % y);
      }
      return null;
    }
    case "fn":
      return callFn(e.name, e.args, row);
  }
}

function callFn(name: FnName, args: Expr[], row: Record<string, Cell>): Cell {
  const v = (i: number) => evaluate(args[i]!, row);
  const n = (i: number) => toNum(v(i));
  switch (name) {
    case "round": {
      const x = n(0);
      const dp = args.length > 1 ? Math.min(Math.max(Math.trunc(n(1) ?? 0), 0), 10) : 0;
      if (x === null) return null;
      const f = 10 ** dp;
      return Math.round(x * f) / f;
    }
    case "abs": {
      const x = n(0);
      return x === null ? null : Math.abs(x);
    }
    case "floor": {
      const x = n(0);
      return x === null ? null : Math.floor(x);
    }
    case "ceil": {
      const x = n(0);
      return x === null ? null : Math.ceil(x);
    }
    case "min":
    case "max": {
      const xs = args.map((_, i) => n(i)).filter((x): x is number => x !== null);
      if (!xs.length) return null;
      return name === "min" ? Math.min(...xs) : Math.max(...xs);
    }
    case "coalesce": {
      for (let i = 0; i < args.length; i += 1) {
        const x = v(i);
        if (x !== null && x !== "") return x;
      }
      return null;
    }
    case "if": {
      const c = v(0);
      return c === true || (typeof c === "number" && c !== 0) || (typeof c === "string" && c !== "") ? v(1) : v(2);
    }
    case "lower":
      return toStr(v(0)).toLowerCase();
    case "upper":
      return toStr(v(0)).toUpperCase();
    case "trim":
      return toStr(v(0)).trim();
    case "norm":
      return normText(toStr(v(0)));
    case "concat":
      return capStr(args.map((_, i) => toStr(v(i))).join(""));
    case "substr": {
      const s = toStr(v(0));
      const start = Math.max(0, Math.trunc(n(1) ?? 0));
      const len = args.length > 2 ? Math.max(0, Math.trunc(n(2) ?? 0)) : undefined;
      return s.substring(start, len === undefined ? undefined : start + len);
    }
    case "split_part": {
      // Plain-text split, 1-based like SQL's split_part; no regular expressions.
      const sep = toStr(v(1));
      const index = Math.trunc(n(2) ?? 0);
      if (!sep || index < 1) return null;
      const parts = toStr(v(0)).split(sep, 100);
      return index <= parts.length ? parts[index - 1]! : null;
    }
    case "replace": {
      const s = toStr(v(0));
      const find = toStr(v(1));
      const by = toStr(v(2));
      if (!find) return s;
      // Bound the output before building it: occurrences can only grow the text by (by - find) each.
      const grow = Math.max(0, by.length - find.length);
      if (grow > 0 && s.length + Math.floor(s.length / find.length) * grow > MAX_STRING_CHARS * 4) return null;
      return capStr(s.split(find).join(by));
    }
    case "len":
      return toStr(v(0)).length;
    case "number":
      return toNum(v(0));
    case "text": {
      const x = v(0);
      return x === null ? null : toStr(x);
    }
    case "year":
    case "month": {
      const s = toStr(v(0));
      const m = /^(\d{4})(?:[-/](\d{1,2}))?/.exec(s.slice(0, 10));
      if (!m) return null;
      if (name === "year") return Number(m[1]);
      return m[2] ? Number(m[2]) : null;
    }
    case "pct_change": {
      const from = n(0);
      const to = n(1);
      if (from === null || to === null || from === 0) return null;
      return finite(((to - from) / Math.abs(from)) * 100);
    }
  }
}

/** Number of AST nodes, used to charge work per row. */
export function exprSize(e: Expr): number {
  switch (e.k) {
    case "neg":
      return 1 + exprSize(e.a);
    case "bin":
      return 1 + exprSize(e.a) + exprSize(e.b);
    case "fn":
      return 1 + e.args.reduce((t, a) => t + exprSize(a), 0);
    default:
      return 1;
  }
}

export { toNum };
