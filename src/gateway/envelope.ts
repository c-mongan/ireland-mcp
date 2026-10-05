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
