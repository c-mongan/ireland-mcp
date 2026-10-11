import type { CoreService, Repository, CoreTool } from './types.mjs';
export const TOOLS: CoreTool[];
export function createService(repository: Repository, options?: { now?: () => string }): CoreService;
export function validateArguments(definition: CoreTool, args: unknown): void;
