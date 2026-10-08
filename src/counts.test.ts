import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectClient } from "../test/helpers/mcpClient.js";
import { COUNTS_START, computeCounts, HOSTED_LIMITS, liveOpsSummary, PROMPTS, renderCounts } from "./counts.js";
import { createContext } from "./gateway/context.js";
import { createAppServer, sourceModules } from "./registry.js";

const read = (p: string) => readFileSync(p, "utf8");
const counts = computeCounts();
const livePass = Number(/Operations: (\d+) PASS/.exec(read("docs/live-all-ops.md"))?.[1]);
const noFetch = (() => Promise.reject(new Error("no network in tests"))) as typeof fetch;

describe("published counts (single source of truth: src/counts.ts)", () => {
  it("match what a real client sees", async () => {
    const def = await connectClient(createAppServer(createContext({ fetch: noFetch })));
    const all = await connectClient(createAppServer(createContext({ fetch: noFetch }), undefined, "all"));
    expect((await def.listTools()).tools).toHaveLength(counts.default_tools);
    expect((await all.listTools()).tools).toHaveLength(counts.all_tools);
    expect((await def.listPrompts()).prompts.map((p) => p.name).sort()).toEqual([...PROMPTS].sort());
    for (const id of Object.keys(HOSTED_LIMITS)) expect(sourceModules.some((m) => m.info.id === id)).toBe(true);
  });

  it("are up to date in docs/counts.json, web/counts.json and the README (run `npm run counts`)", () => {
    expect(JSON.parse(read("docs/counts.json"))).toEqual(counts);
    expect(JSON.parse(read("web/counts.json"))).toEqual(counts);
    const readme = read("README.md");
    expect(readme).toContain(renderCounts(counts));
    expect(readme.indexOf(COUNTS_START)).toBe(readme.lastIndexOf(COUNTS_START));
    expect(readme).toContain(`<!-- live-ops:start -->${liveOpsSummary(read("docs/live-all-ops.md"))}<!-- live-ops:end -->`);
    const html = read("web/index.html");
    expect(html).toContain(`<dd id="stat-sources">${counts.sources}</dd>`);
    expect(html).toContain(`<dd id="stat-ops">${counts.default_tools}</dd>`);
  });

  it("are not contradicted by hand-written numbers in the docs", () => {
    const files = ["README.md", "web/index.html", "web/llms.txt", "web/AGENTS.md", "web/.well-known/mcp.json", "web/.well-known/mcp/server-card.json", "docs/demo/README.md", "server.json"];
    const checks: Array<[RegExp, number[]]> = [
      [/\b(\d+) of (\d+) (?:data )?sources\b/gi, [counts.hosted_working, counts.sources]],
      [/\b(\d+) (?:public[- ]data |data |Irish public-data )?sources\b/gi, [counts.sources]],
      [/\b(\d+) (?:default |typed )?tools\b/gi, [counts.default_tools, counts.all_tools]],
      [/\b(\d+) (?:catalogue )?operations\b/gi, [counts.operations, counts.source_operations, counts.cross_operations, livePass]]
    ];
    const problems: string[] = [];
    for (const file of files) {
      for (const [n, line] of read(file).split("\n").entries()) {
        if (/at the time|<!-- (counts|live-ops):/i.test(line)) continue;
        for (const [re, allowed] of checks) {
          for (const m of line.matchAll(re)) {
            const nums = m.slice(1).map(Number);
            const ok = nums.length === 2 ? nums[0] === allowed[0] && nums[1] === allowed[1] : allowed.includes(nums[0]!);
            if (!ok) problems.push(`${file}:${n + 1}: "${m[0]}"`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("liveOpsSummary", () => {
  const report = (ops: string) => `Generated: 2026-10-08T12:00:00Z\nOperations: ${ops}\n`;

  it("parses reports written before the DEGRADED field existed", () => {
    expect(liveOpsSummary(report("72 PASS, 2 NOT_CONFIGURED, 0 HOSTED_BLOCKED, 0 FAIL."))).toBe(
      "[docs/live-all-ops.md](docs/live-all-ops.md) (2026-10-08): 72 of 74 pass, 0 fail; 2 need the NTA key."
    );
  });

  it("parses the current format and counts degraded operations", () => {
    expect(liveOpsSummary(report("70 PASS, 2 NOT_CONFIGURED, 0 HOSTED_BLOCKED, 0 DEGRADED, 2 FAIL."))).toBe(
      "[docs/live-all-ops.md](docs/live-all-ops.md) (2026-10-08): 70 of 74 pass, 2 fail; 2 need the NTA key."
    );
    expect(liveOpsSummary(report("70 PASS, 2 NOT_CONFIGURED, 1 HOSTED_BLOCKED, 1 DEGRADED, 0 FAIL."))).toBe(
      "[docs/live-all-ops.md](docs/live-all-ops.md) (2026-10-08): 70 of 74 pass, 0 fail; 2 need the NTA key, 1 blocked from Azure IPs, 1 degraded (stale or partial)."
    );
  });
});
