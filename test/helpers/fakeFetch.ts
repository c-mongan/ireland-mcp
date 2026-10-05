import { readFileSync } from "node:fs";
import type { FetchLike } from "../../src/gateway/http.js";

export interface Route {
  match: RegExp | ((url: string, init?: RequestInit) => boolean);
  status?: number;
  body?: string | Uint8Array;
  file?: string;
  headers?: Record<string, string>;
}

export interface FakeFetch extends FetchLike {
  calls: Array<{ url: string; init?: RequestInit }>;
}

/** Routes requests to recorded fixtures. Unmatched URLs fail loudly so tests never reach the network. */
export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const route = routes.find((r) => (typeof r.match === "function" ? r.match(url, init) : r.match.test(url)));
    if (!route) throw new Error(`Unexpected network call in test: ${url}`);
    const body = route.file ? readFileSync(route.file) : (route.body ?? "");
    return new Response(body as BodyInit, { status: route.status ?? 200, headers: route.headers ?? {} });
  }) as FakeFetch;
  impl.calls = calls;
  return impl;
}

export function fixture(dir: string, name: string): string {
  return new URL(`${name}`, `file://${dir.endsWith("/") ? dir : `${dir}/`}`).pathname;
}

export function parseToolText<T = unknown>(result: { content: Array<{ type: string; text?: string }> }): T {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") throw new Error("No text content");
  return JSON.parse(first.text) as T;
}
