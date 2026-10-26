import { ToolError } from "../../gateway/errors.js";
import { csvRows } from "../shared/csv.js";
import { ANNOTATION_FIELDS, METRIC_FIELDS, metricValue, type PayGapReport } from "./model.js";

const SNAPSHOT = "a35d6c57d54528d1bd2e339179eab048543fd993";
const BASE = `https://raw.githubusercontent.com/zenbuffy/irishGenderPayGap/${SNAPSHOT}/`;
export const GITHUB_SOURCE = {
  fallback: true,
  snapshot_commit: SNAPSHOT,
  snapshot_published_at: "2026-10-12T03:00:09Z",
  source_urls: [`${BASE}fullDenormalised.csv`] as const,
  coverage_note: "Publisher GitHub snapshot used because the primary export returned HTTP 403. Its coverage and update date may differ from the current PayGap.ie export. The report list and NACE labels come from fullDenormalised.csv. This export does not contain publication annotations; null flags mean unavailable, not false. Reports with an invalid or missing year are excluded."
} as const;

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
  return { reports, excluded_reports: { invalid_or_missing_year: excludedYear }, annotations_available: false as const };
}
