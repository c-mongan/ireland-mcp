import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { CIB_ATTRIBUTION, CIB_LICENCE, categoryKey, cipsDataset, cisAnnualDataset, cisCategoryDataset } from "./schema.js";

export const cibInfo: SourceInfo = {
  id: "cib", name: "Citizens Information Board Data Hub",
  licence: CIB_LICENCE,
  attribution: CIB_ATTRIBUTION,
  homepage: "https://www.citizensinformationboard.ie/en/data-hub/"
};

/** The public site serves the same files the tools read: web/data/cib/*.json. */
export const CIB_PUBLIC_DATA = "https://irishopendata.ie/data/cib/";
const FILES = { annual: "cis-annual.json", categories: "cis-query-categories.json", cips: "cips-annual.json" } as const;
const SCHEMAS = { annual: cisAnnualDataset, categories: cisCategoryDataset, cips: cipsDataset };
type Kind = keyof typeof FILES;

// Resolves to web/data/cib from src and to dist/web/data/cib from the build (scripts/copy-assets.mjs).
const cache = new Map<Kind, { data: unknown; sha256: string }>();
function load<K extends Kind>(kind: K): { data: z.infer<(typeof SCHEMAS)[K]>; sha256: string } {
  let entry = cache.get(kind);
  if (!entry) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(new URL(`../../../web/data/cib/${FILES[kind]}`, import.meta.url));
    } catch {
      throw new ToolError("UPSTREAM_DOWN", `The packaged CIB snapshot ${FILES[kind]} is missing.`);
    }
    const parsed = SCHEMAS[kind].safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) throw new ToolError("UPSTREAM_DOWN", `The packaged CIB snapshot ${FILES[kind]} failed validation.`);
    entry = { data: parsed.data, sha256: createHash("sha256").update(bytes).digest("hex") };
    cache.set(kind, entry);
  }
  return entry as { data: z.infer<(typeof SCHEMAS)[K]>; sha256: string };
}

/** Health of the packaged snapshots, used by the deep health check. */
export function snapshotHealth(): { ok: true; note: string } | { ok: false; error: string } {
  try {
    const asOf = (Object.keys(FILES) as Kind[]).map((k) => load(k).data.as_of);
    return { ok: true, note: `packaged CIB snapshots as of ${asOf.sort()[0]}` };
  } catch {
    return { ok: false, error: "CIB snapshot unreadable or invalid" };
  }
}

function snapshotMeta(kind: Kind) {
  const { data, sha256 } = load(kind);
  return {
    title: data.title, publisher: data.publisher, as_of: data.as_of, landing_page: data.landing_page,
    public_file: `${CIB_PUBLIC_DATA}${FILES[kind]}`, file_sha256: sha256,
    licence: data.licence, licence_url: data.licence_url, reuse_notice: data.reuse_notice, notes: data.notes
  };
}
function retrieved(sources: Array<{ retrieved_at: string }>) {
  return new Date(sources.map((s) => s.retrieved_at).sort()[0]!);
}
function byYear<T extends { year: number }>(records: T[], year: number, what: string): T {
  const record = records.find((r) => r.year === year);
  if (!record) throw new ToolError("NOT_FOUND", `No ${what} record for ${year}.`, {
    hint: `Available years: ${records.map((r) => r.year).join(", ")}. This is a dated snapshot of published annual reports.`
  });
  return record;
}
const yearArg = z.number().int().min(2000).max(2100);

const annualTool = defineTool({
  name: "cib_cis_annual_summary", title: "Citizens Information Services callers and queries",
  description: "National callers and queries handled by Citizens Information Services for one year, or a compact series when year is omitted. From pinned, checksummed Citizens Information Board reports; not live data.",
  example: { year: 2025 },
  inputSchema: { year: yearArg.optional().describe("Report year, e.g. 2025. Omit for the full series without per-record sources.") },
  handler: async ({ year }) => {
    const { records } = load("annual").data;
    if (year === undefined) {
      const series = records.map(({ sources: _s, checks: _c, callers_derivation: _d, ...r }) => r);
      return envelope(cibInfo, { url: load("annual").data.landing_page, cached: true, retrievedAt: retrieved(records.flatMap((r) => r.sources)),
        data: { series, snapshot: snapshotMeta("annual"), hint: "Pass year for the source files, checksums and checks behind one record." } });
    }
    const record = byYear(records, year, "CIS annual");
    return envelope(cibInfo, { url: record.sources[0]!.url, cached: true, retrievedAt: retrieved(record.sources), data: { record, snapshot: snapshotMeta("annual") } });
  }
});

const categoriesTool = defineTool({
  name: "cib_cis_query_categories", title: "Citizens Information Services queries by category",
  description: "Queries per top-level category (Social Welfare, Housing, Health…) handled by Citizens Information Services in one year, from the published Table 1. Optional category filter. National totals only; not live data.",
  example: { year: 2025, category: "housing" },
  inputSchema: {
    year: yearArg.describe("Report year, e.g. 2025."),
    category: z.string().min(2).max(80).optional().describe("Case-insensitive category name or key, e.g. 'Housing' or 'money-and-tax'.")
  },
  handler: async ({ year, category }) => {
    const record = byYear(load("categories").data.records, year, "CIS query category");
    let categories = record.categories;
    if (category) {
      const key = categoryKey(category);
      categories = categories.filter((c) => c.category_key.includes(key));
      if (!categories.length) throw new ToolError("NOT_FOUND", `No ${year} category matches '${category}'.`, {
        hint: `Categories: ${record.categories.map((c) => c.category_key).join(", ")}.`
      });
    }
    return envelope(cibInfo, { url: record.sources[0]!.url, cached: true, retrievedAt: retrieved(record.sources),
      data: { record: { ...record, categories }, snapshot: snapshotMeta("categories") } });
  }
});

const cipsTool = defineTool({
  name: "cib_cips_summary", title: "Citizens Information Phone Service contacts and call categories",
  description: "Citizens Information Phone Service contacts by mode and categorised calls by top-level category for one year, or a compact series when year is omitted. The published 'calls answered' definition changed in 2024; compare years with contacts.total.",
  example: { year: 2025 },
  inputSchema: { year: yearArg.optional().describe("Report year, e.g. 2025. Omit for the contacts series.") },
  handler: async ({ year }) => {
    const { records } = load("cips").data;
    if (year === undefined) {
      const series = records.map((r) => ({ year: r.year, contacts: r.contacts, calls_answered_published: r.calls_answered_published,
        calls_answered_basis: r.calls_answered_basis, categorised_calls_total: r.categorised_calls_total }));
      return envelope(cibInfo, { url: load("cips").data.landing_page, cached: true, retrievedAt: retrieved(records.flatMap((r) => r.sources)),
        data: { series, snapshot: snapshotMeta("cips"), hint: "Pass year for call categories, source files, checksums and checks." } });
    }
    const record = byYear(records, year, "CIPS");
    return envelope(cibInfo, { url: record.sources[0]!.url, cached: true, retrievedAt: retrieved(record.sources), data: { record, snapshot: snapshotMeta("cips") } });
  }
});

export const cibModule: SourceModule = {
  info: cibInfo,
  summary: "National Citizens Information Services and Phone Service caller, query and category statistics from pinned Citizens Information Board reports (2021–2025); not live data.",
  domain: "stats",
  coverage: "Annual national aggregates transcribed from official CIB Data Hub DOCX reports, with per-file SHA-256 checksums, consistency checks and methodology notes. No county breakdown. Also published as JSON at https://irishopendata.ie/data/cib/.",
  tools: [annualTool, categoriesTool, cipsTool]
};
