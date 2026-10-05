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
};

export const noopSink: TelemetrySink = () => undefined;
