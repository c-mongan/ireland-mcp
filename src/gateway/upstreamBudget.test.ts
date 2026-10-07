import { describe, expect, it } from "vitest";
import { createContext } from "./context.js";
import { ToolError } from "./errors.js";
import { HttpClient } from "./http.js";
import { budgetConfigFromEnv, CircuitBreaker, sourceForUrl, UpstreamBudgets } from "./upstreamBudget.js";
import { fakeFetch } from "../../test/helpers/fakeFetch.js";

const down = () => Promise.reject(new ToolError("UPSTREAM_DOWN", "boom"));

describe("CircuitBreaker", () => {
  it("opens after N consecutive failures and reports a retry-after hint", () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 30_000, () => now);
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.state()).toBe("closed");
    breaker.onFailure();
    expect(breaker.state()).toBe("open");
    now = 10_000;
    expect(breaker.tryPass()).toEqual({ allowed: false, retryAfterSeconds: 20 });
  });

  it("resets the failure count on success", () => {
    const breaker = new CircuitBreaker(2, 1000, () => 0);
    breaker.onFailure();
    breaker.onSuccess();
    breaker.onFailure();
    expect(breaker.state()).toBe("closed");
  });

  it("lets a single trial through after the cooldown and closes on success", () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 5000, () => now);
    breaker.onFailure();
    now = 5000;
    expect(breaker.tryPass().allowed).toBe(true);
    expect(breaker.state()).toBe("half_open");
    expect(breaker.tryPass().allowed).toBe(false);
    breaker.onSuccess();
    expect(breaker.state()).toBe("closed");
  });

  it("re-opens for a full cooldown when the trial fails", () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 5000, () => now);
    breaker.onFailure();
    now = 6000;
    breaker.tryPass();
    breaker.onFailure();
    expect(breaker.state()).toBe("open");
    expect(breaker.tryPass()).toEqual({ allowed: false, retryAfterSeconds: 5 });
  });
});

describe("UpstreamBudgets", () => {
  it("fails fast with UPSTREAM_DOWN while the source's breaker is open", async () => {
    const budgets = new UpstreamBudgets({ failureThreshold: 2, cooldownMs: 30_000 }, () => 0);
    await expect(budgets.run("cso", down)).rejects.toThrow("boom");
    await expect(budgets.run("cso", down)).rejects.toThrow("boom");
    let called = false;
    const error = await budgets
      .run("cso", async () => {
        called = true;
        return 1;
      })
      .catch((e: unknown) => e);
    expect(called).toBe(false);
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("UPSTREAM_DOWN");
    expect((error as ToolError).retryAfterSeconds).toBe(30);
    expect(await budgets.run("met-eireann", async () => "ok")).toBe("ok");
    expect(budgets.snapshot().cso).toMatchObject({ state: "open" });
  });

  it("does not count caller errors such as NOT_FOUND or BAD_ARGS as failures", async () => {
    const budgets = new UpstreamBudgets({ failureThreshold: 1 }, () => 0);
    await expect(budgets.run("cso", () => Promise.reject(new ToolError("NOT_FOUND", "nope")))).rejects.toThrow("nope");
    await expect(budgets.run("cso", () => Promise.reject(new ToolError("BAD_ARGS", "bad")))).rejects.toThrow("bad");
    expect(budgets.snapshot().cso).toMatchObject({ state: "closed" });
  });

  it("limits concurrent calls per source and queues the rest", async () => {
    const budgets = new UpstreamBudgets({ concurrency: 2, maxQueue: 5 });
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const job = () =>
      budgets.run("luas", async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      });
    const jobs = [job(), job(), job(), job()];
    await new Promise((r) => setTimeout(r, 5));
    expect(active).toBe(2);
    while (releases.length) {
      releases.shift()!();
      await new Promise((r) => setTimeout(r, 5));
    }
    await Promise.all(jobs);
    expect(peak).toBe(2);
  });

  it("rejects quickly when the per-source queue is full", async () => {
    const budgets = new UpstreamBudgets({ concurrency: 1, maxQueue: 1 });
    let release!: () => void;
    const first = budgets.run("ppr", () => new Promise<void>((r) => (release = r)));
    const second = budgets.run("ppr", async () => undefined);
    const error = await budgets.run("ppr", async () => undefined).catch((e: unknown) => e);
    expect((error as ToolError).code).toBe("UPSTREAM_DOWN");
    expect((error as ToolError).retryAfterSeconds).toBeGreaterThan(0);
    release();
    await Promise.all([first, second]);
  });

  it("passes the per-source timeout to the call", async () => {
    const budgets = new UpstreamBudgets({ timeoutMs: 1234 });
    expect(await budgets.run("cso", async (timeoutMs) => timeoutMs)).toBe(1234);
  });

  it("reads its configuration from the environment with safe fallbacks", () => {
    expect(
      budgetConfigFromEnv({
        UPSTREAM_CONCURRENCY: "4",
        UPSTREAM_TIMEOUT_MS: "8000",
        UPSTREAM_BREAKER_FAILURES: "3",
        UPSTREAM_BREAKER_COOLDOWN_SECONDS: "45",
        UPSTREAM_MAX_QUEUE: "x"
      })
    ).toEqual({ concurrency: 4, timeoutMs: 8000, failureThreshold: 3, cooldownMs: 45_000, maxQueue: 32 });
  });
});

