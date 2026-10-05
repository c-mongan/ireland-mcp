import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { assertJsonStat, cellCount, dimensions, rows, type JsonStat } from "../cso/jsonStat.js";

const API = "https://ec.europa.eu/eurostat/api/dissemination";
const TOC_URL = `${API}/catalogue/toc/txt?lang=en`;
const MAX_CELLS = 10_000;
const DATASET = z.string().regex(/^[A-Za-z0-9_]+$/).min(2).max(80).describe("Eurostat dataset code, e.g. demo_pjan or prc_hicp_midx.");
const limit = z.number().int().min(1).max(MAX_LIMIT).default(50).describe("Maximum rows to return (1-500).");

export const eurostatInfo: SourceInfo = {
  id: "eurostat",
  name: "Eurostat Statistics API",
  licence: "Eurostat reuse policy (CC BY 4.0 equivalent)",
  attribution: "Source: Eurostat, European Commission. Reuse permitted with acknowledgement.",
  homepage: "https://ec.europa.eu/eurostat"
};

interface TocRow {
  title: string;
  code: string;
  type: string;
  updated: string | null;
  structure_updated: string | null;
  start: string | null;
  end: string | null;
  values: number | null;
}

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function parseToc(text: string): TocRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(1).flatMap((line) => {
    const cols = line.split("\t").map((c) => c.replace(/^"|"$/g, ""));
    const [title, code, type, updated, structure, start, end, values] = cols;
    if (!code || !title) return [];
    return [
      {
        title: title.trim(),
        code: code.trim(),
        type: (type ?? "").trim(),
        updated: clean(updated),
        structure_updated: clean(structure),
        start: clean(start),
        end: clean(end),
        values: values && /^\d+$/.test(values.trim()) ? Number(values.trim()) : null
      }
    ];
  });
}

async function readToc(ctx: ToolContext) {
  return ctx.cachedText(TOC_URL, DAY, { label: "Eurostat catalogue", timeoutMs: 8_000, maxBytes: 8_000_000 });
}

function datasetUrl(dataset: string, params: URLSearchParams): string {
  return `${API}/statistics/1.0/data/${dataset}?${params.toString()}`;
}

function buildParams(filters: Record<string, string[]>, geos: string[], since?: string, until?: string): URLSearchParams {
  const params = new URLSearchParams({ format: "JSON", lang: "EN" });
  for (const geo of geos) params.append("geo", geo);
  for (const [key, values] of Object.entries(filters)) {
    if (key.toLowerCase() === "geo") continue;
    for (const value of values) params.append(key, value);
  }
  if (since) params.set("sinceTimePeriod", since);
  if (until) params.set("untilTimePeriod", until);
  return params;
}

async function readData(ctx: ToolContext, dataset: string, filters: Record<string, string[]>, geos: string[], since?: string, until?: string) {
  const url = datasetUrl(dataset, buildParams(filters, geos, since, until));
  const result = await ctx.cachedJson<JsonStat>(url, 6 * DAY, {
    label: `Eurostat dataset ${dataset}`,
    timeoutMs: 10_000,
    maxBytes: 4_000_000,
    validate: assertJsonStat
  });
  const cells = cellCount(result.value.size);
  if (cells > MAX_CELLS) {
    throw new ToolError("BAD_ARGS", `That Eurostat query selects ${cells} cells; the maximum is ${MAX_CELLS}.`, {
      hint: "Add filters (for example unit, age, sex or coicop), use since/until, or compare only IE with one EU aggregate."
    });
  }
  return { ...result, url };
}

const searchTool = defineTool({
  name: "eurostat_search_datasets",
  title: "Search Eurostat datasets",
  description: "Search the cached Eurostat table-of-contents catalogue by keyword and return dataset codes for eurostat_get_data.",
  example: { query: "population", limit: 5 },
  inputSchema: { query: z.string().min(2).max(120).describe("Keyword(s), e.g. population, hicp, unemployment."), limit },
  handler: async ({ query, limit: max }, ctx) => {
    const toc = await readToc(ctx);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = parseToc(toc.value)
      .filter((row) => row.type === "table")
      .filter((row) => terms.every((t) => `${row.title} ${row.code}`.toLowerCase().includes(t)))
      .map((row) => ({ ...row, url: `https://ec.europa.eu/eurostat/databrowser/view/${row.code}/default/table?lang=en` }));
    const { items, truncated } = bound(matches, max);
    return envelope(eurostatInfo, { data: { query, datasets: items, total: matches.length }, url: TOC_URL, cached: toc.cached, stale: toc.stale, truncated });
  }
});

