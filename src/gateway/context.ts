import { TieredCache, type PersistentStore } from "./cache.js";
import { HttpClient, type FetchLike, type HttpOptions } from "./http.js";
import type { CachedJsonOptions, ToolContext } from "./module.js";

export interface ContextOptions {
  fetch?: FetchLike;
  store?: PersistentStore;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  cache?: TieredCache;
}

export function createContext(options: ContextOptions = {}): ToolContext {
  const http = new HttpClient(options.fetch);
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
      return cache.getOrLoad<T>(keyFor(url, opts), ttlMs, async () => {
        const value = await http.json<T>(url, httpOpts);
        validate?.(value);
        return value;
      });
    },
    cachedText: (url: string, ttlMs: number, opts?: HttpOptions & { cacheKey?: string }) =>
      cache.getOrLoad<string>(keyFor(url, opts), ttlMs, () => http.text(url, opts))
  };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
