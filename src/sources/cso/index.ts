import { z } from "zod";
import { bound, envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import {
  MAX_CELLS,
  metadataUrl,
  normaliseTableCode,
  readDataset,
  readMetadata,
  searchTables,
  tableUrl
} from "./client.js";
import { cellCount, dimensions, rows } from "./jsonStat.js";

export const csoInfo: SourceInfo = {
  id: "cso",
  name: "Central Statistics Office (CSO) PxStat",
  licence: "CC BY 4.0",
  attribution: "Source: Central Statistics Office, Ireland (www.cso.ie), licensed under CC BY 4.0.",
  homepage: "https://data.cso.ie"
};

const limit = z.number().int().min(1).max(MAX_LIMIT).default(50).describe("Maximum rows to return (1-500).");
const tableCode = z.string().min(2).max(40).describe("CSO table code, e.g. F1001 (population at each census).");

const searchTool = defineTool({
  name: "cso_search_tables",
  example: { query: "population by county" },
  title: "Search CSO tables",
  description:
    "Search the CSO PxStat catalogue of statistical tables by keyword (e.g. 'house prices', 'unemployment', 'population county'). Returns table codes to use with cso_get_table_metadata and cso_get_data.",
  inputSchema: { query: z.string().min(2).max(200).describe("Keywords to search for."), limit },
  handler: async ({ query, limit: max }, ctx) => {
    const result = await searchTables(ctx, query);
    const tables = result.value.map((table) => ({
      code: table.MtrCode,
      title: table.MtrTitle,
      subject: table.SbjValue ?? table.ThmValue ?? null,
      publisher: table.CprValue ?? null,
      released: table.RlsLiveDatetimeFrom ?? null,
      dimensions: (table.classification ?? []).map((c) => c.ClsValue),
      url: tableUrl(table.MtrCode)
    }));
    const { items, truncated } = bound(tables, max);
    return envelope(csoInfo, {
      data: items,
      url: `https://data.cso.ie/search?q=${encodeURIComponent(query)}`,
      cached: result.cached,
      stale: result.stale,
      truncated
    });
  }
});

const metadataTool = defineTool({
  name: "cso_get_table_metadata",
  example: { table_code: "F1001" },
  title: "CSO table metadata",
  description:
    "Get a CSO table's title, last update and dimensions with their category codes. Use the codes as filters in cso_get_data.",
  inputSchema: {
    table_code: tableCode,
    max_categories: z.number().int().min(1).max(MAX_LIMIT).default(60).describe("Maximum categories listed per dimension.")
  },
  handler: async ({ table_code, max_categories }, ctx) => {
    const code = normaliseTableCode(table_code);
    const result = await readMetadata(ctx, code);
    let truncated = false;
    const dims = dimensions(result.value).map((dim) => {
      const { items, truncated: cut } = bound(dim.categories, max_categories);
      truncated ||= cut;
      return { ...dim, total_categories: dim.categories.length, categories: items };
    });
    return envelope(csoInfo, {
      data: {
        code,
        title: result.value.label ?? code,
        updated: result.value.updated ?? null,
        total_cells: cellCount(result.value.size),
        dimensions: dims,
        notes: (result.value.note ?? []).slice(0, 3)
      },
      url: tableUrl(code),
      cached: result.cached,
      stale: result.stale,
      truncated
    });
  }
});

const dataTool = defineTool({
  name: "cso_get_data",
  example: { table_code: "F1001", filters: { "TLIST(A1)": ["2022"] }, limit: 10 },
  title: "CSO table data",
  description:
    "Fetch observations from a CSO table. Filter each dimension by category codes from cso_get_table_metadata; unfiltered dimensions return every category. Queries over 10,000 cells are rejected, so filter large tables.",
  inputSchema: {
    table_code: tableCode,
    filters: z
      .record(z.string(), z.array(z.string().min(1).max(60)).min(1).max(200))
      .default({})
      .describe('Map of dimension code to category codes, e.g. {"TLIST(A1)":["2022"],"C02779V03348":["02"]}.'),
    limit
  },
  handler: async ({ table_code, filters, limit: max }, ctx) => {
    const code = normaliseTableCode(table_code);
    const meta = await readMetadata(ctx, code);
    const dims = dimensions(meta.value);
    const selection: Record<string, string[]> = {};
    for (const [dimCode, codes] of Object.entries(filters)) {
      const dim = dims.find((d) => d.code === dimCode || d.label.toLowerCase() === dimCode.toLowerCase());
      if (!dim) {
        throw new ToolError("BAD_ARGS", `Table ${code} has no dimension "${dimCode}".`, {
          hint: `Dimensions: ${dims.map((d) => `${d.code} (${d.label})`).join(", ")}.`
        });
      }
      const known = new Set(dim.categories.map((c) => c.code));
      const unknown = codes.filter((c) => !known.has(c));
      if (unknown.length > 0) {
        throw new ToolError("BAD_ARGS", `Unknown ${dim.label} codes: ${unknown.slice(0, 5).join(", ")}.`, {
          hint: "Use cso_get_table_metadata to list valid category codes."
        });
      }
      selection[dim.code] = codes;
    }
    const cells = dims.reduce((count, dim) => count * (selection[dim.code]?.length ?? dim.categories.length), 1);
    if (cells > MAX_CELLS) {
      throw new ToolError("BAD_ARGS", `That query selects ${cells} cells; the maximum is ${MAX_CELLS}.`, {
        hint: "Add filters for the largest dimensions (often time and geography)."
      });
    }
    const query = Object.keys(selection).length > 0 ? selection : { [dims[0]!.code]: dims[0]!.categories.map((c) => c.code) };
    const data = await readDataset(ctx, code, query);
    const decoded = rows(data.value, max);
    return envelope(csoInfo, {
      data: {
        code,
        title: data.value.label ?? meta.value.label ?? code,
        dimensions: Object.fromEntries(dims.map((d) => [d.label, d.code])),
        rows: decoded.rows,
        total_rows: decoded.total
      },
      url: tableUrl(code),
      cached: data.cached,
      stale: data.stale,
      truncated: decoded.total > decoded.rows.length
    });
  }
});

const F1001 = { table: "F1001", year: "TLIST(A1)", county: "C02779V03348", sex: "C02199V02655" } as const;
const F1015 = { table: "F1015", year: "TLIST(A1)", town: "C04160V04929", sex: "C02199V02655" } as const;

const fold = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

function pickTown(towns: { code: string; label: string }[], area: string) {
  const wanted = fold(area);
  const name = (label: string) => fold(label.split(",")[0]!);
  const exact = towns.filter((t) => t.code === area.trim() || fold(t.label) === wanted);
  if (exact.length > 0) return exact;
  const byName = towns.filter((t) => name(t.label) === wanted);
  if (byName.length > 0) return byName;
  return towns.filter((t) => name(t.label).startsWith(`${wanted} `));
}

async function townProfile(ctx: ToolContext, area: string, countyLabels: string[]) {
  const meta = await readMetadata(ctx, F1015.table);
  const dims = dimensions(meta.value);
  const towns = dims.find((d) => d.code === F1015.town)!.categories;
  const year = dims.find((d) => d.code === F1015.year)!.categories.at(-1)!.code;
  const matches = pickTown(towns, area);
  if (matches.length === 0) {
    throw new ToolError("NOT_FOUND", `No county or Census 2022 town matches "${area}".`, {
      hint: `Counties: ${countyLabels.join(", ")}. Towns use CSO table F1015 names, e.g. "Ennis" or "Galway city and suburbs".`
    });
  }
  if (matches.length > 1) {
    throw new ToolError("BAD_ARGS", `"${area}" matches ${matches.length} Census 2022 towns.`, {
      hint: `Use the full name: ${matches.slice(0, 10).map((t) => t.label).join("; ")}.`
    });
  }
  const town = matches[0]!;
  const data = await readDataset(ctx, F1015.table, {
    [F1015.year]: [year],
    [F1015.town]: [town.code],
    [F1015.sex]: ["-", "1", "2"]
  });
  const decoded = rows(data.value, 100).rows;
  const value = (statistic: string, sex = "Both sexes") =>
    decoded.find((r) => r.Statistic === statistic && r.Sex === sex)?.value ?? null;
  return envelope(csoInfo, {
    data: {
      area: town.label,
      level: "town",
      code: town.code,
      table: F1015.table,
      census: [{ year, total: value("Population"), male: value("Population", "Male"), female: value("Population", "Female") }],
      age: {
        average_age: value("Average Age"),
        percent_under_15: value("Percentage Aged Under 15"),
        percent_15_to_64: value("Percentage Aged 15-64"),
        percent_65_plus: value("Percentage Aged 65 years or more")
      },
      change: null,
      note: `Town figures come from Census ${year} only (F1015), so no change is computed.`
    },
    url: tableUrl(F1015.table),
    cached: data.cached,
    stale: data.stale
  });
}

const areaProfileTool = defineTool({
  name: "cso_area_profile",
  example: { area: "Galway" },
  title: "County or town population profile",
  description:
    "Census population for a county, a town or the State. Counties use table F1001 (latest census and the previous one, by sex, with change). Other names fall back to Census 2022 towns in table F1015 (population by sex, average age and age bands). Accepts a county name ('Galway'), its F1001 code, 'State', or a town ('Ennis', 'Ennis, Co Clare').",
  inputSchema: {
    area: z.string().min(1).max(80).describe("County name, F1001 county code, 'State', or a Census 2022 town name."),
    years: z.array(z.string().regex(/^\d{4}$/)).min(1).max(10).optional().describe("Census years for counties; defaults to the two latest. Towns are 2022 only.")
  },
  handler: async ({ area, years }, ctx) => {
    const meta = await readMetadata(ctx, F1001.table);
    const dims = dimensions(meta.value);
    const counties = dims.find((d) => d.code === F1001.county)!.categories;
    const wanted = area.trim().toLowerCase().replace(/^(co\.?|county)\s+/, "");
    const county =
      counties.find((c) => c.code === area.trim()) ??
      counties.find((c) => c.label.toLowerCase() === wanted) ??
      (wanted === "ireland" ? counties.find((c) => c.code === "-") : undefined);
    if (!county) return townProfile(ctx, area, counties.map((c) => c.label));
    const available = dims.find((d) => d.code === F1001.year)!.categories.map((c) => c.code);
    const chosen = years ?? available.slice(-2);
    const missing = chosen.filter((y) => !available.includes(y));
    if (missing.length > 0) {
      throw new ToolError("BAD_ARGS", `F1001 has no census year ${missing.join(", ")}.`, {
        hint: `Census years: ${available.join(", ")}.`
      });
    }
    const data = await readDataset(ctx, F1001.table, {
      [F1001.year]: chosen,
      [F1001.county]: [county.code],
      [F1001.sex]: ["-", "1", "2"]
    });
    const decoded = rows(data.value, 100).rows;
    const byYear = chosen.map((year) => {
      const pick = (sex: string) => decoded.find((r) => r.CensusYear === year && r.Sex === sex)?.value ?? null;
      return { year, total: pick("Both sexes"), male: pick("Male"), female: pick("Female") };
    });
    const first = byYear[0]?.total;
    const last = byYear.at(-1)?.total;
    const change =
      typeof first === "number" && typeof last === "number" && byYear.length > 1
        ? { absolute: last - first, percent: Math.round(((last - first) / first) * 1000) / 10 }
        : null;
    return envelope(csoInfo, {
      data: { area: county.label, level: "county", code: county.code, table: F1001.table, census: byYear, change },
      url: tableUrl(F1001.table),
      cached: data.cached,
      stale: data.stale
    });
  }
});

async function search(query: string, max: number, ctx: ToolContext) {
  const result = await searchTables(ctx, query);
  return result.value.slice(0, max).map((t) => ({ id: `cso:${t.MtrCode}`, title: `${t.MtrTitle} (CSO ${t.MtrCode})`, url: tableUrl(t.MtrCode) }));
}

async function fetchById(key: string, ctx: ToolContext) {
  const code = normaliseTableCode(key);
  const meta = await readMetadata(ctx, code);
  const dims = dimensions(meta.value);
  const text = [
    `${meta.value.label ?? code} (CSO table ${code})`,
    meta.value.updated ? `Last updated: ${meta.value.updated}` : "",
    "Dimensions:",
    ...dims.map(
      (d) =>
        `- ${d.label} [${d.code}]: ${d.categories
          .slice(0, 30)
          .map((c) => `${c.label} (${c.code})`)
          .join(", ")}${d.categories.length > 30 ? `, … ${d.categories.length} total` : ""}`
    ),
    ...(meta.value.note ?? []).slice(0, 2).map((n) => `Note: ${n}`)
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: `cso:${code}`,
    title: meta.value.label ?? code,
    text,
    url: tableUrl(code),
    metadata: { source: csoInfo.name, licence: csoInfo.licence, attribution: csoInfo.attribution, api: metadataUrl(code) }
  };
}

export const csoModule: SourceModule = {
  info: csoInfo,
  summary: "Official statistics: census, population, prices, labour market, housing and thousands more PxStat tables.",
  domain: "stats",
  coverage: "National statistics from the CSO PxStat database: censuses (incl. 2016 and 2022), population, prices, labour market and housing, at State, county and smaller geographies.",
  tools: [searchTool, metadataTool, dataTool, areaProfileTool],
  search,
  fetchById
};