const dataSchema = {
  dataset: DATASET,
  filters: z
    .record(z.string().min(1).max(80), z.array(z.string().min(1).max(80)).min(1).max(100))
    .default({})
    .describe('Map of Eurostat dimension code to category codes, e.g. {"sex":["T"],"age":["TOTAL"],"unit":["NR"]}.'),
  geos: z.array(z.string().min(1).max(30)).min(1).max(6).default(["IE"]).describe("Geographies to request; defaults to Ireland (IE). Use EU27_2020 for EU comparison."),
  since: z.string().min(4).max(10).optional().describe("Optional first time period, e.g. 2020 or 2024-01."),
  until: z.string().min(4).max(10).optional().describe("Optional last time period, e.g. 2024 or 2024-12."),
  limit
};

const dataTool = defineTool({
  name: "eurostat_get_data",
  title: "Eurostat data",
  description: "Fetch compact JSON-stat observations from a Eurostat dataset. Defaults to geo=IE; filter dimensions to keep the query under 10,000 cells.",
  example: { dataset: "demo_pjan", filters: { sex: ["T"], age: ["TOTAL"], unit: ["NR"], time: ["2024"] }, limit: 5 },
  inputSchema: dataSchema,
  handler: async ({ dataset, filters, geos, since, until, limit: max }, ctx) => {
    const data = await readData(ctx, dataset, filters, geos, since, until);
    const decoded = rows(data.value, max);
    return envelope(eurostatInfo, {
      data: {
        dataset,
        title: data.value.label ?? dataset,
        dimensions: Object.fromEntries(dimensions(data.value).map((d) => [d.code, { label: d.label, categories: d.categories.length }])),
        rows: decoded.rows,
        total_rows: decoded.total
      },
      url: data.url,
      cached: data.cached,
      stale: data.stale,
      truncated: decoded.total > decoded.rows.length
    });
  }
});

const compareTool = defineTool({
  name: "eurostat_compare_ie_eu",
  title: "Compare Ireland with EU aggregate",
  description: "Convenience Eurostat call for the same dataset/filter selection with geo=IE and an EU aggregate such as EU27_2020.",
  example: { dataset: "demo_pjan", filters: { sex: ["T"], age: ["TOTAL"], unit: ["NR"], time: ["2024"] } },
  inputSchema: { ...dataSchema, eu_geo: z.string().min(2).max(30).default("EU27_2020").describe("EU aggregate geography code.") },
  handler: async ({ dataset, filters, since, until, limit: max, eu_geo }, ctx) => {
    const data = await readData(ctx, dataset, filters, ["IE", eu_geo], since, until);
    const decoded = rows(data.value, max);
    return envelope(eurostatInfo, {
      data: { dataset, title: data.value.label ?? dataset, geos: ["IE", eu_geo], rows: decoded.rows, total_rows: decoded.total },
      url: data.url,
      cached: data.cached,
      stale: data.stale,
      truncated: decoded.total > decoded.rows.length
    });
  }
});

async function search(query: string, max: number, ctx: ToolContext) {
  const toc = await readToc(ctx);
  return parseToc(toc.value)
    .filter((row) => row.type === "table")
    .filter((row) => `${row.title} ${row.code}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, max)
    .map((row) => ({ id: `eurostat:${row.code}`, title: `${row.title} (Eurostat ${row.code})`, url: `https://ec.europa.eu/eurostat/databrowser/view/${row.code}/default/table?lang=en` }));
}

export const eurostatModule: SourceModule = {
  info: eurostatInfo,
  summary: "EU statistical datasets for Ireland and comparable EU aggregates via Eurostat JSON-stat.",
  domain: "stats",
  coverage: "Eurostat datasets where Ireland (geo=IE) is published, with optional EU aggregate comparison and time filters.",
  tools: [searchTool, dataTool, compareTool],
  search
};
