import { z } from "zod";
import { DAY, HOUR } from "../../gateway/context.js";
import { bound, DEFAULT_LIMIT, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { pprIndexStoreFromEnv, type PprIndex, type PprIndexStore } from "./indexStore.js";
import { COUNTIES, csvUrl, parsePprCsv, toSale, type County, type SaleRow } from "./parse.js";

export const pprInfo: SourceInfo = {
  id: "ppr",
  name: "Residential Property Price Register (PSRA)",
  licence: "PSI General Licence / CC BY 4.0",
  attribution:
    "Property Services Regulatory Authority, Residential Property Price Register. The register reflects declared sale prices and is not a valuation.",
  homepage: "https://www.propertypriceregister.ie"
};

const PUBLIC_URL = "https://www.propertypriceregister.ie/website/npsra/pprweb.nsf/PPR?OpenForm";
const MAX_LIVE_YEARS = 3;
const FIRST_YEAR = 2010;

const filterShape = {
  county: z.enum(COUNTIES).optional().describe("County, e.g. 'Galway'. Required when the national index has not been built."),
  address: z.string().max(100).optional().describe("Words that must all appear in the address, e.g. 'oranmore' or 'dublin 8'."),
  eircode: z.string().regex(/^[A-Za-z0-9 ]{3,8}$/).optional().describe("Eircode or routing-key prefix, e.g. 'H91' or 'D08'."),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Earliest sale date, YYYY-MM-DD."),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Latest sale date, YYYY-MM-DD."),
  min_price: z.number().min(0).optional(),
  max_price: z.number().min(0).optional(),
  property: z.enum(["any", "new", "second-hand"]).default("any"),
  include_non_market: z.boolean().default(false).describe("Include sales flagged as not full market price.")
};
type Filters = z.infer<z.ZodObject<typeof filterShape>>;

function yearsFor(f: Filters, now: Date): number[] {
  const last = f.to ? Number(f.to.slice(0, 4)) : now.getUTCFullYear();
  const first = f.from ? Number(f.from.slice(0, 4)) : last;
  if (first > last) throw new ToolError("BAD_ARGS", "'from' must be on or before 'to'.");
  if (first < FIRST_YEAR) throw new ToolError("BAD_ARGS", `The register starts in ${FIRST_YEAR}.`);
  const years: number[] = [];
  for (let y = first; y <= Math.min(last, now.getUTCFullYear()); y += 1) years.push(y);
  return years;
}

export function applyFilters(rows: SaleRow[], f: Filters): SaleRow[] {
  const words = (f.address ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean);
  const eir = f.eircode?.replace(/\s+/g, "").toUpperCase();
  return rows.filter((r) => {
    if (f.county && r[2] !== f.county) return false;
    if (f.from && r[0] < f.from) return false;
    if (f.to && r[0] > f.to) return false;
    if (f.min_price !== undefined && r[4] < f.min_price) return false;
    if (f.max_price !== undefined && r[4] > f.max_price) return false;
    if (!f.include_non_market && (r[5] & 1) === 1) return false;
    if (f.property === "new" && !/^new/i.test(r[6])) return false;
    if (f.property === "second-hand" && !/^second/i.test(r[6])) return false;
    if (eir && !r[3].replace(/\s+/g, "").startsWith(eir)) return false;
    const address = r[1].toUpperCase();
    return words.every((w) => address.includes(w));
  });
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
};

export function priceStats(rows: SaleRow[]) {
  const prices = rows.map((r) => r[4]).sort((a, b) => a - b);
  return {
    count: prices.length,
    median_eur: quantile(prices, 0.5),
    mean_eur: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    p25_eur: quantile(prices, 0.25),
    p75_eur: quantile(prices, 0.75),
    min_eur: prices[0] ?? null,
    max_eur: prices.at(-1) ?? null,
    new_count: rows.filter((r) => /^new/i.test(r[6])).length,
    second_hand_count: rows.filter((r) => /^second/i.test(r[6])).length
  };
}

export interface PprModuleOptions {
  store?: PprIndexStore;
}

