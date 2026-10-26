import { AsyncLocalStorage } from "node:async_hooks";

/** Header first-party scripts and monitors send so their calls are not counted as real use. */
export const SYNTHETIC_HEADER = "x-ireland-mcp-synthetic";

/** `playground` means a browser on an allowed site origin; anything else is an MCP client. */
export type Channel = "client" | "playground";
interface RequestScope { synthetic: boolean; channel: Channel; }

const storage = new AsyncLocalStorage<RequestScope>();

export function isSyntheticRequest(headers: Headers): boolean {
  return headers.get(SYNTHETIC_HEADER) === "1";
}

/** Runs one HTTP request with its scope so tool-call telemetry can read it without new plumbing. */
export function withRequestScope<T>(scope: RequestScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

/** True only inside a request that declared itself synthetic; stdio and tests are not tagged. */
export function currentSynthetic(): boolean {
  return storage.getStore()?.synthetic === true;
}

export function currentChannel(): Channel {
  return storage.getStore()?.channel ?? "client";
}

/** Only browsers send Origin, and disallowed origins are rejected before this point. */
export function channelOf(headers: Headers): Channel {
  return headers.get("origin") ? "playground" : "client";
}
