import type { Repository } from './types.mjs';
export interface Manifest { seeds: Array<{ source: string; url: string }>; max_pages?: number; sitemaps?: Array<{ source: string; url: string; prefix?: string }> }
export function syncSources(repository: Repository, manifest: Manifest, options?: { fetch?: typeof fetch; now?: () => string; permissions?: Record<string, boolean> }): Promise<{ succeeded: number; failed: number; documents: number; errors: Array<{ source: string; url: string; reason: string }> }>;
