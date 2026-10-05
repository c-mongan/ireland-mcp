export interface SourceInfo {
  /** Short source id, e.g. "cso". */
  id: string;
  /** Human-readable publisher name. */
  name: string;
  licence: string;
  attribution: string;
  homepage: string;
}

export interface Envelope<T = unknown> {
  data: T;
  source: string;
  url: string;
  licence: string;
  attribution: string;
  retrieved_at: string;
  cached: boolean;
  stale?: boolean;
  truncated: boolean;
}

export interface EnvelopeInput<T> {
  data: T;
  url: string;
  cached?: boolean;
  stale?: boolean;
  truncated?: boolean;
  retrievedAt?: Date;
}

export function envelope<T>(source: SourceInfo, input: EnvelopeInput<T>): Envelope<T> {
  return {
    data: input.data,
    source: source.name,
    url: input.url,
    licence: source.licence,
    attribution: source.attribution,
    retrieved_at: (input.retrievedAt ?? new Date()).toISOString(),
    cached: input.cached ?? false,
    ...(input.stale ? { stale: true } : {}),
    truncated: input.truncated ?? false
  };
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

/** Applies the shared result bound and reports whether anything was cut. */
export function bound<T>(items: readonly T[], limit: number | undefined): { items: T[]; truncated: boolean } {
  const effective = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  return { items: items.slice(0, effective), truncated: items.length > effective };
}

/** Default per-result budget, in estimated tokens (chars / 4). */
export const DEFAULT_MAX_TOKENS = 2000;
/** Hard ceiling for a caller-supplied max_tokens. */
export const MAX_MAX_TOKENS = 8000;
const MIN_MAX_TOKENS = 100;
/** Room kept for the truncation annotation itself. */
const ANNOTATION_RESERVE_CHARS = 400;
const STRING_MARKER = "… [truncated]";

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function clampMaxTokens(maxTokens: number | undefined): number {
  if (maxTokens === undefined || !Number.isFinite(maxTokens)) return DEFAULT_MAX_TOKENS;
  return Math.min(Math.max(Math.floor(maxTokens), MIN_MAX_TOKENS), MAX_MAX_TOKENS);
}

type Container = Record<string, unknown> | unknown[];
interface Cut {
  parent: Container;
  key: string | number;
  path: string;
  size: number;
}

const isContainer = (v: unknown): v is Container => typeof v === "object" && v !== null;

/** Finds the largest cuttable array (length > 0) or long string anywhere in the value. */
function largestCut(root: Container): Cut | undefined {
  let best: Cut | undefined;
  const visit = (node: Container, path: string) => {
    for (const [key, child] of Object.entries(node)) {
      const k: string | number = Array.isArray(node) ? Number(key) : key;
      const childPath = Array.isArray(node) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      const cuttable = (Array.isArray(child) && child.length > 0) || (typeof child === "string" && child.length > 200);
      if (cuttable) {
        const size = JSON.stringify(child).length;
        if (!best || size > best.size) best = { parent: node, key: k, path: childPath, size };
      }
      if (isContainer(child)) visit(child, childPath);
    }
  };
  visit(root, "");
  return best;
}

/**
 * Caps a tool result at roughly `maxTokens` (chars / 4, default 2000, max 8000) by repeatedly
 * shortening the largest array, then long strings. When `annotate` is true and the root is an object,
 * it gains `truncated: true`, `returned`, `total`, `truncated_at` and a `hint`. Never mutates the input.
 */
export function applyBudget(value: unknown, maxTokens?: number, options: { annotate?: boolean } = {}): unknown {
  const tokens = clampMaxTokens(maxTokens);
  const limitChars = tokens * 4;
  if (!isContainer(value) || JSON.stringify(value).length <= limitChars) return value;
  const annotate = (options.annotate ?? true) && !Array.isArray(value);
  const root = JSON.parse(JSON.stringify(value)) as Container;
  const target = annotate ? limitChars - ANNOTATION_RESERVE_CHARS : limitChars;
  const size = () => JSON.stringify(root).length;
  let first: { path: string; returned: number; total: number } | undefined;

  for (let guard = 0; guard < 200 && size() > target; guard += 1) {
    const cut = largestCut(root);
    if (!cut) break;
    const parent = cut.parent as Record<string | number, unknown>;
    const current = parent[cut.key];
    const overshoot = size() - target;
    if (Array.isArray(current)) {
      const full = current;
      let lo = 0;
      let hi = full.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        parent[cut.key] = full.slice(0, mid);
        if (size() <= target) lo = mid;
        else hi = mid - 1;
      }
      parent[cut.key] = full.slice(0, lo);
      if (!first) first = { path: cut.path, returned: lo, total: full.length };
      else if (first.path === cut.path) first.returned = lo;
    } else if (typeof current === "string") {
      const keep = Math.max(0, current.length - overshoot - STRING_MARKER.length - 16);
      parent[cut.key] = `${current.slice(0, keep)}${STRING_MARKER}`;
      if (keep === 0) break;
    }
  }

  if (annotate) {
    const obj = root as Record<string, unknown>;
    obj.truncated = true;
    if (first) {
      obj.truncated_at = first.path;
      obj.returned = first.returned;
      obj.total = first.total;
    }
    obj.hint = `Result cut to fit ~${tokens} tokens. Narrow the request (filters, smaller limit) or pass max_tokens (up to ${MAX_MAX_TOKENS}).`;
  }
  return root;
}
