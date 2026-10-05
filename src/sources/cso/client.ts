import { ToolError } from "../../gateway/errors.js";
import type { ToolContext } from "../../gateway/module.js";
import { DAY } from "../../gateway/context.js";
import { assertJsonStat, type JsonStat } from "./jsonStat.js";

export const CSO_RPC = "https://ws.cso.ie/public/api.jsonrpc";
export const CSO_REST = "https://ws.cso.ie/public/api.restful";
export const CSO_TTL = DAY;
export const MAX_CELLS = 10_000;

export function tableUrl(code: string): string {
  return `https://data.cso.ie/table/${encodeURIComponent(code)}`;
}

export function metadataUrl(code: string): string {
  return `${CSO_REST}/PxStat.Data.Cube_API.ReadMetadata/${encodeURIComponent(code)}/en`;
}

/** CSO table codes are short upper-case alphanumerics with at least one letter and one digit. */
export function normaliseTableCode(input: string): string {
  const code = input.trim().toUpperCase().match(/^([A-Z0-9]+)/)?.[1] ?? "";
  if (!code || code.length > 12 || !/[A-Z]/.test(code) || !/\d/.test(code)) {
    throw new ToolError("BAD_ARGS", `"${input}" is not a CSO table code.`, {
      hint: "Table codes look like F1001 or HPM09. Use cso_search_tables to find one."
    });
  }
  return code;
}

export interface CsoSearchResult {
  MtrCode: string;
  MtrTitle: string;
  ThmValue?: string;
  SbjValue?: string;
  CprValue?: string;
  RlsLiveDatetimeFrom?: string;
  classification?: Array<{ ClsCode: string; ClsValue: string }>;
}

interface RpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

const CLIENT_RPC_ERRORS = new Set([-32600, -32601, -32602]);

/** Runs before caching so JSON-RPC errors are never cached. Only request errors blame the caller. */
function assertRpcOk(response: RpcResponse<unknown>): void {
  if (response.error) {
    if (CLIENT_RPC_ERRORS.has(response.error.code ?? 0)) {
      throw new ToolError("BAD_ARGS", "CSO PxStat rejected the query.", {
        hint: "Check the table code and dimension codes with cso_get_table_metadata."
      });
    }
    throw new ToolError("UPSTREAM_DOWN", "CSO PxStat returned an error.");
  }
  if (response.result === undefined) throw new ToolError("UPSTREAM_DOWN", "CSO PxStat returned no result.");
}

async function rpc<T>(ctx: ToolContext, method: string, params: unknown): Promise<{ value: T; cached: boolean; stale: boolean }> {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  const result = await ctx.cachedJson<RpcResponse<T>>(CSO_RPC, CSO_TTL, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
    label: "CSO PxStat",
    validate: assertRpcOk
  });
  return { value: result.value.result as T, cached: result.cached, stale: result.stale };
}

export function searchTables(ctx: ToolContext, query: string) {
  return rpc<CsoSearchResult[]>(ctx, "PxStat.System.Navigation.Navigation_API.Search", {
    Search: query,
    LngIsoCode: "en"
  });
}

export async function readMetadata(ctx: ToolContext, code: string) {
  const result = await ctx.cachedJson<unknown>(metadataUrl(code), CSO_TTL, {
    label: "CSO PxStat",
    validate: (value) => void assertJsonStat(value)
  });
  return { ...result, value: result.value as JsonStat };
}

export async function readDataset(ctx: ToolContext, code: string, filters: Record<string, string[]>) {
  const result = await rpc<unknown>(ctx, "PxStat.Data.Cube_API.ReadDataset", {
    class: "query",
    id: Object.keys(filters),
    dimension: Object.fromEntries(Object.entries(filters).map(([dim, codes]) => [dim, { category: { index: codes } }])),
    extension: {
      pivot: null,
      codes: false,
      language: { code: "en" },
      format: { type: "JSON-stat", version: "2.0" },
      matrix: code
    },
    version: "2.0"
  });
  return { ...result, value: assertJsonStat(result.value) as JsonStat };
}
