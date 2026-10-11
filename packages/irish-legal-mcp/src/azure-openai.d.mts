import type { Generator } from './types.mjs';
export function createAzureGenerator(options: { endpoint: string; deployment: string; apiKey?: string; getToken?: () => Promise<string>; apiVersion?: string }): Generator;