export function createPprModule(options: PprModuleOptions = {}): SourceModule {
  let store = options.store;
  const getStore = (ctx: ToolContext) => (store ??= pprIndexStoreFromEnv(ctx.env));

  async function readIndex(ctx: ToolContext): Promise<PprIndex | undefined> {
    try {
      const r = await ctx.cache.getOrLoad("ppr:index:v1", HOUR, async () => {
        const index = await getStore(ctx).read();
        if (!index) throw new Error("no index");
        return index;
      });
      return r.value;
    } catch {
      return undefined;
    }
  }

  async function load(ctx: ToolContext, f: Filters): Promise<{ rows: SaleRow[]; source: string; url: string; cached: boolean; stale: boolean }> {
    const years = yearsFor(f, ctx.now());
    const index = await readIndex(ctx);
    if (index && years.every((y) => index.years.includes(y))) {
      return { rows: index.rows, source: `index built ${index.built_at}`, url: PUBLIC_URL, cached: true, stale: false };
    }
    if (!f.county) {
      throw new ToolError("BAD_ARGS", "Give a county: the national index for those years is not available on this server.", {
        hint: index ? `The national index covers ${index.years.join(", ")}; other years need a county.` : "Add county, e.g. 'Dublin'."
      });
    }
    if (years.length > MAX_LIVE_YEARS) {
      throw new ToolError("BAD_ARGS", `Ask for at most ${MAX_LIVE_YEARS} calendar years at a time.`);
    }
    const county = f.county as County;
    let cached = true;
    let stale = false;
    const rows: SaleRow[] = [];
    for (const year of years) {
      const url = csvUrl(year, county);
      const r = await ctx.cache.getOrLoad(`ppr:${year}:${county}`, DAY, async () =>
        parsePprCsv(await ctx.http.bytes(url, { label: "Property Price Register", maxBytes: 20 * 1024 * 1024, timeoutMs: 30_000 }))
      );
      rows.push(...r.value);
      cached &&= r.cached;
      stale ||= r.stale;
    }
    rows.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
    return { rows, source: `live county CSV ${years.join(", ")}`, url: csvUrl(years.at(-1)!, county), cached, stale };
  }

  const searchSales = defineTool({
    name: "ppr_search_sales",
    example: { county: "Galway", address: "oranmore", limit: 5 },
    title: "Search residential property sales",
    description:
      "Search the Residential Property Price Register (declared sale prices, 2010–present) by county, address words, Eircode prefix, date and price. Newest first.",
    inputSchema: {
      ...filterShape,
      sort: z.enum(["date_desc", "price_desc", "price_asc"]).default("date_desc"),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT)
    },
    handler: async ({ sort, limit, ...f }, ctx) => {
      const r = await load(ctx, f);
      const matches = applyFilters(r.rows, f);
      if (sort !== "date_desc") matches.sort((a, b) => (sort === "price_desc" ? b[4] - a[4] : a[4] - b[4]));
      const page = bound(matches, limit);
      return envelope(pprInfo, {
        data: { total: matches.length, source: r.source, sales: page.items.map(toSale) },
        url: r.url,
        cached: r.cached,
        stale: r.stale,
        truncated: page.truncated
      });
    }
  });

  const stats = defineTool({
    name: "ppr_price_stats",
    title: "Property price statistics",
    description:
      "Median, mean and quartile sale prices from the Property Price Register for a county, area (address words) or Eircode prefix and date range. Excludes non-market sales by default.",
    inputSchema: filterShape,
    handler: async (f, ctx) => {
      const r = await load(ctx, f);
      const matches = applyFilters(r.rows, f);
      const [first, last] = [matches.at(-1)?.[0] ?? null, matches[0]?.[0] ?? null];
      return envelope(pprInfo, {
        data: { ...priceStats(matches), first_sale: first, last_sale: last, filters: f, source: r.source },
        url: r.url,
        cached: r.cached,
        stale: r.stale
      });
    }
  });

  return {
    info: pprInfo,
    summary: "Residential property sale prices (Property Price Register): search sales and median prices by area.",
    domain: "places/property",
    coverage: "Every residential sale declared to Revenue since 2010, by county and address, from the Property Services Regulatory Authority.",
    tools: [searchSales, stats]
  };
}

export const pprModule = createPprModule();
