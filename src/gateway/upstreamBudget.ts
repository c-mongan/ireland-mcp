import { ToolError } from "./errors.js";

export type BreakerState = "closed" | "open" | "half_open";

/** Opens after `threshold` consecutive failures; after `cooldownMs` lets one trial call through. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | undefined;
  private trialInFlight = false;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now
  ) {}

  state(): BreakerState {
    if (this.openedAt === undefined) return "closed";
    if (this.trialInFlight) return "half_open";
    return "open";
  }

  tryPass(): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    if (this.openedAt === undefined) return { allowed: true };
    const remaining = this.openedAt + this.cooldownMs - this.now();
    if (remaining > 0) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
    if (this.trialInFlight) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(this.cooldownMs / 1000)) };
    this.trialInFlight = true;
    return { allowed: true };
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = undefined;
    this.trialInFlight = false;
  }

  onFailure(): void {
    this.failures += 1;
    if (this.trialInFlight || this.failures >= this.threshold) {
      this.openedAt = this.now();
      this.trialInFlight = false;
    }
  }

  /** Releases a half-open trial that ended in a caller error (neither success nor upstream failure). */
  onNeutral(): void {
    this.trialInFlight = false;
  }

  consecutiveFailures(): number {
    return this.failures;
  }
}

export interface BudgetConfig {
  concurrency: number;
  timeoutMs: number;
  failureThreshold: number;
  cooldownMs: number;
  maxQueue: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  concurrency: 8,
  timeoutMs: 10_000,
  failureThreshold: 5,
  cooldownMs: 30_000,
  maxQueue: 32
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n > 0 ? n : fallback;
}

export function budgetConfigFromEnv(env: Record<string, string | undefined>): BudgetConfig {
  return {
    concurrency: positiveInt(env.UPSTREAM_CONCURRENCY, DEFAULT_BUDGET.concurrency),
    timeoutMs: positiveInt(env.UPSTREAM_TIMEOUT_MS, DEFAULT_BUDGET.timeoutMs),
    failureThreshold: positiveInt(env.UPSTREAM_BREAKER_FAILURES, DEFAULT_BUDGET.failureThreshold),
    cooldownMs: positiveInt(env.UPSTREAM_BREAKER_COOLDOWN_SECONDS, DEFAULT_BUDGET.cooldownMs / 1000) * 1000,
    maxQueue: positiveInt(env.UPSTREAM_MAX_QUEUE, DEFAULT_BUDGET.maxQueue)
  };
}

class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number
  ) {}

  acquire(): Promise<void> | false {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.maxQueue) return false;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active -= 1;
  }

  load(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiters.length };
  }
}

interface SourceBudget {
  breaker: CircuitBreaker;
  semaphore: Semaphore;
}

export interface SourceSnapshot {
  state: BreakerState;
  consecutiveFailures: number;
  active: number;
  queued: number;
}

/** Per-source concurrency limit, queue bound, timeout and circuit breaker. */
export class UpstreamBudgets {
  readonly config: BudgetConfig;
  private readonly sources = new Map<string, SourceBudget>();

  constructor(
    config: Partial<BudgetConfig> = {},
    private readonly now: () => number = Date.now
  ) {
    this.config = { ...DEFAULT_BUDGET, ...config };
  }

  private budget(source: string): SourceBudget {
    let budget = this.sources.get(source);
    if (!budget) {
      budget = {
        breaker: new CircuitBreaker(this.config.failureThreshold, this.config.cooldownMs, this.now),
        semaphore: new Semaphore(this.config.concurrency, this.config.maxQueue)
      };
      this.sources.set(source, budget);
    }
    return budget;
  }

  async run<T>(source: string, fn: (timeoutMs: number) => Promise<T>): Promise<T> {
    const { breaker, semaphore } = this.budget(source);
    const gate = breaker.tryPass();
    if (!gate.allowed) {
      throw new ToolError("UPSTREAM_DOWN", `${source} is failing repeatedly; calls are paused for ${gate.retryAfterSeconds}s.`, {
        retryAfterSeconds: gate.retryAfterSeconds
      });
    }
    const slot = semaphore.acquire();
    if (slot === false) {
      breaker.onNeutral();
      throw new ToolError("UPSTREAM_DOWN", `${source} is busy; too many calls are already queued.`, { retryAfterSeconds: 5 });
    }
    await slot;
    try {
      const value = await fn(this.config.timeoutMs);
      breaker.onSuccess();
      return value;
    } catch (error) {
      if (error instanceof ToolError && error.code === "UPSTREAM_DOWN") breaker.onFailure();
      else if (error instanceof ToolError) breaker.onNeutral();
      else breaker.onFailure();
      throw error;
    } finally {
      semaphore.release();
    }
  }

  snapshot(): Record<string, SourceSnapshot> {
    const out: Record<string, SourceSnapshot> = {};
    for (const [source, { breaker, semaphore }] of this.sources) {
      out[source] = { state: breaker.state(), consecutiveFailures: breaker.consecutiveFailures(), ...semaphore.load() };
    }
    return out;
  }
}

const HOST_SOURCES: Record<string, string> = {
  "data.cso.ie": "cso",
  "ws.cso.ie": "cso",
  "ec.europa.eu": "eurostat",
  "data-api.ecb.europa.eu": "ecb",
  "api.oireachtas.ie": "oireachtas",
  "data.oireachtas.ie": "oireachtas",
  "www.oireachtas.ie": "oireachtas",
  "www.geohive.ie": "geohive",
  "services-eu1.arcgis.com": "geohive",
  "opendata.ncse.ie": "ncse",
  "data.gov.ie": "data-gov-ie",
  "data.smartdublin.ie": "smart-dublin",
  "www.met.ie": "met-eireann",
  "prodapi.met.ie": "met-eireann",
  "prodapi.metweb.ie": "met-eireann",
  "openaccess.pf.api.met.ie": "met-eireann",
  "api.nationaltransport.ie": "nta",
  "developer.nationaltransport.ie": "nta",
  "www.irishstatutebook.ie": "legislation",
  "www.propertypriceregister.ie": "ppr",
  "api.irishrail.ie": "irish-rail",
  "luasforecasts.rpa.ie": "luas",
  "www.smartgriddashboard.com": "eirgrid",
  "erddap.marine.ie": "marine",
  "waterlevel.ie": "opw-water",
  "api.ted.europa.eu": "ted",
  "api.citybik.es": "bikes",
  "query.wikidata.org": "wikidata"
};

/** Maps an upstream URL to its source id; unknown hosts fall back to the hostname (never the path or query). */
export function sourceForUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return HOST_SOURCES[host] ?? host;
  } catch {
    return "upstream";
  }
}

let shared: UpstreamBudgets | undefined;

/** One budget set per process, shared by the MCP endpoint, the CLI and deep health. */
export function sharedBudgets(env: Record<string, string | undefined> = process.env): UpstreamBudgets {
  shared ??= new UpstreamBudgets(budgetConfigFromEnv(env));
  return shared;
}
