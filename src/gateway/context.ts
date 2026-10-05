import { TieredCache, type PersistentStore } from "./cache.js";
import { HttpClient, type FetchLike, type HttpOptions } from "./http.js";
import type { CachedJsonOptions, ToolContext } from "./module.js";
import { SpanKind, withSpan } from "./otel.js";
import { sourceForUrl, type UpstreamBudgets } from "./upstreamBudget.js";

export interface ContextOptions {
  fetch?: FetchLike;
  store?: PersistentStore;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  cache?: TieredCache;
  /** Per-source concurrency, timeout and circuit breakers. Without it calls are unbudgeted. */
  budgets?: UpstreamBudgets;
}

/** INTERNAL span per cached upstream read, flagging cache hits and stale fallbacks. */
function traced<T extends { cached: boolean; stale: boolean }>(url: string, load: () => Promise<T>): Promise<T> {
  const source = sourceForUrl(url);
  return withSpan(`upstream ${source}`, SpanKind.INTERNAL, { "ireland_mcp.source.id": source }, async (span) => {
    const result = await load();
    span.setAttributes({ "ireland_mcp.cache.hit": result.cached, "ireland_mcp.cache.stale": result.stale });
    return result;
  });
}

export function createContext(options: ContextOptions = {}): ToolContext {
  const http = new HttpClient(options.fetch, options.budgets);
  const now = options.now ?? (() => new Date());
  const cache =
    options.cache ??
    new TieredCache({ maxEntries: 500, now: () => now().getTime(), ...(options.store ? { store: options.store } : {}) });
  const env = options.env ?? process.env;

  const keyFor = (url: string, opts: HttpOptions & { cacheKey?: string } | undefined) =>
    opts?.cacheKey ?? `${opts?.method ?? "GET"} ${url} ${opts?.body ?? ""}`;

  return {
    http,
    cache,
    env,
    now,
    cachedJson: <T>(url: string, ttlMs: number, opts?: CachedJsonOptions<T>) => {
      const { validate, ...httpOpts } = opts ?? {};
      return traced(url, () =>
        cache.getOrLoad<T>(keyFor(url, opts), ttlMs, async () => {
          const value = await http.json<T>(url, httpOpts);
          validate?.(value);
          return value;
        })
      );
    },
    cachedText: (url: string, ttlMs: number, opts?: HttpOptions & { cacheKey?: string }) =>
      traced(url, () => cache.getOrLoad<string>(keyFor(url, opts), ttlMs, () => http.text(url, opts)))
  };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
