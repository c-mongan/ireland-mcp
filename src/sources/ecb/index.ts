import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";

const API = "https://data-api.ecb.europa.eu/service/data";
const FLOW_PREFIXES = new Set(["EXR", "FM", "MIR", "BSI", "ICP"]);
const FLOW = z.string().regex(/^[A-Z0-9_]+$/).min(2).max(20).optional().describe("ECB flow id, e.g. EXR or FM. Optional when key starts with FLOW.");
const KEY = z.string().regex(/^[A-Za-z0-9_.-]+$/).min(3).max(160).describe("ECB series key. May include the flow prefix, e.g. EXR.D.USD.EUR.SP00.A.");
const lastNObservations = z.number().int().min(1).max(100).default(10).describe("Latest observations to return (1-100).");

export const ecbInfo: SourceInfo = {
  id: "ecb",
  name: "ECB Data Portal",
  licence: "ECB Data Portal terms of use (free reuse with attribution)",
  attribution: "Source: European Central Bank Data Portal. Reuse with acknowledgement.",
  homepage: "https://data.ecb.europa.eu"
};

interface EcbDimensionValue { id: string; name?: string }
interface EcbDimension { id: string; name?: string; values: EcbDimensionValue[] }
interface EcbJson {
  header?: { prepared?: string };
  structure?: { name?: string; dimensions?: { series?: EcbDimension[]; observation?: EcbDimension[] } };
  dataSets?: Array<{ series?: Record<string, { observations?: Record<string, [number | null, ...unknown[]]> }> }>;
}

function splitKey(flow: string | undefined, key: string): { flow: string; seriesKey: string; fullKey: string } {
  const parts = key.split(".");
  const knownPrefix = parts[0] && FLOW_PREFIXES.has(parts[0]) && parts.length > 2 ? parts[0] : undefined;
  const resolvedFlow = flow ?? knownPrefix;
  if (!resolvedFlow) throw new ToolError("BAD_ARGS", "ECB key must include a flow prefix or pass flow separately.", { hint: "Use keys like EXR.D.USD.EUR.SP00.A or FM.B.U2.EUR.4F.KR.MRR_FR.LEV." });
  const seriesKey = knownPrefix === resolvedFlow ? parts.slice(1).join(".") : key;
  return { flow: resolvedFlow, seriesKey, fullKey: `${resolvedFlow}.${seriesKey}` };
}

function assertEcbJson(value: unknown): EcbJson {
  const data = value as EcbJson | null;
  if (!data || !Array.isArray(data.dataSets) || !data.structure?.dimensions?.observation) {
    throw new ToolError("UPSTREAM_DOWN", "ECB returned an unexpected SDMX-JSON document.");
  }
  return data;
}

function decode(data: EcbJson) {
  const seriesDims = data.structure?.dimensions?.series ?? [];
  const obsDim = data.structure?.dimensions?.observation?.find((d) => d.id === "TIME_PERIOD") ?? data.structure?.dimensions?.observation?.[0];
  const timeValues = obsDim?.values ?? [];
  const series = data.dataSets?.[0]?.series ?? {};
  const out = Object.entries(series).map(([seriesIndex, body]) => {
    const indexes = seriesIndex.split(":").map((i) => Number(i));
    const dimensions = Object.fromEntries(
      seriesDims.map((dim, i) => {
        const value = dim.values[indexes[i] ?? 0];
        return [dim.id, { id: value?.id ?? String(indexes[i] ?? 0), name: value?.name ?? value?.id ?? String(indexes[i] ?? 0) }];
      })
    );
    const observations = Object.entries(body.observations ?? {}).map(([timeIndex, tuple]) => {
      const t = timeValues[Number(timeIndex)];
      return { time: t?.id ?? t?.name ?? timeIndex, value: tuple[0] ?? null };
    });
    return { key: seriesIndex, dimensions, observations };
  });
  return { name: data.structure?.name ?? null, prepared: data.header?.prepared ?? null, series: out };
}

function seriesUrl(flow: string, key: string, last: number): string {
  const params = new URLSearchParams({ format: "jsondata", lastNObservations: String(last) });
  return `${API}/${flow}/${key}?${params.toString()}`;
}

