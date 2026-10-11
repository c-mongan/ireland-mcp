import type { CoreService, Generator } from './types.mjs';
export function createWebHandler(service: CoreService, options?: { bearerToken?: string; allowedOrigins?: string[]; requestsPerMinute?: number; generate?: Generator }): (request: Request, context?: { clientAddress?: string }) => Promise<Response>;
