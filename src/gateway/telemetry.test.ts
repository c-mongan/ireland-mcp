import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleSink, noopSink } from "./telemetry.js";

const event = { tool: "list_sources", source: "cross", durationMs: 3, outcome: "ok" as const };

describe("telemetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.IRELAND_MCP_TELEMETRY;
  });

  it("writes one JSON line to stderr without arguments", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    consoleSink(event);
    expect(spy).toHaveBeenCalledOnce();
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toEqual({ type: "tool_call", ...event });
  });

  it("is silenced by IRELAND_MCP_TELEMETRY=off, and noopSink does nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.IRELAND_MCP_TELEMETRY = "off";
    consoleSink(event);
    expect(noopSink(event)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
