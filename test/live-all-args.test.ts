import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Operational script has no generated declaration file.
import { DEPLOYED_URL, isHostedTarget, parseArgs, reportPathFor } from "../scripts/live-all-args.mjs";

const argv = (...args: string[]) => ["node", "live-all-ops.mjs", ...args];
const DEFAULT_REPORT = "/repo/docs/live-all-ops.md";

describe("live:all arguments", () => {
  it("targets the custom domain that the hosted receipt names", () => {
    expect(DEPLOYED_URL).toBe("https://mcp.irishopendata.ie/mcp");
    expect(parseArgs(argv("--deployed")).url).toBe(DEPLOYED_URL);
    expect(parseArgs(argv("--url", "https://example.test/mcp")).url).toBe("https://example.test/mcp");
    expect(parseArgs(argv("--url=https://example.test/mcp")).url).toBe("https://example.test/mcp");
  });

  it.each([["--url"], ["--url="], ["--url", "--json"], ["--url", ""], ["--url", "not a url"]])("rejects %j instead of silently using another host", (...args) => {
    expect(() => parseArgs(argv(...args))).toThrow(/--url/);
  });

  it("writes the checked-in receipt only for a hosted run, unless --report is given", () => {
    expect(reportPathFor(parseArgs(argv()), DEFAULT_REPORT)).toBeNull();
    expect(reportPathFor(parseArgs(argv("--url", "http://localhost:7071/mcp")), DEFAULT_REPORT)).toBeNull();
    expect(reportPathFor(parseArgs(argv("--deployed")), DEFAULT_REPORT)).toBe(DEFAULT_REPORT);
    expect(reportPathFor(parseArgs(argv("--url", "https://mcp.irishopendata.ie/mcp/")), DEFAULT_REPORT)).toBe(DEFAULT_REPORT);
    expect(reportPathFor(parseArgs(argv("--report", "out/local.md")), DEFAULT_REPORT)).toBe(resolve("out/local.md"));
  });

  it("recognises only the canonical hosted endpoint", () => {
    expect(isHostedTarget("https://mcp.irishopendata.ie/mcp")).toBe(true);
    expect(isHostedTarget("https://MCP.irishopendata.ie/mcp/")).toBe(true);
    expect(isHostedTarget("https://func-ireland-mcp-example.azurewebsites.net/mcp")).toBe(false);
    expect(isHostedTarget(null)).toBe(false);
  });
});
