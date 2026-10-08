import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleSink, noopSink, reportHandlerError } from "./telemetry.js";

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
    reportHandlerError("mcpHandler", new Error("private detail"));
    expect(noopSink(event)).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    { error: new Error("private message with https://private.example?secret=1"), errorType: "Error" },
    { error: new TypeError("private argument value"), errorType: "TypeError" },
    { error: new SyntaxError("private request body"), errorType: "SyntaxError" },
    { error: new RangeError("private header"), errorType: "RangeError" },
    { error: { name: "private type", message: "private object", headers: { authorization: "private token" } }, errorType: "_OTHER" }
  ])("reports only bounded handler/error labels as $errorType", ({ error, errorType }) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    if (error instanceof Error) error.name = "private custom error name";
    reportHandlerError("mcpHandler", error);
    expect(spy).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "handler_error", handler: "mcpHandler", errorType }));
    expect(JSON.stringify(spy.mock.calls)).not.toContain("private");
  });
});
