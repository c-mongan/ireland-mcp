import { describe, expect, it } from "vitest";

type Transform = (output: unknown) => string;
// Plain .mjs so promptfoo can load it directly; typed loosely here.
const load = async (): Promise<Transform> => ((await import(new URL("../evals/tool-calls.mjs", import.meta.url).href)) as { default: Transform }).default;

describe("eval tool-call transform", () => {
  it("lists typed tools called directly and operations dispatched through ireland_call", async () => {
    const toolCalls = await load();
    const output = [
      'MCP Tool Result (ireland_catalogue): {"domains":[{"sources":[{"operations":["cso_get_data","rail_get_departures"]}]}]}',
      'MCP Tool Result (ireland_call): {"operation":"cso_area_profile","data":{}}',
      'MCP Tool Error (ireland_call): {"operation":"ppr_search_sales","error":{"code":"BAD_ARGS"}}',
      'MCP Tool Result (luas_get_forecast): {"data":{}}'
    ].join("\n");
    const called = toolCalls(output);
    expect(called.split(/\s+/)).toEqual(["ireland_catalogue", "ireland_call", "cso_area_profile", "ireland_call", "ppr_search_sales", "luas_get_forecast"]);
    expect(called).not.toContain("rail_get_departures");
  });

  it("passes plain output through when no MCP tool markers are present", async () => {
    const toolCalls = await load();
    expect(toolCalls("I called cso_get_data")).toBe("I called cso_get_data");
    expect(toolCalls({ x: 1 })).toBe('{"x":1}');
  });
});
