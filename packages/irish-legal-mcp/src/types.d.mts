export interface CoreDocument extends Record<string, unknown> {
  id: string; title: string; text: string; canonical_url: string; source_id: string; source_type: string;
  source_fetched_at: string; source_checked_at: string; licence: string; attribution: string;
  version?: string; warnings: string[];
}
export interface CoreIndex extends Record<string, unknown> { schema: number }
export interface Backend {
  readIndex(): Promise<{ index: CoreIndex; revision: string | null }>;
  writeIndex(index: CoreIndex, revision: string | null): Promise<unknown>;
  writeSnapshot(key: string, text: string): Promise<void>;
  readSnapshot(key: string): Promise<string>;
}
export interface Repository {
  commit(documents: CoreDocument[], raw: string): Promise<Record<string, unknown>>;
  get(id: string, options?: { version?: string; as_of?: string }): Promise<CoreDocument>;
  search(query: string, options?: { limit?: number; source?: string; source_type?: string; as_of?: string }): Promise<{ hits: CoreDocument[]; coverage: Record<string, unknown>; historical_unavailable_count: number }>;
  status(): Promise<Record<string, unknown>>;
  recordSync(completion: { run_id: string; started_at: string; finished_at: string; succeeded: number; failed: number; skipped: number; documents: number }): Promise<void>;
  noteFailure(source: string, url: string, details: { checked_at: string; reason: string }): Promise<void>;
}
export interface SchemaRule { type: string; minLength?: number; maxLength?: number; minimum?: number; maximum?: number; pattern?: string; enum?: string[]; description?: string }
export interface CoreTool { name: string; description: string; inputSchema: { type: string; properties: Record<string, SchemaRule>; required: string[]; additionalProperties: boolean }; annotations: Record<string, boolean> }
export interface CoreService { tools: CoreTool[]; call(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> }
export type Generator = (context: Record<string, unknown>) => Promise<Record<string, unknown>>;
