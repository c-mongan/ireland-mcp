import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { defineTool, type FetchedDocument, type SearchHit, type SourceModule, type ToolContext } from "../../gateway/module.js";

const BASE = "https://data360api.worldbank.org/data360/data";
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

type IndicatorRow = { INDICATOR?: string; REF_AREA?: string; TIME_PERIOD?: string; OBS_VALUE?: string | number | null; UNIT_MEASURE?: string | null };
type Data360Response = { count?: number; value?: IndicatorRow[] };
const indicatorName = (id: string) => CURATED.find((i) => i.id === id)?.name ?? id;
const data360Id = (id: string) => `WB_WDI_${id.replaceAll(".", "_")}`;
const wdiId = (id: string | undefined) => id?.replace(/^WB_WDI_/, "").replaceAll("_", ".") ?? null;
function rows(body: Data360Response, last: number): IndicatorRow[] {
  return (body.value ?? [])
    .filter((r) => r.OBS_VALUE !== null && r.OBS_VALUE !== undefined)
    .sort((a, b) => Number(b.TIME_PERIOD ?? 0) - Number(a.TIME_PERIOD ?? 0))
    .slice(0, last);
}
function compact(r: IndicatorRow) {
  const indicator = wdiId(r.INDICATOR);
  const value = typeof r.OBS_VALUE === "number" ? r.OBS_VALUE : Number(r.OBS_VALUE);
  return {
    indicator,
    name: indicator ? indicatorName(indicator) : null,
    country: r.REF_AREA ?? null,
    year: r.TIME_PERIOD ?? null,
    value: Number.isFinite(value) ? value : null,
    unit: r.UNIT_MEASURE ?? null
  };
}
async function indicator(ctx: ToolContext, country: string, id: string, params: Record<string, string>) {
  const url = `${BASE}?${new URLSearchParams({ DATABASE_ID: "WB_WDI", INDICATOR: data360Id(id), REF_AREA: country, ...params }).toString()}`;
  const result = await ctx.cachedJson<Data360Response>(url, TTL, {
    label: "World Bank Data360",
    headers: { "user-agent": "Mozilla/5.0 (compatible; ireland-mcp/1.0; +https://github.com/c-mongan/ireland-mcp)" }
  });
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
    const result = await indicator(ctx, country, id, { top: "200" });
    return envelope(worldBankInfo, { data: { total: result.value.count ?? rows(result.value, last).length, last_updated: null, observations: rows(result.value, last).map(compact) }, url: result.url, cached: result.cached, stale: result.stale });
  }
});

const profileTool = defineTool({
  name: "worldbank_ireland_profile",
  title: "Ireland World Bank key indicators",
  description: "Fetch a compact Ireland profile from curated World Bank indicators: population, GDP, GDP per capita, unemployment, inflation and CO2 per capita.",
  inputSchema: { last: z.number().int().min(1).max(10).default(1) },
  handler: async ({ last }, ctx) => {
    const results = await Promise.all(CURATED.map((i) => indicator(ctx, "IRL", i.id, { top: "200" }).then((r) => ({ info: i, result: r }))));
    return envelope(worldBankInfo, {
      data: { indicators: results.map(({ info, result }) => ({ id: info.id, name: info.name, observations: rows(result.value, last).map(compact) })) },
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
    const result = await indicator(ctx, "IRL", key, { top: "200" });
    const observations = rows(result.value, 10).map(compact);
    return { id: `${worldBankInfo.id}:${key}`, title: `${key} for Ireland`, text: JSON.stringify(observations, null, 2), url: result.url, metadata: { source: worldBankInfo.id, indicator: key } };
  }
};
