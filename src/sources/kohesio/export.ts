import { createHash } from "node:crypto";
import { ToolError } from "../../gateway/errors.js";

export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;
export const MAX_EXPORT_ROWS = 10_000;
export const PERIODS = ["2014-2020", "2021-2027"] as const;
export type Period = typeof PERIODS[number];
export const DATA_PAGE = "https://kohesio.ec.europa.eu/en/data";
const required = ["Operation_Unique_Identifier", "Operation_Name_English", "Operation_Name_Programme_Language", "Country", "Operation_Start_Date", "Operation_End_Date", "Project_EU_Budget", "Total_Eligible_Expenditure_amount", "Total_Eligible_Expenditure_Currency", "Beneficiary_Unique_Identifier", "Beneficiary_Name", "Fund_Code", "Fund_Name", "Category_Label", "Location_Indicator_latitude_longitude", "NUTS1_Label", "NUTS2_Label", "NUTS3_Label", "NUTS1_Code", "NUTS2_Code", "NUTS3_Code", "Programming_Period", "Operation_Summary_English", "Operation_Summary_Programme_Language", "LAU_Labels"];
const invalid = (message: string): never => { throw new ToolError("UPSTREAM_DOWN", `Invalid Kohesio export: ${message}`); };

/** Strict CSV scanner: quoted commas, escaped quotes, embedded newlines, BOM and CRLF. */
export function csvRows(input: string): string[][] {
  if (Buffer.byteLength(input) > MAX_EXPORT_BYTES) invalid("byte bound exceeded.");
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ""; closed = false; };
  const pushRow = () => {
    pushField();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_EXPORT_ROWS + 1) invalid("row bound exceeded.");
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else { quoted = false; closed = true; }
      } else field += c;
    } else if (c === ",") pushField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      pushRow();
    } else if (c === '"' && field === "" && !closed) quoted = true;
    else {
      if (closed || c === '"') invalid("malformed quoting.");
      field += c;
    }
  }
  if (quoted) invalid("unterminated quoted field.");
  if (row.length || field || closed) pushRow();
  return rows;
}

const clean = (value: string | undefined) => value?.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() || null;
function money(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  // Export numbers are decimal, not locale-formatted currency strings.
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) invalid("invalid budget.");
  const n = Number(value);
  if (!Number.isFinite(n)) invalid("invalid budget.");
  return n;
}
function date(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return invalid("invalid operation date.");
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const time = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== iso) invalid("invalid operation date.");
  return iso;
}
const split = (value: string | undefined) => (value ?? "").split("|").map(clean).filter((v): v is string => v !== null);

export function parseExport(csv: string, period: Period) {
  const [header, ...rows] = csvRows(csv);
  if (!header || !rows.length) return invalid("empty export.");
  if (new Set(header).size !== header.length || required.some((key) => !header.includes(key))) invalid("missing or duplicate columns.");
  const ids = new Set<string>();
  return rows.map((values) => {
    if (values.length !== header.length) invalid("row width does not match header.");
    const row = Object.fromEntries(header.map((key, i) => [key, values[i]!]));
    const url = row.Operation_Unique_Identifier!;
    if (!/^https:\/\/linkedopendata\.eu\/entity\/Q\d+$/.test(url)) invalid("invalid project identifier.");
    if (ids.has(url)) invalid("duplicate project identifier.");
    ids.add(url);
    if (row.Country !== "Ireland" || row.Programming_Period !== period) invalid("wrong country or programming period.");
    const title = clean(row.Operation_Name_English) ?? clean(row.Operation_Name_Programme_Language);
    if (!title) return invalid("missing title.");
    const beneficiary = clean(row.Beneficiary_Name);
    const fund = clean(row.Fund_Name);
    return {
      id: url.split("/").pop()!, title,
      description: clean(row.Operation_Summary_English) ?? clean(row.Operation_Summary_Programme_Language),
      start: date(row.Operation_Start_Date), end: date(row.Operation_End_Date),
      eu_budget: money(row.Project_EU_Budget), total_budget: money(row.Total_Eligible_Expenditure_amount),
      currency: clean(row.Total_Eligible_Expenditure_Currency),
      coordinates: clean(row.Location_Indicator_latitude_longitude), country: "Ireland",
      beneficiaries: beneficiary ? [{ name: beneficiary, url: clean(row.Beneficiary_Unique_Identifier), website: null }] : [],
      funds: fund ? [{ id: clean(row.Fund_Code), label: fund, website: null }] : [],
      categories: split(row.Category_Label).slice(0, 8),
      regions: [...new Set(["NUTS1_Label", "NUTS2_Label", "NUTS3_Label", "NUTS1_Code", "NUTS2_Code", "NUTS3_Code"].flatMap((key) => split(row[key])))],
      locality: clean(row.LAU_Labels), programming_period: period, url
    };
  });
}
export type Project = ReturnType<typeof parseExport>[number];

export function exportLocation(period: Period, snapshotDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !Number.isFinite(Date.parse(snapshotDate)) || new Date(snapshotDate).toISOString().slice(0, 10) !== snapshotDate) {
    throw new ToolError("BAD_ARGS", "Use a valid export date in YYYY-MM-DD format.");
  }
  const short = period === "2014-2020" ? "14-20" : "21-27";
  const path = `data/projects-${period}/${snapshotDate}/IE-pp${short}-${snapshotDate.replaceAll("-", "")}.csv`;
  return { path, url: `https://kohesio.ec.europa.eu/api/data/object?id=${path}`, page: `${DATA_PAGE}/projects-${period}/${snapshotDate}` };
}

export function buildSnapshot(exports: Array<{ period: Period; snapshot_date: string; csv: string }>, retrievedAt: string) {
  if (exports.length !== PERIODS.length || !PERIODS.every((p) => exports.some((e) => e.period === p))) invalid("both Irish programming periods are required.");
  const projects: Project[] = [];
  const metadata = exports.map((e) => {
    const location = exportLocation(e.period, e.snapshot_date);
    const rows = parseExport(e.csv, e.period);
    projects.push(...rows);
    return { programming_period: e.period, snapshot_date: e.snapshot_date, publication_date: null,
      url: location.url, page: location.page, retrieved_at: retrievedAt,
      sha256: createHash("sha256").update(e.csv).digest("hex"), rows: rows.length,
      columns: csvRows(e.csv)[0] };
  });
  if (new Set(projects.map((p) => p.id)).size !== projects.length) invalid("duplicate ids across exports.");
  projects.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  return {
    metadata: { kind: "static_export" as const, live: false, exports: metadata,
      refresh: "Maintainer checks monthly; refresh validated dated exports and redeploy. Underlying records may update only once or twice yearly.",
      note: "Export directory dates identify snapshots, not project publication dates. Coverage is limited to the Irish country exports; absence is not evidence that a project does not exist." },
    projects
  };
}
export type Snapshot = ReturnType<typeof buildSnapshot>;
