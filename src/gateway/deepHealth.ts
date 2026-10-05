import { CSO_REST } from "../sources/cso/client.js";
import { dublinDate, EIRGRID_BASE } from "../sources/eirgrid/index.js";
import { ARCGIS_BASE } from "../sources/geohive/index.js";
import { RAIL_BASE } from "../sources/irish-rail/index.js";
import { EISB } from "../sources/legislation/index.js";
import { LUAS_BASE } from "../sources/luas/index.js";
import { WARNINGS_URL } from "../sources/met-eireann/index.js";
import { TRIP_UPDATES_URL } from "../sources/nta/index.js";
import { OIREACHTAS_API } from "../sources/oireachtas/index.js";
import { OPW_BASE } from "../sources/opw-water/index.js";
import { PPR_DOWNLOADS } from "../sources/ppr/parse.js";
import { ARCGIS_LAYERS } from "../sources/arcgis/client.js";
import type { FetchLike } from "./http.js";

export interface Probe {
  source: string;
  url: string;
  headers?: Record<string, string>;
  /** Reason the probe cannot run here (for example a missing API key). */
  skip?: string;
}

export interface SourceHealth {
  source: string;
  status: "up" | "down" | "skipped";
  latencyMs: number;
  httpStatus?: number;
  error?: string;
}

export interface DeepHealthReport {
  status: "ok" | "degraded" | "down";
  checked_at: string;
  cached: boolean;
  sources: SourceHealth[];
}

export const DEEP_HEALTH_TTL_MS = 60_000;
export const DEEP_HEALTH_TIMEOUT_MS = 5_000;
const USER_AGENT = "ireland-mcp-healthcheck/1.0 (+https://github.com/c-mongan/ireland-mcp)";

/** One cheap, real request per source: small documents or metadata endpoints only. */
export function defaultProbes(env: Record<string, string | undefined>): Probe[] {
  const ntaKey = env.NTA_API_KEY;
  return [
    { source: "cso", url: `${CSO_REST}/PxStat.Data.Cube_API.ReadMetadata/F1001/JSON-stat/2.0/en` },
    { source: "oireachtas", url: `${OIREACHTAS_API}/legislation?limit=1` },
    { source: "geohive", url: `${ARCGIS_BASE}?f=json` },
    { source: "data-gov-ie", url: "https://data.gov.ie/api/3/action/status_show" },
    { source: "smart-dublin", url: "https://data.smartdublin.ie/api/3/action/status_show" },
    { source: "met-eireann", url: WARNINGS_URL },
    ntaKey
      ? { source: "nta", url: TRIP_UPDATES_URL, headers: { "x-api-key": ntaKey } }
      : { source: "nta", url: TRIP_UPDATES_URL, skip: "NTA_API_KEY not set" },
    { source: "legislation", url: `${EISB}/` },
    { source: "ppr", url: PPR_DOWNLOADS },
    { source: "irish-rail", url: `${RAIL_BASE}/getAllStationsXML` },
    { source: "luas", url: `${LUAS_BASE}?action=forecast&stop=HEU&encrypt=false` },
    {
      source: "eirgrid",
      url: `${EIRGRID_BASE}?region=ALL&chartType=default&dateRange=day&dateFrom=${dublinDate()}+00:00&dateTo=${dublinDate()}+23:59&areas=demandactual`
    },
    { source: "marine", url: "https://erddap.marine.ie/erddap/info/IWBNetwork/index.json" },
    { source: "opw-water", url: `${OPW_BASE}/geojson/latest/` },
    { source: "planning", url: `${ARCGIS_LAYERS.planningPoints}?f=json` },
    { source: "census-areas", url: `${ARCGIS_LAYERS.censusSmallAreas}?f=json` },
    { source: "heritage", url: `${ARCGIS_LAYERS.smr}?f=json` },
    { source: "environment-sites", url: `${ARCGIS_LAYERS.npwsSac}?f=json` },
    { source: "ted", url: "https://api.ted.europa.eu/swagger-ui/index.html" },
    { source: "bikes", url: "https://api.citybik.es/v2/networks?fields=id" }
  ];
}

export interface DeepHealthOptions {
  probes: Probe[] | (() => Probe[]);
  fetch?: FetchLike;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Probes all sources in parallel. The report is cached and concurrent callers share one
 * run, so hammering /healthz?deep=1 costs at most one probe per source per minute.
 */
export class DeepHealth {
  private cache: { at: number; report: DeepHealthReport } | undefined;
  private inflight: Promise<DeepHealthReport> | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(private readonly options: DeepHealthOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  async check(): Promise<DeepHealthReport> {
    const ttl = this.options.ttlMs ?? DEEP_HEALTH_TTL_MS;
    if (this.cache && this.now() - this.cache.at <= ttl) return { ...this.cache.report, cached: true };
    this.inflight ??= this.run().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async run(): Promise<DeepHealthReport> {
    const probes = typeof this.options.probes === "function" ? this.options.probes() : this.options.probes;
    const sources = await Promise.all(probes.map((probe) => this.probe(probe)));
    const live = sources.filter((s) => s.status !== "skipped");
    const down = live.filter((s) => s.status === "down").length;
    const report: DeepHealthReport = {
      status: down === 0 ? "ok" : down === live.length ? "down" : "degraded",
      checked_at: new Date(this.now()).toISOString(),
      cached: false,
      sources
    };
    this.cache = { at: this.now(), report };
    return report;
  }

  private async probe(probe: Probe): Promise<SourceHealth> {
    if (probe.skip) return { source: probe.source, status: "skipped", latencyMs: 0, error: probe.skip };
    const started = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.options.timeoutMs ?? DEEP_HEALTH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(probe.url, {
        headers: { "user-agent": USER_AGENT, ...probe.headers },
        signal: controller.signal
      });
      // Headers are enough to prove liveness; do not download the body.
      await response.body?.cancel().catch(() => undefined);
      const latencyMs = Math.round(performance.now() - started);
      return response.ok
        ? { source: probe.source, status: "up", latencyMs, httpStatus: response.status }
        : { source: probe.source, status: "down", latencyMs, httpStatus: response.status, error: `HTTP ${response.status}` };
    } catch {
      return {
        source: probe.source,
        status: "down",
        latencyMs: Math.round(performance.now() - started),
        error: timedOut ? "timeout" : "unreachable"
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

let shared: DeepHealth | undefined;

export function sharedDeepHealth(env: Record<string, string | undefined> = process.env): DeepHealth {
  shared ??= new DeepHealth({ probes: () => defaultProbes(env) });
  return shared;
}
