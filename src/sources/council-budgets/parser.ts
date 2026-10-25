import * as XLSX from "xlsx";
import { ToolError } from "../../gateway/errors.js";
import { assertBoundedXlsxZip } from "../shared/xlsxZip.js";

export interface BudgetRow {
  authority: string;
  sourceAuthority: string;
  division: string;
  item: string;
  measure: "Expenditure" | "Income";
  amount: number | null;
}

export interface ParsedBudget {
  year: number;
  unit: "EUR";
  rows: BudgetRow[];
  authorityCountsByDivision: Record<string, number>;
  partial: boolean;
  unlabelledSourceValueCount: number;
  coverageNotes: string[];
}

const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_SHEETS = 40;
const MAX_ROWS_PER_SHEET = 1_000;
const MAX_CELLS = 250_000;
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function isExcelWorkbook(bytes: Uint8Array): boolean {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isOle = OLE_MAGIC.every((value, index) => bytes[index] === value);
  return isZip || isOle;
}

function readCell(row: unknown[], index: number): string | null {
  const value = row[index];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "");
}

/** Merge historical spellings of the same council while retaining each source label on the row. */
export function canonicalAuthorityName(value: string): string {
  const folded = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (folded === "dun laoire rathdown cc" || folded === "dun laoire rathdown county council"
    || folded === "dun laoghaire rathdown county council") {
    return "Dún Laoghaire-Rathdown County Council";
  }
  return value.trim();
}

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text || text === "–" || text === "—" || text === "-") return null;
  const amountPattern = "(?:\\d+|[1-9]\\d{0,2}(?:,\\d{3})+)(?:\\.\\d{1,2})?";
  const accounting = new RegExp(`^€?\\s*\\(\\s*(${amountPattern})\\s*\\)$`).exec(text);
  const ordinary = new RegExp(`^([+-]?)\\s*€?\\s*(${amountPattern})$`).exec(text);
  const parsedText = accounting?.[1] ?? ordinary?.[2];
  if (!parsedText) {
    throw new ToolError("UPSTREAM_DOWN", "The council budget workbook contains a non-numeric amount in a numeric cell.", { retryable: false });
  }
  const amount = Number(parsedText.replaceAll(",", ""));
  if (!Number.isFinite(amount)) {
    throw new ToolError("UPSTREAM_DOWN", "The council budget workbook contains a non-numeric amount in a numeric cell.", { retryable: false });
  }
  return accounting ? -amount : ordinary?.[1] === "-" ? -amount : amount;
}

function workbookBudgetYear(workbook: XLSX.WorkBook): number | null {
  const notes = workbook.Sheets.NOTES;
  if (!notes) return null;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(notes, { header: 1, defval: null, raw: false });
  for (const row of rows) {
    const index = row.findIndex((value) => typeof value === "string" && value.trim() === "Budget Year");
    if (index < 0) continue;
    const year = readCell(row, index + 1);
    if (year && /^\d{4}$/.test(year)) return Number(year);
  }
  return null;
}

function divisionForSheet(name: string): string | null {
  const match = /^Revenue I&E SVCDIV ([A-H])$/.exec(name);
  return match?.[1] ?? null;
}

const PUBLISHED_2017_BLOCK_COUNTS: Record<string, number[]> = {
  A: [31, 31, 31], B: [31, 31, 31], C: [30, 30], D: [30, 30, 31],
  E: [30, 31, 31, 31], F: [31, 31], G: [31, 31], H: [31, 31, 31]
};

function expectedCouncilCounts(year: number, division: string, blockCount: number): number[] {
  if (year === 2017) return PUBLISHED_2017_BLOCK_COUNTS[division] ?? [];
  return Array.from({ length: blockCount }, () => 31);
}

