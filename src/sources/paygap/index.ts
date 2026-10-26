import { z } from "zod";
import { DAY } from "../../gateway/context.js";
import { envelope, MAX_LIMIT, type SourceInfo } from "../../gateway/envelope.js";
import { ToolError } from "../../gateway/errors.js";
import { defineTool, type SourceModule, type ToolContext } from "../../gateway/module.js";
import { csvRows } from "../shared/csv.js";
import { ANNOTATION_FIELDS, METRIC_FIELDS, metricValue, type PayGapReport } from "./model.js";
import { resolveGithubSnapshot, parseGithubReports, REFRESH_INTERVAL_SECONDS, type GithubSnapshot } from "./github.js";

const DATA_URL = "https://paygap.ie/downloads/annotated";
const CSV_MAX_BYTES = 5 * 1024 * 1024;

export const paygapInfo: SourceInfo = {
  id: "paygap",
  name: "Irish Gender Pay Gap Portal (PayGap.ie)",
  licence: "CC0 1.0",
  attribution: "Source: Irish Gender Pay Gap Portal (PayGap.ie). Dataset: https://github.com/zenbuffy/irishGenderPayGap (CC0 1.0; attribution requested).",
  homepage: "https://paygap.ie/downloads"
};

const HEADERS = [
  "Company Name", "NACE Section", "NACE Letter", "NACE Division", "Company Site", "Report Link", "Report Year",
  "Mean Hourly Gap", "Median Hourly Gap", "Mean Bonus Gap", "Median Bonus Gap", "Mean Hourly Gap Part Time",
  "Median Hourly Gap Part Time", "Mean Hourly Gap Part Temp", "Median Hourly Gap Part Temp", "Percentage Bonus Paid Female",
  "Percentage Bonus Paid Male", "Percentage BIK Paid Female", "Percentage BIK Paid Male", "Q1 Female", "Q1 Male",
  "Q2 Female", "Q2 Male", "Q3 Female", "Q3 Male", "Q4 Female", "Q4 Male", "Percentage Employees Female",
  "Percentage Employees Male", "Board Exec Female", "Board Exec Male", "Board Non-Exec Female", "Board Non-Exec Male",
  "Late Filing", "Report Removed", "Govt Employer Removed", "Data Missing", "Incomplete", "Quartile Error", "No Narrative", "Notes"
] as const;

function parseReports(text: string): PayGapReport[] {
  const rows = csvRows(text, "PayGap annotated dataset");
  const header = rows[0];
  if (!header || header.length !== HEADERS.length || header.some((value, i) => value !== HEADERS[i])) {
    throw new ToolError("UPSTREAM_DOWN", "PayGap.ie returned an unexpected CSV header.", { retryable: false });
  }
  return rows.slice(1).map((row, index) => {
    if (row.length !== HEADERS.length || !row[0]?.trim() || !/^\d{4}$/.test(row[6] ?? "")) {
      throw new ToolError("UPSTREAM_DOWN", `PayGap.ie returned an invalid report row at CSV row ${index + 2}.`, { retryable: false });
    }
    const byName = Object.fromEntries(HEADERS.map((name, i) => [name, row[i]!])) as Record<(typeof HEADERS)[number], string>;
    const metrics = Object.fromEntries(METRIC_FIELDS.map((name, i) => [name, metricValue(row[i + 7]!)])) as PayGapReport["metrics"];
    const annotations = Object.fromEntries(ANNOTATION_FIELDS.map((name, i) => [name, row[i + 33]!])) as PayGapReport["annotations"];
    return {
      source_row: index + 2,
      company_name: byName["Company Name"],
      nace_section: byName["NACE Section"],
      nace_letter: byName["NACE Letter"],
      nace_division: byName["NACE Division"],
      company_site: byName["Company Site"] || null,
      report_link: byName["Report Link"] || null,
      report_year: Number(byName["Report Year"]),
      metrics,
      annotations
    };
  });
}

type LoadedDataset = { reports: PayGapReport[]; url: string; fallback?: GithubSnapshot & { excluded_reports: { invalid_or_missing_year: number }; annotations_available: false } };