async function readSeries(ctx: ToolContext, flow: string, key: string, last: number) {
  const url = seriesUrl(flow, key, last);
  const result = await ctx.cachedJson<EcbJson>(url, DAY, {
    label: `ECB ${flow}.${key}`,
    timeoutMs: 8_000,
    maxBytes: 2_000_000,
    validate: assertEcbJson
  });
  return { ...result, url, decoded: decode(result.value) };
}

const seriesTool = defineTool({
  name: "ecb_get_series",
  title: "ECB time series",
  description: "Fetch a keyless ECB Data Portal SDMX-JSON time series. Supports ECB and Central Bank of Ireland series exposed through ECB flows such as MIR/BSI where available.",
  example: { key: "EXR.D.USD.EUR.SP00.A", lastNObservations: 5 },
  inputSchema: { key: KEY, flow: FLOW, lastNObservations },
  handler: async ({ key, flow, lastNObservations: last }, ctx) => {
    const resolved = splitKey(flow, key);
    const result = await readSeries(ctx, resolved.flow, resolved.seriesKey, last);
    return envelope(ecbInfo, {
      data: { key: resolved.fullKey, ...result.decoded },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated: false
    });
  }
});

const RATE_KEYS = [
  { label: "main_refinancing_rate", key: "FM.B.U2.EUR.4F.KR.MRR_FR.LEV" },
  { label: "deposit_facility_rate", key: "FM.B.U2.EUR.4F.KR.DFR.LEV" },
  { label: "marginal_lending_facility_rate", key: "FM.B.U2.EUR.4F.KR.MLFR.LEV" }
] as const;

const interestTool = defineTool({
  name: "ecb_interest_rates",
  title: "ECB policy interest rates",
  description: "Latest ECB policy rates: main refinancing, deposit facility and marginal lending facility.",
  example: { lastNObservations: 3 },
  inputSchema: { lastNObservations: z.number().int().min(1).max(20).default(3) },
  handler: async ({ lastNObservations: last }, ctx) => {
    const results = await Promise.all(
      RATE_KEYS.map(async (item) => {
        const { flow, seriesKey, fullKey } = splitKey(undefined, item.key);
        const result = await readSeries(ctx, flow, seriesKey, last);
        return { label: item.label, key: fullKey, observations: result.decoded.series[0]?.observations ?? [], cached: result.cached, stale: result.stale, url: result.url };
      })
    );
    return envelope(ecbInfo, {
      data: { rates: results.map(({ label, key, observations }) => ({ label, key, observations })) },
      url: "https://data.ecb.europa.eu/data/datasets/FM",
      cached: results.every((r) => r.cached),
      stale: results.some((r) => r.stale),
      truncated: false
    });
  }
});

const exchangeTool = defineTool({
  name: "ecb_exchange_rate",
  title: "Euro foreign exchange rate",
  description: "Latest ECB euro foreign exchange reference rate for a currency, e.g. USD gives USD per EUR (EXR.D.USD.EUR.SP00.A).",
  example: { currency: "USD", lastNObservations: 5 },
  inputSchema: { currency: z.string().regex(/^[A-Za-z]{3}$/).describe("Three-letter currency code quoted against EUR, e.g. USD or GBP."), lastNObservations },
  handler: async ({ currency, lastNObservations: last }, ctx) => {
    const code = currency.toUpperCase();
    const result = await readSeries(ctx, "EXR", `D.${code}.EUR.SP00.A`, last);
    const observations = result.decoded.series[0]?.observations ?? [];
    const { items, truncated } = bound(observations, last);
    return envelope(ecbInfo, {
      data: { currency: code, base: "EUR", quote: `${code} per EUR`, key: `EXR.D.${code}.EUR.SP00.A`, observations: items },
      url: result.url,
      cached: result.cached,
      stale: result.stale,
      truncated
    });
  }
});

export const ecbModule: SourceModule = {
  info: ecbInfo,
  summary: "ECB Data Portal financial series: euro interest rates, FX rates, and Irish banking series exposed through ECB flows.",
  domain: "stats",
  coverage: "ECB SDMX REST data including euro area policy rates, exchange rates and selected Ireland MIR/BSI/financial series where exposed by ECB.",
  tools: [seriesTool, interestTool, exchangeTool]
};
