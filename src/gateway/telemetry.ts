import { capturePostHog } from "./posthog.js";
import { currentChannel, currentSynthetic, type Channel } from "./requestScope.js";

export interface ToolCallEvent {
  tool: string;
  source: string;
  durationMs: number;
  outcome: "ok" | "error";
  errorCode?: string;
  cached?: boolean;
  stale?: boolean;
  /** Set from the request scope, never from tool input. */
  synthetic?: boolean;
  channel?: Channel;
}

export type TelemetrySink = (event: ToolCallEvent) => void;

/**
 * Emits one structured line per tool call. On Azure Functions the host forwards
 * console output to Application Insights. Arguments are not logged.
 */
export const consoleSink: TelemetrySink = (event) => {
  if (process.env.IRELAND_MCP_TELEMETRY === "off") return;
  const scoped = { ...event, synthetic: currentSynthetic(), channel: currentChannel() };
  console.error(JSON.stringify({ type: "tool_call", ...scoped }));
  capturePostHog(scoped);
};

export const noopSink: TelemetrySink = () => undefined;

/** Report caught HTTP failures without exception messages, custom names, or request data. */
export function reportHandlerError(handler: "healthResponse" | "mcpHandler" | "handleMcpHttp", error: unknown): void {
  if (process.env.IRELAND_MCP_TELEMETRY === "off") return;
  let errorType = "_OTHER";
  if (error instanceof Error) errorType = "Error";
  if (error instanceof TypeError) errorType = "TypeError";
  if (error instanceof SyntaxError) errorType = "SyntaxError";
  if (error instanceof RangeError) errorType = "RangeError";
  console.error(JSON.stringify({ type: "handler_error", handler, errorType }));
}

export type SearchOutcome = "ok" | "failed" | "timeout";

/** One line when the combined search returns partial results. Source ids only; never the query. */
export function reportSearchOutcomes(outcomes: Record<string, SearchOutcome>): void {
  if (process.env.IRELAND_MCP_TELEMETRY === "off") return;
  const values = Object.values(outcomes);
  const count = (o: SearchOutcome) => values.filter((v) => v === o).length;
  if (count("ok") === values.length) return;
  console.error(JSON.stringify({ type: "search_sources", ok: count("ok"), failed: count("failed"), timeout: count("timeout"), outcomes }));
}
