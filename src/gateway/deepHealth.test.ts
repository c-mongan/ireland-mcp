import { describe, expect, it } from "vitest";
import { sourceModules } from "../registry.js";
import { DeepHealth, defaultProbes, type Probe } from "./deepHealth.js";
import { fakeFetch } from "../../test/helpers/fakeFetch.js";

const probes: Probe[] = [
  { source: "a", url: "https://a.example/ok" },
  { source: "b", url: "https://b.example/fail" },
  { source: "c", url: "", skip: "NTA_API_KEY not set" }
];

describe("DeepHealth", () => {
  it("probes every source once in parallel and reports status and latency", async () => {
    const fetch = fakeFetch([
      { match: /ok/, body: "fine" },
      { match: /fail/, status: 503 }
    ]);
    const health = new DeepHealth({ probes, fetch, now: () => 0 });
    const report = await health.check();
    expect(report.status).toBe("degraded");
    expect(report.cached).toBe(false);
    expect(report.sources).toEqual([
      expect.objectContaining({ source: "a", status: "up", httpStatus: 200 }),
      expect.objectContaining({ source: "b", status: "down", httpStatus: 503, error: "HTTP 503" }),
      expect.objectContaining({ source: "c", status: "skipped", error: "NTA_API_KEY not set" })
    ]);
    expect(report.sources.every((s) => typeof s.latencyMs === "number")).toBe(true);
    // The 503 is retried once before being reported down.
    expect(fetch.calls).toHaveLength(3);
  });

  it("keeps refused provider access degraded but excludes missing credentials", async () => {
    const report = await new DeepHealth({ probes, fetch: fakeFetch([
      { match: /ok/, body: "fine" }, { match: /fail/, status: 403 }
    ]) }).check();
    expect(report.status).toBe("degraded");
    expect(report.sources[1]).toMatchObject({ status: "down", httpStatus: 403 });
    const healthy = await new DeepHealth({ probes, fetch: fakeFetch([{ match: () => true }]) }).check();
    expect(healthy.status).toBe("ok");
    expect(healthy.sources[2]).toMatchObject({ status: "skipped" });
    expect(defaultProbes({}).find((p) => p.source === "met-eireann")?.url).toBe("https://prodapi.met.ie/v2/warnings/");
  });

  it("retries a transient failure once, but not a 4xx", async () => {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response(null, { status: 502 }) : new Response("ok"))) as never;
    const report = await new DeepHealth({ probes: probes.slice(0, 1), fetch: flaky }).check();
    expect(report.sources[0]).toMatchObject({ status: "up", httpStatus: 200 });
    expect(calls).toBe(2);
    const refused = fakeFetch([{ match: () => true, status: 403 }]);
    await new DeepHealth({ probes: probes.slice(0, 1), fetch: refused }).check();
    expect(refused.calls).toHaveLength(1);
  });

  it("reports Kohesio from its packaged snapshot without a network call", async () => {
    const fetch = fakeFetch([{ match: () => true, status: 403 }]);
    const kohesio = defaultProbes({}).filter((p) => p.source === "kohesio");
    const report = await new DeepHealth({ probes: kohesio, fetch }).check();
    expect(report.sources[0]).toMatchObject({ source: "kohesio", status: "up", note: expect.stringMatching(/^packaged snapshot retrieved \d{4}-\d{2}-\d{2}$/) });
    expect(fetch.calls).toHaveLength(0);
    const broken = await new DeepHealth({ probes: [{ source: "x", url: "", local: () => ({ ok: false, error: "snapshot unreadable" }) }] }).check();
    expect(broken.sources[0]).toMatchObject({ status: "down", error: "snapshot unreadable" });
  });

  it("caches the report for 60 seconds so it cannot amplify traffic", async () => {
    let now = 0;
    const fetch = fakeFetch([{ match: () => true }]);
    const health = new DeepHealth({ probes: probes.slice(0, 1), fetch, now: () => now });
    await health.check();
    now = 59_000;
    const again = await health.check();
    expect(again.cached).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    now = 60_001;
    expect((await health.check()).cached).toBe(false);
    expect(fetch.calls).toHaveLength(2);
  });

  it("shares one in-flight run between concurrent callers", async () => {
    const fetch = fakeFetch([{ match: () => true }]);
    const health = new DeepHealth({ probes: probes.slice(0, 1), fetch, now: () => 0 });
    await Promise.all([health.check(), health.check(), health.check()]);
    expect(fetch.calls).toHaveLength(1);
  });

  it("marks a probe down when it exceeds the timeout", async () => {
    const hang = Object.assign(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      { calls: [] }
    );
    const health = new DeepHealth({ probes: probes.slice(0, 1), fetch: hang, timeoutMs: 20 });
    const report = await health.check();
    expect(report.status).toBe("down");
    expect(report.sources[0]).toMatchObject({ status: "down", error: "timeout" });
  });

  it("has a probe for every registered source", () => {
    const covered = new Set(defaultProbes({}).map((p) => p.source));
    for (const module of sourceModules) expect(covered.has(module.info.id), module.info.id).toBe(true);
    expect(defaultProbes({}).find((p) => p.source === "world-bank")?.url).toContain("data360api.worldbank.org");
    expect(defaultProbes({}).find((p) => p.source === "nta")?.skip).toBeTruthy();
    expect(defaultProbes({ NTA_API_KEY: "k" }).find((p) => p.source === "nta")?.skip).toBeUndefined();
  });
});
