import { fileURLToPath } from "node:url";
import { createContext } from "../../src/gateway/context.js";
import type { SourceModule, ToolContext } from "../../src/gateway/module.js";
import { runTool } from "../../src/gateway/server.js";
import { parseToolText } from "./fakeFetch.js";
import type { FetchLike } from "../../src/gateway/http.js";

export interface ToolCallOutcome<T> {
  ok: boolean;
  body: T;
}

export async function callTool<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
  module: SourceModule,
  name: string,
  args: unknown,
  contextOrFetch: ToolContext | FetchLike,
  env: Record<string, string | undefined> = {}
): Promise<ToolCallOutcome<T>> {
  const tool = module.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  const ctx = typeof contextOrFetch === "function" ? createContext({ fetch: contextOrFetch, env }) : contextOrFetch;
  const result = await runTool(tool, module.info.id, args, ctx);
  return { ok: !result.isError, body: parseToolText<T>(result) };
}

export function fixturePath(metaUrl: string, name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, metaUrl));
}