describe("sourceForUrl", () => {
  it("maps upstream hosts to source ids", () => {
    expect(sourceForUrl("https://ws.cso.ie/public/api.jsonrpc")).toBe("cso");
    expect(sourceForUrl("https://api.oireachtas.ie/v1/legislation")).toBe("oireachtas");
    expect(sourceForUrl("https://services-eu1.arcgis.com/x")).toBe("geohive");
    expect(sourceForUrl("http://openaccess.pf.api.met.ie/metno")).toBe("met-eireann");
    expect(sourceForUrl("https://prodapi.met.ie/v2/warnings/")).toBe("met-eireann");
    expect(sourceForUrl("https://luasforecasts.rpa.ie/xml/get.ashx")).toBe("luas");
    expect(sourceForUrl("https://unknown.example.org/a")).toBe("unknown.example.org");
    expect(sourceForUrl("https://opendata.ncse.ie/api/test")).toBe("ncse");
    expect(sourceForUrl("not a url")).toBe("upstream");
  });
});

describe("HttpClient with budgets", () => {
  it("stops calling a failing upstream once the breaker opens", async () => {
    const fetch = fakeFetch([{ match: /cso/, status: 503 }]);
    const http = new HttpClient(fetch, new UpstreamBudgets({ failureThreshold: 2, cooldownMs: 60_000 }));
    for (let i = 0; i < 4; i += 1) {
      await expect(http.text("https://ws.cso.ie/x", { retries: 0 })).rejects.toBeInstanceOf(ToolError);
    }
    expect(fetch.calls).toHaveLength(2);
  });

  it("serves the stale cached copy while the breaker is open", async () => {
    let now = 0;
    let status = 200;
    const fetch = fakeFetch([{ match: () => true }]);
    const impl = Object.assign(
      async (url: string, init?: RequestInit) => {
        await fetch(url, init);
        return new Response('{"v":1}', { status });
      },
      { calls: fetch.calls }
    );
    const ctx = createContext({
      fetch: impl,
      now: () => new Date(now),
      budgets: new UpstreamBudgets({ failureThreshold: 1, cooldownMs: 60_000 }, () => now)
    });
    expect((await ctx.cachedJson("https://ws.cso.ie/a", 1000)).value).toEqual({ v: 1 });
    status = 503;
    now = 2000;
    expect(await ctx.cachedJson("https://ws.cso.ie/a", 1000, { retries: 0 })).toMatchObject({ stale: true });
    const callsBefore = fetch.calls.length;
    expect(await ctx.cachedJson("https://ws.cso.ie/a", 1000)).toMatchObject({ value: { v: 1 }, stale: true });
    expect(fetch.calls.length).toBe(callsBefore);
  });
});
