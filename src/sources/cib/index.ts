import { z } from "zod";
import { envelope, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule } from "../../gateway/module.js";
import { CIB_FILES, loadCibSnapshots, type CibSnapshots } from "./snapshot.js";

const ATTRIBUTION = "Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence. Credit: Citizens Information Board (Data Hub).";

export const cibInfo: SourceInfo = {
  id: "cib",
  name: "Citizens Information Board service statistics (Data Hub)",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  attribution: ATTRIBUTION,
  homepage: "https://www.citizensinformationboard.ie/en/data-hub/"
};

// Packaged JSON only. Hosted requests never fetch or scrape the CIB website.
let cached: CibSnapshots | undefined;
function load(): CibSnapshots {
  if (cached) return cached;
  try {
    cached = loadCibSnapshots();
    return cached;
  } catch (error) {
    throw new ToolError("UPSTREAM_DOWN", "The packaged CIB Data Hub snapshot could not be read.", {
      retryable: false,
      hint: `Rebuild so web/data/cib/ is copied to the package. Detail: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

/** Health of the packaged snapshot for /health/deep. */
export function snapshotHealth(): { ok: true; note: string } | { ok: false; error: string } {
  try {
    return { ok: true, note: `packaged snapshot retrieved ${load().annual.as_of}` };
  } catch {
    return { ok: false, error: "snapshot unreadable" };
  }
}

type Doc = CibSnapshots[keyof CibSnapshots];
const FILE_OF: Record<Doc["dataset"], string> = { "cib-cis-annual": CIB_FILES.annual, "cib-cis-query-categories": CIB_FILES.categories, "cib-cips": CIB_FILES.cips };
const urlOf = (doc: Doc, id: string | null): string | null => (id ? doc.sources.find((s) => s.id === id)?.url ?? null : null);

function provenance(doc: Doc, sourceIds: Array<string | null>) {
  const ids = new Set(sourceIds.filter((id): id is string => Boolean(id)));
  return {
    as_of: doc.as_of,
    attribution: doc.licence.attribution,
    credit: doc.licence.credit,
    licence_url: doc.licence.url,
    licence_notice_url: doc.licence.notice_url,
    data_hub_url: doc.data_hub_url,
    source_urls: doc.sources.filter((s) => ids.has(s.id)).map((s) => s.url),
    snapshot_file: `web/data/cib/${FILE_OF[doc.dataset]}`,
    live: false,
    notes: doc.notes
  };
}

function evidence(doc: Doc, years: Array<{ source?: string | null }>, sourceIds: Array<string | null>) {
  const single = years.length === 1 && years[0]!.source ? urlOf(doc, years[0]!.source) : null;
  return { url: single ?? doc.data_hub_url, cached: true, retrievedAt: new Date(`${doc.as_of}T00:00:00Z`), data: provenance(doc, sourceIds) };
}

function pickYears<T extends { year: number }>(rows: T[], year: number | undefined, label: string): T[] {
  if (year === undefined) return rows;
  const match = rows.filter((r) => r.year === year);
  if (!match.length) {
    throw new ToolError("NOT_FOUND", `The ${label} snapshot has no ${year} figures.`, {
      hint: `Available years: ${rows.map((r) => r.year).join(", ")}. Newer years appear only after the snapshot is refreshed.`
    });
  }
  return match;
}

const yearSchema = z.number().int().min(2000).max(2100).optional().describe("Calendar year. Omit for every year in the snapshot.");
const fold = (s: string) => s.toLocaleLowerCase("en-IE").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "");

const annualTool = defineTool({
  name: "cib_cis_annual_summary",
  title: "CIS annual callers and queries",
  description: "Annual callers and queries handled by Citizens Information Services (CIS) from the CIB Data Hub, 2021 onwards. Dated, packaged snapshot of official CIB files; not live. 2025 callers are a sum of the quarterly reports.",
  example: { year: 2025 },
  inputSchema: { year: yearSchema },
  handler: async ({ year }) => {
    const doc = load().annual;
    const years = pickYears(doc.years, year, "CIS annual");
    const ids = years.flatMap((y) => [y.callers.source, y.queries.source, ...(y.quarterly_callers ?? []).map((q) => q.callers.source)]);
    const ev = evidence(doc, years.map((y) => ({ source: y.queries.source })), ids);
    return envelope(cibInfo, {
      ...ev,
      data: {
        service: "Citizens Information Services (CIS)",
        years: years.map((y) => ({
          year: y.year,
          callers: y.callers.value,
          callers_derived: y.callers.derived,
          ...(y.callers.derived ? { callers_method: y.callers.method } : { callers_source_url: urlOf(doc, y.callers.source) }),
          queries: y.queries.value,
          queries_source_url: urlOf(doc, y.queries.source),
          ...(y.quarterly_callers ? { quarterly_callers: y.quarterly_callers.map((q) => ({ quarter: q.quarter, callers: q.callers.value, source_url: urlOf(doc, q.callers.source) })) } : {})
        })),
        ...ev.data
      },
      truncated: false
    });
  }
});

const categoriesTool = defineTool({
  name: "cib_cis_query_categories",
  title: "CIS queries by category",
  description: "Citizens Information Services queries by top-level category (Social Welfare, Housing, Health, Money and Tax…) per year from the CIB Data Hub. Filter by year and/or category for a time series. Dated snapshot; not live.",
  example: { year: 2025, category: "Housing" },
  inputSchema: {
    year: yearSchema,
    category: z.string().trim().min(2).max(60).optional().describe("Top-level category, e.g. Social Welfare, Housing, Money and Tax. Case-insensitive.")
  },
  handler: async ({ year, category }) => {
    const doc = load().categories;
    const years = pickYears(doc.years, year, "CIS query category");
    if (category) {
      const wanted = fold(category);
      const series = years.flatMap((y) => y.categories.filter((c) => fold(c.category) === wanted || fold(c.source_label) === wanted).map((c) => ({ y, c })));
      if (!series.length) {
        const names = [...new Set(doc.years.flatMap((y) => y.categories.map((c) => c.category)))];
        throw new ToolError("NOT_FOUND", `No CIS query category named '${category}'${year ? ` in ${year}` : ""}.`, { hint: `Categories: ${names.join(", ")}.` });
      }
      const ev = evidence(doc, series.map(({ y }) => ({ source: y.source })), series.map(({ y }) => y.source));
      return envelope(cibInfo, {
        ...ev,
        data: {
          service: "Citizens Information Services (CIS)",
          category: series[0]!.c.category,
          series: series.map(({ y, c }) => ({
            year: y.year, queries: c.queries.value, share_percent: c.share_percent, year_total_queries: y.total_queries.value,
            source_label: c.source_label, source_url: urlOf(doc, y.source)
          })),
          ...ev.data
        },
        truncated: false
      });
    }
    const ev = evidence(doc, years, years.map((y) => y.source));
    return envelope(cibInfo, {
      ...ev,
      data: {
        service: "Citizens Information Services (CIS)",
        years: years.map((y) => ({
          year: y.year, total_queries: y.total_queries.value, source_url: urlOf(doc, y.source),
          categories: y.categories.map((c) => ({ category: c.category, source_label: c.source_label, queries: c.queries.value, share_percent: c.share_percent }))
        })),
        ...ev.data
      },
      truncated: false
    });
  }
});

const cipsTool = defineTool({
  name: "cib_cips_summary",
  title: "Citizens Information Phone Service summary",
  description: "Citizens Information Phone Service (CIPS) contacts by mode (telephone, webchat, social media) and categorised calls by main category per year from the CIB Data Hub, 2021 onwards. Dated snapshot; not live.",
  example: { year: 2025 },
  inputSchema: { year: yearSchema },
  handler: async ({ year }) => {
    const doc = load().cips;
    const years = pickYears(doc.years, year, "CIPS");
    const ev = evidence(doc, years, years.map((y) => y.source));
    return envelope(cibInfo, {
      ...ev,
      data: {
        service: "Citizens Information Phone Service (CIPS)",
        years: years.map((y) => ({
          year: y.year,
          contacts: {
            telephone: y.contacts.telephone.value, webchat: y.contacts.webchat.value, social_media: y.contacts.social_media.value,
            total: y.contacts.total.value, total_basis: y.contacts.total.basis
          },
          categorised_calls: y.categorised_calls.value,
          categories: y.categories.map((c) => ({
            category: c.category, source_label: c.source_label, calls: c.calls.value, share_percent: c.share_percent,
            ...(c.subcategory_table_total ? { subcategory_table_total: c.subcategory_table_total.value, note: c.note } : {})
          })),
          year_notes: y.notes,
          source_url: urlOf(doc, y.source)
        })),
        ...ev.data
      },
      truncated: false
    });
  }
});

export const cibModule: SourceModule = {
  info: cibInfo,
  summary: "Citizens Information Board Data Hub service statistics: CIS callers, queries by category and Citizens Information Phone Service contacts. Dated official snapshot, not the citizensinformation.ie guidance pages.",
  domain: "stats",
  coverage: "Annual figures for 2021–2025 from the official CIB Data Hub Word files and summary pages, pinned with SHA-256 checksums in web/data/cib/. Refreshed by scripts/refresh-cib-snapshot.mjs; not live.",
  tools: [annualTool, categoriesTool, cipsTool]
};

