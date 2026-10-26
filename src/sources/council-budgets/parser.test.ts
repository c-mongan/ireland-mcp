import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBudgetWorkbook } from "./parser.js";

const workbook = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)));
const withCells = (values: Record<string, unknown>) => {
  const wb = XLSX.read(workbook("budget-2026.xlsx"), { type: "buffer" });
  const sheet = wb.Sheets["Revenue I&E SVCDIV A"]!;
  for (const [address, value] of Object.entries(values)) {
    if (value === null) delete sheet[address];
    else sheet[address] = { t: typeof value === "number" ? "n" : "s", v: value };
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};
/** Changes Carlow's first Division A line and moves its published division total by the same amount. */
const withCarlowLine = (value: string | null, delta: number) => {
  const original = XLSX.read(workbook("budget-2026.xlsx"), { type: "buffer" }).Sheets["Revenue I&E SVCDIV A"]!;
  return withCells({ C42: value, K120: Number(original.K120!.v) + delta });
};
const with2017Cells = (values: Record<string, unknown>) => {
  const wb = XLSX.read(workbook("budget-2017.xls"), { type: "buffer" });
  const sheet = wb.Sheets["Revenue I&E SVCDIV B"]!;
  for (const [address, value] of Object.entries(values)) {
    if (value === null) delete sheet[address];
    else sheet[address] = { t: typeof value === "number" ? "n" : "s", v: value };
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};

describe("council budget workbook parser", () => {
  it("reads council division rows from the official 2026 XLSX and reconciles a published category total", () => {
    const budget = parseBudgetWorkbook(workbook("budget-2026.xlsx"), 2026);
    const carlow = budget.rows.find((row) => row.authority === "Carlow County Council" && row.division === "A"
      && row.item === "Maintenance/Improvement of LA Housing Units" && row.measure === "Expenditure");

    expect(budget.year).toBe(2026);
    expect(budget.unit).toBe("EUR");
    expect(carlow?.amount).toBe(4_309_186.99);

    const itemRows = budget.rows.filter((row) => row.division === "A"
      && row.item === "Maintenance/Improvement of LA Housing Units" && row.measure === "Expenditure");
    expect(itemRows).toHaveLength(31);
    const preciseTotal = itemRows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    expect(Math.round(preciseTotal)).toBe(496_283_852);
    expect(preciseTotal).toBeCloseTo(496_283_851.92);
    expect(budget.rows.some((row) => row.authority === "Total")).toBe(false);
    expect(budget.rows.some((row) => row.amount === 0)).toBe(true);
  });

  it("reads legacy XLS workbooks through the same parser", () => {
    const budget = parseBudgetWorkbook(workbook("budget-2016.xls"), 2016);
    const carlow = budget.rows.find((row) => row.authority === "Carlow County Council" && row.division === "A"
      && row.item === "Maintenance/Improvement of LA Housing Units" && row.measure === "Expenditure");
    expect(carlow?.amount).toBe(1_753_628.36);
  });

  it("merges 2015 Dún Laoghaire-Rathdown aliases and keeps each source label", () => {
    const budget = parseBudgetWorkbook(workbook("budget-2015.xls"), 2015);
    const rows = budget.rows.filter((row) => row.authority === "Dún Laoghaire-Rathdown County Council" && row.division === "A");
    expect(rows).toHaveLength(22);
    expect(new Set(rows.map((row) => row.item)).size).toBe(11);
    expect(new Set(rows.map((row) => row.sourceAuthority))).toEqual(new Set([
      "Dun Laoire/Rathdown CC",
      "Dun Laoire/Rathdown County Council"
    ]));
  });

  it("reports the incomplete division tables published in the 2017 workbook", () => {
    const budget = parseBudgetWorkbook(workbook("budget-2017.xls"), 2017);
    expect(budget.authorityCountsByDivision.C).toBe(30);
    expect(budget.partial).toBe(true);
    expect(budget.unlabelledSourceValueCount).toBe(124);
    expect(budget.coverageNotes.join(" ")).toMatch(/124 unlabelled numeric source values/);
    expect(budget.coverageNotes.join(" ")).toMatch(/not verified as a budget line or a total/);
  });

  it("rejects a 2017 source whose known unlabelled-value count changed", () => {
    expect(() => parseBudgetWorkbook(with2017Cells({ K40: null }), 2017)).toThrow(/unlabelled source values/);
  });

  it("rejects HTML and malformed bytes instead of returning an empty budget", () => {
    expect(() => parseBudgetWorkbook(Buffer.from("<html>Not a workbook</html>"), 2026)).toThrow(/Excel workbook/i);
    expect(() => parseBudgetWorkbook(Buffer.from("PK\u0003\u0004not a workbook"), 2026)).toThrow(/archive is malformed|could not be read/i);
  });

  it("rejects an unexpected currency scale rather than labelling it as EUR", () => {
    expect(() => parseBudgetWorkbook(withCells({ C40: "€000" }), 2026)).toThrow(/unit label/);
  });

  it("rejects non-numeric budget amounts rather than dropping those cells", () => {
    expect(() => parseBudgetWorkbook(withCells({ C42: "pending" }), 2026)).toThrow(/non-numeric amount/);
    expect(() => parseBudgetWorkbook(withCells({ C42: "1,2,3" }), 2026)).toThrow(/non-numeric amount/);
    expect(() => parseBudgetWorkbook(withCells({ C42: "€1€2" }), 2026)).toThrow(/non-numeric amount/);
  });

  it("accepts valid formatted zero and accounting-negative amounts", () => {
    const original = Number(XLSX.read(workbook("budget-2026.xlsx"), { type: "buffer" }).Sheets["Revenue I&E SVCDIV A"]!.C42!.v);
    const zero = parseBudgetWorkbook(withCarlowLine("€0.00", -original), 2026);
    const negative = parseBudgetWorkbook(withCarlowLine("(1,234.56)", -original - 1_234.56), 2026);
    expect(zero.rows.find((row) => row.authority === "Carlow County Council" && row.division === "A"
      && row.item === "Maintenance/Improvement of LA Housing Units" && row.measure === "Expenditure")?.amount).toBe(0);
    expect(negative.rows.find((row) => row.authority === "Carlow County Council" && row.division === "A"
      && row.item === "Maintenance/Improvement of LA Housing Units" && row.measure === "Expenditure")?.amount).toBe(-1_234.56);
  });

  it("rejects changed council headers rather than returning partial data", () => {
    expect(() => parseBudgetWorkbook(withCells({ B38: "Authorities", B77: "Authorities", B116: "Authorities" }), 2026)).toThrow(/layout/);
    expect(() => parseBudgetWorkbook(withCells({ C38: null }), 2026)).toThrow(/missing budget line header/);
    expect(() => parseBudgetWorkbook(withCells({ D39: "Revenue" }), 2026)).toThrow(/changed expenditure\/income header/);
    expect(() => parseBudgetWorkbook(withCells({ C38: "Housing Assessment, Allocation and Transfer" }), 2026)).toThrow(/repeats a council budget line/);
    expect(() => parseBudgetWorkbook(withCells({ K42: 123 }), 2026)).toThrow(/unlabelled budget column/);
  });

  it("rejects a dropped table or a changed line value instead of returning an incomplete budget", () => {
    // Renaming the first table's council heading drops that whole table from the parse.
    expect(() => parseBudgetWorkbook(withCells({ B38: "Local Authorities" }), 2026)).toThrow(/reconcile|council counts|consistent council list/);
    expect(() => parseBudgetWorkbook(withCells({ C42: 1 }), 2026)).toThrow(/reconcile with the published division totals/);
  });

  it("accepts a total exactly five cents off and rejects six", () => {
    const total = Number(XLSX.read(workbook("budget-2026.xlsx"), { type: "buffer" }).Sheets["Revenue I&E SVCDIV A"]!.K120!.v);
    expect(() => parseBudgetWorkbook(withCells({ K120: total + 0.05 }), 2026)).not.toThrow();
    expect(() => parseBudgetWorkbook(withCells({ K120: total - 0.05 }), 2026)).not.toThrow();
    expect(() => parseBudgetWorkbook(withCells({ K120: total + 0.06 }), 2026)).toThrow(/reconcile/);
  });

  it("keeps a blank numeric cell as null", () => {
    const original = Number(XLSX.read(workbook("budget-2026.xlsx"), { type: "buffer" }).Sheets["Revenue I&E SVCDIV A"]!.C42!.v);
    const budget = parseBudgetWorkbook(withCarlowLine(null, -original), 2026);
    expect(budget.rows.find((row) => row.authority === "Carlow County Council" && row.division === "A"
      && row.item === "Maintenance/Improvement of LA Housing Units" && row.measure === "Expenditure")?.amount).toBeNull();
  });
});
