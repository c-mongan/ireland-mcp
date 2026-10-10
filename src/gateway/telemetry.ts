import { capturePostHog } from "./posthog.js";

export interface ToolCallEvent {
  tool: string;
  source: string;
  durationMs: number;
  outcome: "ok" | "error";
  errorCode?: string;
  cached?: boolean;
  stale?: boolean;
}

export type TelemetrySink = (event: ToolCallEvent) => void;

/**
 * Emits one structured line per tool call. On Azure Functions the host forwards
 * console output to Application Insights. Arguments are not logged.
 */
export const consoleSink: TelemetrySink = (event) => {
  if (process.env.IRELAND_MCP_TELEMETRY === "off") return;
  console.error(JSON.stringify({ type: "tool_call", ...event }));
  capturePostHog(event);
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
