import type { CoreDocument } from './types.mjs';
export function parseSource(input: { source: string; url: string; body: string; fetchedAt: string }): CoreDocument[];
