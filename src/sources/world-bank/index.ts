import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";

const BASE = "https://api.worldbank.org/v2";
const TTL = DAY;
const CURATED = [
  { id: "SP.POP.TOTL", name: "Population, total" },
  { id: "NY.GDP.MKTP.CD", name: "GDP (current US$)" },
  { id: "NY.GDP.PCAP.CD", name: "GDP per capita (current US$)" },
  { id: "SL.UEM.TOTL.ZS", name: "Unemployment, total (% of labour force)" },
  { id: "FP.CPI.TOTL.ZG", name: "Inflation, consumer prices (annual %)" },
  { id: "EN.ATM.CO2E.PC", name: "CO2 emissions (metric tons per capita)" }
] as const;

export const worldBankInfo: SourceInfo = {
  id: "world-bank",
  name: "World Bank Indicators for Ireland",
  licence: "CC BY 4.0",
  attribution: "World Bank Open Data.",
  homepage: "https://data.worldbank.org/country/ireland"
};

type IndicatorRow = { indicator?: { id?: string; value?: string }; country?: { id?: string; value?: string }; countryiso3code?: string; date?: string; value?: number | null; unit?: string; obs_status?: string; decimal?: number };
type WbResponse = [{ page?: number; pages?: number; per_page?: number | string; total?: number; lastupdated?: string }, IndicatorRow[]];
function rows(body: WbResponse): IndicatorRow[] { return Array.isArray(body?.[1]) ? body[1] : []; }
function compact(r: IndicatorRow) { return { indicator: r.indicator?.id ?? null, name: r.indicator?.value ?? null, country: r.countryiso3code ?? r.country?.id ?? null, year: r.date ?? null, value: r.value ?? null }; }
async function indicator(ctx: ToolContext, country: string, id: string, params: Record<string, string>) {
  const url = `${BASE}/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(id)}?${new URLSearchParams({ format: "json", ...params }).toString()}`;
  const result = await ctx.cachedJson<WbResponse>(url, TTL, { label: "World Bank" });
  return { url, value: result.value, cached: result.cached, stale: result.stale };
}

const indicatorTool = defineTool({
  name: "worldbank_get_indicator",
  title: "Get Ireland World Bank indicator",
  description: "Get recent World Bank indicator observations for Ireland (or another ISO3 country).",
  example: { indicator: "SP.POP.TOTL", country: "IRL", last: 5 },
  inputSchema: {
    indicator: z.string().regex(/^[A-Z0-9.]+$/).describe("World Bank indicator id, e.g. SP.POP.TOTL or NY.GDP.MKTP.CD."),
    country: z.string().regex(/^[A-Z]{3}$/).default("IRL"),
    last: z.number().int().min(1).max(MAX_LIMIT).default(10)
  },
  handler: async ({ indicator: id, country, last }, ctx) => {
    const result = await indicator(ctx, country, id, { per_page: String(last), MRV: String(last) });
    const meta = result.value[0] ?? {};
    return envelope(worldBankInfo, { data: { total: meta.total ?? rows(result.value).length, last_updated: meta.lastupdated ?? null, observations: rows(result.value).map(compact) }, url: result.url, cached: result.cached, stale: result.stale });
  }
});

const profileTool = defineTool({
  name: "worldbank_ireland_profile",
  title: "Ireland World Bank key indicators",
  description: "Fetch a compact Ireland profile from curated World Bank indicators: population, GDP, GDP per capita, unemployment, inflation and CO2 per capita.",
  inputSchema: { last: z.number().int().min(1).max(10).default(1) },
  handler: async ({ last }, ctx) => {
    const results = await Promise.all(CURATED.map((i) => indicator(ctx, "IRL", i.id, { per_page: String(last), MRV: String(last) }).then((r) => ({ info: i, result: r }))));
    return envelope(worldBankInfo, {
      data: { indicators: results.map(({ info, result }) => ({ id: info.id, name: info.name, observations: rows(result.value).map(compact) })) },
      url: worldBankInfo.homepage,
      cached: results.every((r) => r.result.cached),
      stale: results.some((r) => r.result.stale)
    });
  }
});

export const worldBankModule: SourceModule = {
  info: worldBankInfo,
  summary: "Ireland macroeconomic, population and development indicators from World Bank Open Data.",
  domain: "economy",
  coverage: "World Bank country indicator time series for Ireland (IRL), with optional ISO3 country override for comparisons.",
  tools: [indicatorTool, profileTool],
  async search(query: string, limit: number): Promise<SearchHit[]> {
    const q = query.toLowerCase();
    return CURATED.filter((i) => `${i.id} ${i.name}`.toLowerCase().includes(q)).slice(0, limit).map((i) => ({ id: `${worldBankInfo.id}:${i.id}`, title: i.name, url: `${worldBankInfo.homepage}?indicator=${i.id}` }));
  },
  async fetchById(key: string, ctx: ToolContext): Promise<FetchedDocument> {
    const result = await indicator(ctx, "IRL", key, { per_page: "10", MRV: "10" });
    const observations = rows(result.value).map(compact);
    return { id: `${worldBankInfo.id}:${key}`, title: `${key} for Ireland`, text: JSON.stringify(observations, null, 2), url: result.url, metadata: { source: worldBankInfo.id, indicator: key } };
  }
};