function parseDivisionSheet(sheet: XLSX.WorkSheet, division: string, year: number): {
  rows: BudgetRow[];
  councilSets: string[][];
  unlabelledSourceValueCount: number;
} {
  // Keep blank rows so the offset from the two headers and EUR row stays stable.
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const headerIndexes = data.flatMap((row, index) =>
    readCell(row, 1) === "City & County Councils"
    && data[index + 1]?.some((cell) => cell === "Expenditure")
    && data[index + 1]?.some((cell) => cell === "Income")
      ? [index]
      : []
  );
  const rows: BudgetRow[] = [];
  const councilSets: string[][] = [];
  let unlabelledSourceValueCount = 0;

  for (let blockIndex = 0; blockIndex < headerIndexes.length; blockIndex += 1) {
    const headerIndex = headerIndexes[blockIndex]!;
    const endIndex = headerIndexes[blockIndex + 1] ?? data.length;
    const categoryHeader = data[headerIndex] ?? [];
    const measureHeader = data[headerIndex + 1] ?? [];
    const unitsHeader = data[headerIndex + 2] ?? [];
    const firstDataIndex = headerIndex + 3; // Two header rows and the EUR row; some layouts add a blank row.
    const blockCouncils = new Set<string>();
    const authorityRows: Array<{ authority: string; sourceAuthority: string; row: unknown[] }> = [];
    // In 2017, the export marks two valid council rows as `summary,*`; council names remain authoritative.
    const knownUnlabelledColumns = new Set<number>();
    if (year === 2017 && division === "B" && blockIndex === 0) {
      knownUnlabelledColumns.add(10);
      knownUnlabelledColumns.add(11);
    }
    if (year === 2017 && division === "B" && blockIndex === 2) {
      knownUnlabelledColumns.add(12);
      knownUnlabelledColumns.add(13);
    }

    for (let rowIndex = firstDataIndex; rowIndex < endIndex; rowIndex += 1) {
      const row = data[rowIndex] ?? [];
      const sourceAuthority = readCell(row, 1);
      if (!sourceAuthority || sourceAuthority.toLowerCase() === "total" || !/(?:council|\bcc)$/i.test(sourceAuthority)) continue;
      const authority = canonicalAuthorityName(sourceAuthority);
      blockCouncils.add(authority);
      authorityRows.push({ authority, sourceAuthority, row });
    }

    const columnCount = Math.max(categoryHeader.length, measureHeader.length, unitsHeader.length);
    const parsedColumns = new Set<number>();
    for (let column = 2; column + 1 < columnCount; column += 1) {
      if (knownUnlabelledColumns.has(column) && knownUnlabelledColumns.has(column + 1)) continue;
      const expenditure = readCell(measureHeader, column);
      if (expenditure !== "Expenditure") continue;
      const income = readCell(measureHeader, column + 1);
      const item = readCell(categoryHeader, column);
      const totalColumn = item?.toLowerCase().includes("total for service division");
      const hasData = authorityRows.some(({ row }) =>
        [row[column], row[column + 1]].some((value) => value !== null && value !== undefined && value !== "")
      );
      if (income !== "Income") {
        if (hasData) throw new ToolError("UPSTREAM_DOWN", `The ${year} Division ${division} workbook has a changed expenditure/income header pair.`, { retryable: false });
        continue;
      }
      if (totalColumn) {
        parsedColumns.add(column);
        parsedColumns.add(column + 1);
        continue;
      }
      if (!item) {
        if (hasData) throw new ToolError("UPSTREAM_DOWN", `The ${year} Division ${division} workbook has a missing budget line header.`, { retryable: false });
        continue;
      }
      if (readCell(unitsHeader, column) !== "€" || readCell(unitsHeader, column + 1) !== "€") {
        throw new ToolError("UPSTREAM_DOWN", `The ${division} budget sheet has an unsupported unit label.`, { retryable: false });
      }
      parsedColumns.add(column);
      parsedColumns.add(column + 1);
      for (const { authority, sourceAuthority, row } of authorityRows) {
        for (const [offset, measure] of [[0, "Expenditure"], [1, "Income"]] as const) {
          const amount = parseAmount(row[column + offset]);
          // Preserve missing values as null. A published 0 stays a numeric zero.
          rows.push({ authority, sourceAuthority, division, item, measure, amount });
        }
      }
    }
    let blockUnlabelledValueCount = 0;
    for (const { row } of authorityRows) {
      for (let column = 2; column < columnCount; column += 1) {
        const value = row[column];
        if (hasValue(value) && knownUnlabelledColumns.has(column)) {
          blockUnlabelledValueCount += 1;
          continue;
        }
        if (hasValue(value) && !parsedColumns.has(column)) {
          throw new ToolError("UPSTREAM_DOWN", `The ${year} Division ${division} workbook has data in an unlabelled budget column.`, { retryable: false });
        }
      }
    }
    const expectedUnlabelledValues = year === 2017 && division === "B" && (blockIndex === 0 || blockIndex === 2) ? 62 : 0;
    if (blockUnlabelledValueCount !== expectedUnlabelledValues) {
      throw new ToolError("UPSTREAM_DOWN", `The ${year} Division ${division} table has an unexpected number of unlabelled source values.`, { retryable: false });
    }
    councilSets.push([...blockCouncils].sort());
    unlabelledSourceValueCount += blockUnlabelledValueCount;
  }
  const expectedCounts = expectedCouncilCounts(year, division, headerIndexes.length);
  const councilCounts = councilSets.map((councils) => councils.length);
  if (councilSets.length !== expectedCounts.length || councilCounts.some((count, index) => count !== expectedCounts[index])) {
    throw new ToolError("UPSTREAM_DOWN", `The ${year} Division ${division} workbook tables list unexpected council counts (${councilCounts.join(", ")}).`, { retryable: false });
  }
  return { rows, councilSets, unlabelledSourceValueCount };
}

