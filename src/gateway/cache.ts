import { LRUCache } from "lru-cache";

export interface CacheEntry {
  value: unknown;
  /** Epoch ms after which the entry is stale but still usable as a fallback. */
  expiresAt: number;
  storedAt: number;
}

/** Durable second tier (Azure Table Storage in production). */
export interface PersistentStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export interface CacheResult<T> {
  value: T;
  cached: boolean;
  stale: boolean;
}

export interface CacheOptions {
  maxEntries?: number;
  store?: PersistentStore;
  now?: () => number;
}

/**
 * Two-tier cache: in-memory LRU in front of an optional persistent store.
 * Expired entries are retained so they can be served when the upstream fails.
 * Concurrent loads for the same key share a single upstream call.
 */
export class TieredCache {
  private readonly memory: LRUCache<string, CacheEntry>;
  private readonly store?: PersistentStore;
  private readonly now: () => number;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: CacheOptions = {}) {
    this.memory = new LRUCache({ max: options.maxEntries ?? 500 });
    if (options.store) this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const existing = await this.lookup(key);
    if (existing && existing.expiresAt > this.now()) {
      return { value: existing.value as T, cached: true, stale: false };
    }

    const pending = this.inflight.get(key) as Promise<T> | undefined;
    if (pending) {
      const value = await pending;
      return { value, cached: true, stale: false };
    }

    const load = loader();
    this.inflight.set(key, load);
    try {
      const value = await load;
      const now = this.now();
      const entry: CacheEntry = { value, expiresAt: now + ttlMs, storedAt: now };
      this.memory.set(key, entry);
      if (this.store) {
        await this.store.set(key, entry).catch(() => undefined);
      }
      return { value, cached: false, stale: false };
    } catch (error) {
      if (existing) {
        return { value: existing.value as T, cached: true, stale: true };
      }
      throw error;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async lookup(key: string): Promise<CacheEntry | undefined> {
    const hit = this.memory.get(key);
    if (hit) return hit;
    if (!this.store) return undefined;
    const persisted = await this.store.get(key).catch(() => undefined);
    if (persisted) this.memory.set(key, persisted);
    return persisted;
  }
}
