import type { ToolContext } from "../../gateway/module.js";
import { ToolError } from "../../gateway/errors.js";
import { csvRows } from "../shared/csv.js";
import { ANNOTATION_FIELDS, METRIC_FIELDS, metricValue, type PayGapReport } from "./model.js";

export const GITHUB_COMMITS_URL = "https://api.github.com/repos/zenbuffy/irishGenderPayGap/commits?sha=main&path=fullDenormalised.csv&per_page=1";
/** Liveness probe only. Data requests always use the immutable commit URL resolved below. */
export const GITHUB_HEALTH_URL = "https://raw.githubusercontent.com/zenbuffy/irishGenderPayGap/main/fullDenormalised.csv";
export const REFRESH_INTERVAL_SECONDS = 3600;

export interface GithubSnapshot {
  fallback: true;
  snapshot_commit: string;
  /** Kept for response compatibility; its exact meaning is given by snapshot_date_basis. */
  snapshot_published_at: string;
  snapshot_date_basis: "git_committer_timestamp";
  snapshot_checked_at: string;
  refresh_interval_seconds: number;
  refresh_mode: "on_request";
  source_urls: [string];
  coverage_note: string;
}

export async function resolveGithubSnapshot(ctx: ToolContext): Promise<GithubSnapshot> {
  const response = await ctx.http.json<unknown>(GITHUB_COMMITS_URL, {
    label: "PayGap publisher revision", maxBytes: 100_000,
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" }
  });
  const entry = Array.isArray(response) && response.length === 1 ? response[0] : undefined;
  const sha: unknown = entry?.sha;
  const date: unknown = entry?.commit?.committer?.date;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)
    || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().replace(".000Z", "Z") !== date.replace(".000Z", "Z")) {
    throw new ToolError("UPSTREAM_DOWN", "PayGap publisher returned invalid CSV revision metadata.", { retryable: false });
  }
  return {
    fallback: true,
    snapshot_commit: sha,
    snapshot_published_at: date,
    snapshot_date_basis: "git_committer_timestamp",
    snapshot_checked_at: ctx.now().toISOString(),
    refresh_interval_seconds: REFRESH_INTERVAL_SECONDS,
    refresh_mode: "on_request",
    source_urls: [`https://raw.githubusercontent.com/zenbuffy/irishGenderPayGap/${sha}/fullDenormalised.csv`],
    coverage_note: "Publisher GitHub snapshot used because the primary export returned HTTP 403. The snapshot date is the CSV's Git commit timestamp, not the time it was checked or a reporting period. Coverage may differ from the website export. Publication annotations are unavailable: null flags do not mean false. Invalid or missing report years are excluded. Refresh is checked on the first request after one hour, not by a background job."
  };
}

const CURATED_HEADERS = "Company Name,Company Site,NACE Sections Name,NACE Sections Letter,NACE Division Code,Report Link,Report Year,Mean Hourly Gap,Median Hourly Gap,Mean Bonus Gap,Median Bonus Gap,Mean Hourly Gap Part Time,Median Hourly Gap Part Time,Mean Hourly Gap Part Temp,Median Hourly Gap Part Temp,Percentage Bonus Paid Female,Percentage Bonus Paid Male,Percentage BIK Paid Female,Percentage BIK Paid Male,Q1 Female,Q1 Male,Q2 Female,Q2 Male,Q3 Female,Q3 Male,Q4 Female,Q4 Male,Percentage Employees Female,Percentage Employees Male,Board Exec Female,Board Exec Male,Board Non-Exec Female,Board Non-Exec Male".split(",");
function invalid(detail: string): never {
  throw new ToolError("UPSTREAM_DOWN", `Invalid PayGap publisher GitHub CSV: ${detail}`, { retryable: false });
}

function records(text: string, headers: string[]): Record<string, string>[] {
  const rows = csvRows(text, "PayGap publisher GitHub CSV");
  if (!rows[0] || rows[0].length !== headers.length || rows[0].some((value, i) => value !== headers[i])) invalid("unexpected header.");
  if (rows.length < 2) invalid("no data rows.");
  return rows.slice(1).map((row, index) => {
    if (row.length !== headers.length) invalid(`wrong field count at CSV row ${index + 2}.`);
    return Object.fromEntries(headers.map((header, i) => [header, row[i]!]));
  });
}

type GithubReport = PayGapReport & { annotations_available: false };

export function parseGithubReports(curatedText: string) {
  const reports: GithubReport[] = [];
  let excludedYear = 0;
  for (const [index, row] of records(curatedText, CURATED_HEADERS).entries()) {
    const year = row["Report Year"]!;
    if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) { excludedYear += 1; continue; }
    const name = row["Company Name"]!;
    if (!name.trim()) invalid(`missing company name at CSV row ${index + 2}.`);
    reports.push({
      source_row: index + 2,
      company_name: name,
      company_site: row["Company Site"] || null,
      nace_section: row["NACE Sections Name"]!,
      nace_letter: row["NACE Sections Letter"]!,
      nace_division: row["NACE Division Code"]!,
      report_link: row["Report Link"] || null,
      report_year: Number(year),
      metrics: Object.fromEntries(METRIC_FIELDS.map((field, i) => [field, metricValue(row[CURATED_HEADERS[i + 7]!]!)])) as PayGapReport["metrics"],
      annotations_available: false,
      annotations: Object.fromEntries(ANNOTATION_FIELDS.map((field) => [field, null])) as PayGapReport["annotations"]
    });
  }
  if (!reports.length) invalid("no valid report years.");
  return { reports, excluded_reports: { invalid_or_missing_year: excludedYear }, annotations_available: false as const };
}
