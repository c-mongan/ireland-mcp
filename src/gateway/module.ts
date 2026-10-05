import type { z } from "zod";
import type { TieredCache, CacheResult } from "./cache.js";
import type { Envelope, SourceInfo } from "./envelope.js";
import type { HttpClient, HttpOptions } from "./http.js";

export interface CachedJsonOptions<T> extends HttpOptions {
  cacheKey?: string;
  validate?: (value: T) => void;
}

export interface ToolContext {
  http: HttpClient;
  cache: TieredCache;
  env: Record<string, string | undefined>;
  now: () => Date;
  /**
   * Fetches JSON through the cache with stale fallback. `validate` runs before caching and
   * should throw a ToolError for error bodies sent with HTTP 200, so they are never cached.
   */
  cachedJson<T>(url: string, ttlMs: number, options?: CachedJsonOptions<T>): Promise<CacheResult<T>>;
  /** Fetches text through the cache with stale fallback. */
  cachedText(url: string, ttlMs: number, options?: HttpOptions & { cacheKey?: string }): Promise<CacheResult<string>>;
}

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  /**
   * When true the handler result is returned verbatim instead of as an evidence envelope.
   * Used only by the ChatGPT search/fetch contract tools.
   */
  raw?: boolean;
  /** Also listed as a top-level tool in the default lean surface. Keep pinned tools small (<300 tokens). */
  pinned?: boolean;
  /** Example arguments shown by ireland_describe. Derived from the schema when omitted. */
  example?: Record<string, unknown>;
  handler(args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext): Promise<Envelope | unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDefinition<any>;

export function defineTool<Shape extends z.ZodRawShape>(tool: ToolDefinition<Shape>): AnyTool {
  return tool as AnyTool;
}

export interface SearchHit {
  /** "<source>:<key>" */
  id: string;
  title: string;
  url: string;
}

export interface FetchedDocument {
  id: string;
  title: string;
  text: string;
  url: string;
  metadata: Record<string, unknown>;
}

/** Catalogue domains, in display order. */
export const DOMAINS = ["stats", "transport", "environment", "energy", "law/politics", "places/property"] as const;
export type Domain = (typeof DOMAINS)[number];

export interface SourceModule {
  info: SourceInfo;
  /** One-line description used by list_sources and ireland_catalogue. */
  summary: string;
  /** Catalogue group for ireland_catalogue. Every registered source must set one. */
  domain?: Domain;
  /** What the source covers (time span, geography, freshness). Shown in the ireland://sources/{id} resource. */
  coverage?: string;
  /** Each tool is also an ireland_call operation of this source, keyed by its tool name. */
  tools: AnyTool[];
  /** Participates in the cross-source `search` tool. */
  search?(query: string, limit: number, ctx: ToolContext): Promise<SearchHit[]>;
  /** Resolves the key part of a "<source>:<key>" id for the `fetch` tool. */
  fetchById?(key: string, ctx: ToolContext): Promise<FetchedDocument>;
}