export function parseBudgetWorkbook(bytes: Uint8Array, expectedYear: number): ParsedBudget {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_WORKBOOK_BYTES || !isExcelWorkbook(bytes)) {
    throw new ToolError("UPSTREAM_DOWN", "The council budget resource is not a supported Excel workbook.", { retryable: false });
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    assertBoundedXlsxZip(bytes);
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", raw: true, cellDates: false });
  } catch {
    throw new ToolError("UPSTREAM_DOWN", "The council budget Excel workbook could not be read.", { retryable: false });
  }
  if (workbook.SheetNames.length > MAX_SHEETS) {
    throw new ToolError("UPSTREAM_DOWN", "The council budget workbook contains too many worksheets.", { retryable: false });
  }

  let cells = 0;
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]?.["!ref"];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    cells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (range.e.r >= MAX_ROWS_PER_SHEET || cells > MAX_CELLS) {
      throw new ToolError("UPSTREAM_DOWN", "The council budget workbook exceeds the supported worksheet size.", { retryable: false });
    }
  }

  const foundYear = workbookBudgetYear(workbook);
  if (foundYear !== expectedYear) {
    throw new ToolError("UPSTREAM_DOWN", `The council budget workbook did not identify the expected budget year ${expectedYear}.`, { retryable: false });
  }

  const parsedDivisions = workbook.SheetNames.flatMap((name) => {
    const division = divisionForSheet(name);
    return division ? [{ division, ...parseDivisionSheet(workbook.Sheets[name]!, division, expectedYear) }] : [];
  });
  const rows = parsedDivisions.flatMap(({ rows: divisionRows }) => divisionRows);
  const unlabelledSourceValueCount = parsedDivisions.reduce((sum, division) => sum + division.unlabelledSourceValueCount, 0);
  if (expectedYear === 2017 && unlabelledSourceValueCount !== 124) {
    throw new ToolError("UPSTREAM_DOWN", "The 2017 budget workbook has an unexpected number of unlabelled source values.", { retryable: false });
  }
  if (expectedYear !== 2017) {
    const councilSets = parsedDivisions.flatMap(({ councilSets: sets }) => sets).map((set) => set.join("\n"));
    if (new Set(councilSets).size !== 1) {
      throw new ToolError("UPSTREAM_DOWN", `The ${expectedYear} budget workbook does not use a consistent council list across its division tables.`, { retryable: false });
    }
  }
  const rowKeys = new Set<string>();
  for (const row of rows) {
    const key = `${row.authority}\u0000${row.division}\u0000${row.item}\u0000${row.measure}`;
    if (rowKeys.has(key)) {
      throw new ToolError("UPSTREAM_DOWN", `The ${expectedYear} budget workbook repeats a council budget line.`, { retryable: false });
    }
    rowKeys.add(key);
  }
  const councilsByDivision = new Map<string, Set<string>>();
  for (const row of rows) {
    const councils = councilsByDivision.get(row.division) ?? new Set<string>();
    councils.add(row.authority);
    councilsByDivision.set(row.division, councils);
  }
  if (rows.length === 0 || councilsByDivision.size !== 8) {
    throw new ToolError("UPSTREAM_DOWN", `The ${expectedYear} budget workbook does not match the supported council division layout.`, { retryable: false });
  }
  return {
    year: expectedYear,
    unit: "EUR",
    rows,
    authorityCountsByDivision: Object.fromEntries([...councilsByDivision].map(([division, councils]) => [division, councils.size])),
    partial: expectedYear === 2017,
    unlabelledSourceValueCount,
    coverageNotes: [
      ...(expectedYear === 2015 ? ["The workbook uses two spellings for Dún Laoghaire-Rathdown County Council. Rows share one query name and retain the original source authority label."] : []),
      ...(expectedYear === 2017 ? [
        "Some published 2017 division tables list fewer than 31 councils. Missing council rows are unknown, not zero; see the source documentation for the table counts.",
        `${unlabelledSourceValueCount} unlabelled numeric source values are omitted: 62 in columns K:L of the first Division B table and 62 in columns M:N of the third. Their meaning is not verified as a budget line or a total, so returned data for 2017 is partial.`
      ] : [])
    ]
  };
}
