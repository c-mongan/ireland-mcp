import type { z } from "zod";
import type { TieredCache, CacheResult } from "./cache.js";
import type { Envelope, SourceInfo } from "./envelope.js";
import type { HttpClient, HttpOptions } from "./http.js";

export interface ToolContext {
  http: HttpClient;
  cache: TieredCache;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** Fetches JSON through the cache with stale fallback. */
  cachedJson<T>(url: string, ttlMs: number, options?: HttpOptions & { cacheKey?: string }): Promise<CacheResult<T>>;
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

export interface SourceModule {
  info: SourceInfo;
  /** One-line description used by list_sources. */
  summary: string;
  tools: AnyTool[];
  /** Participates in the cross-source `search` tool. */
  search?(query: string, limit: number, ctx: ToolContext): Promise<SearchHit[]>;
  /** Resolves the key part of a "<source>:<key>" id for the `fetch` tool. */
  fetchById?(key: string, ctx: ToolContext): Promise<FetchedDocument>;
}
