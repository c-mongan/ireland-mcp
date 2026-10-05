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

const areaProfileTool = defineTool({
  name: "cso_area_profile",
  title: "County population profile",
  description:
    "Census population for a county or the State (table F1001): latest census and the previous one, by sex, with change. Accepts a county name (e.g. 'Galway'), its F1001 code ('19') or 'State'.",
  inputSchema: {
    area: z.string().min(1).max(60).describe("County name, F1001 county code, or 'State' for Ireland."),
    years: z.array(z.string().regex(/^\d{4}$/)).min(1).max(10).optional().describe("Census years; defaults to the two latest.")
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
    if (!county) {
      throw new ToolError("NOT_FOUND", `No F1001 county matches "${area}".`, {
        hint: `Valid areas: ${counties.map((c) => c.label).join(", ")}. F1001 uses Dublin as one county.`
      });
    }
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
      data: { area: county.label, code: county.code, table: F1001.table, census: byYear, change },
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
  tools: [searchTool, metadataTool, dataTool, areaProfileTool],
  search,
  fetchById
};