async function loadReports(ctx: ToolContext) {
  const result = await ctx.cache.getOrLoad<LoadedDataset>(`paygap:dataset:v3:${DATA_URL}`, REFRESH_INTERVAL_SECONDS * 1000, async () => {
    let text: string;
    try {
      text = await ctx.http.text(DATA_URL, { label: "PayGap.ie annotated dataset", maxBytes: CSV_MAX_BYTES });
    } catch (error) {
      // Only the observed access refusal enables the publisher's public snapshot.
      // A successful response with a bad schema must still fail validation below.
      if (!(error instanceof ToolError) || error.httpStatus !== 403) throw error;
      const snapshot = await resolveGithubSnapshot(ctx);
      // Immutable content can be reused after a fresh revision check; it cannot change under this SHA.
      const content = await ctx.cache.getOrLoad(`paygap:github-csv:v1:${snapshot.snapshot_commit}`, 30 * DAY, async () => {
        const text = await ctx.http.text(snapshot.source_urls[0], { label: "PayGap publisher GitHub CSV", maxBytes: CSV_MAX_BYTES });
        return parseGithubReports(text);
      });
      const parsed = content.value;
      return { reports: parsed.reports, url: snapshot.source_urls[0], fallback: { ...snapshot, snapshot_checked_at: ctx.now().toISOString(), excluded_reports: parsed.excluded_reports, annotations_available: parsed.annotations_available } };
    }
    return { reports: parseReports(text), url: DATA_URL };
  });
  return { ...result.value, cached: result.cached, stale: result.stale };
}

const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("en");
const matchesIndustry = (report: PayGapReport, query: string) => {
  if (/^[a-z]$/.test(query)) return fold(report.nace_letter) === query;
  return fold(report.nace_letter) === query || fold(report.nace_division) === query || fold(report.nace_section).includes(query);
};

const searchTool = defineTool({
  name: "paygap_search_reports",
  title: "Search Irish gender pay gap reports",
  description: "Search the combined PayGap.ie employer report dataset by company name, report year and/or NACE industry. Returns submitted report figures, source report links and source annotations when available. If the primary export refuses access, the latest publisher CSV commit is rechecked after a one-hour cache expires and downloaded by its immutable revision, with explicit snapshot dates and annotation limits. Coverage and completeness are as published by PayGap.ie; the data is not a census of all employers and does not prove discrimination or equal pay.",
  example: { company: "AIB", year: 2025, limit: 10 },
  inputSchema: {
    company: z.string().max(120).optional().describe("Case-insensitive company-name fragment."),
    year: z.number().int().min(2000).max(2100).optional().describe("Exact report year."),
    industry: z.string().max(120).optional().describe("Case-insensitive NACE section, letter or division fragment."),
    limit: z.number().int().min(1).max(MAX_LIMIT).default(50).describe("Maximum reports to return (1-500)."),
    offset: z.number().int().min(0).max(10_000).default(0).describe("Number of matching reports to skip.")
  },
  handler: async ({ company, year, industry, limit, offset }, ctx) => {
    const loaded = await loadReports(ctx);
    const companyQuery = fold(company ?? "");
    const industryQuery = fold(industry ?? "");
    const matches = loaded.reports.filter((report) =>
      (!companyQuery || fold(report.company_name).includes(companyQuery)) &&
      (year === undefined || report.report_year === year) &&
      (!industryQuery || matchesIndustry(report, industryQuery))
    );
    const reports = matches.slice(offset, offset + limit);
    return envelope(loaded.fallback ? { ...paygapInfo, name: `${paygapInfo.name} — publisher snapshot`, attribution: `${paygapInfo.attribution} Snapshot: ${loaded.fallback.snapshot_published_at}; publication annotations unavailable.` } : paygapInfo, {
      data: {
        total_reports: matches.length,
        offset,
        metric_unit: "percent",
        measurement_kind: "employer_reported",
        population_coverage: "not_established",
        dataset: {
          total_reports: loaded.reports.length,
          available_years: [...new Set(loaded.reports.map((report) => report.report_year))].sort((a, b) => b - a),
          ...(loaded.fallback ? { ...loaded.fallback, refresh_status: loaded.stale ? "failed_using_last_valid" : loaded.cached ? "cached" : "validated" } : {})
        },
        next_offset: offset + reports.length < matches.length ? offset + reports.length : null,
        reports
      },
      url: loaded.url,
      cached: loaded.cached,
      stale: loaded.stale,
      truncated: offset + reports.length < matches.length
    });
  }
});

export const paygapModule: SourceModule = {
  info: paygapInfo,
  summary: "Irish employer pay-gap reports: annotated export or an explicitly dated publisher snapshot when access is refused.",
  domain: "economy",
  coverage: "Combined employer report records and publication annotations supplied by PayGap.ie. Coverage and completeness are as published; records do not establish population coverage or causation.",
  tools: [searchTool]
};
