import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callTool } from "../../../test/helpers/callTool.js";
import { createContext } from "../../gateway/context.js";
import { councilBudgetsModule } from "./index.js";

const currentWorkbook = () => readFileSync(fileURLToPath(new URL("./fixtures/budget-2026.xlsx", import.meta.url)));
const historicalWorkbook = () => readFileSync(fileURLToPath(new URL("./fixtures/budget-2015.xls", import.meta.url)));
const partialWorkbook = () => readFileSync(fileURLToPath(new URL("./fixtures/budget-2017.xls", import.meta.url)));

describe("council budgets source", () => {
  it("lists every published year and marks legacy layouts as unsupported", async () => {
    const result = await callTool<{ data: { years: Array<{ year: number; supported: boolean; partial: boolean }> } }>(
      councilBudgetsModule,
      "council_budgets_list_years",
      {},
      async () => { throw new Error("year listing must not make a network request"); }
    );
    expect(result.ok).toBe(true);
    expect(result.body.data.years.map(({ year }) => year)).toEqual(Array.from({ length: 14 }, (_value, index) => 2013 + index));
    expect(result.body.data.years.filter(({ supported }) => !supported).map(({ year }) => year)).toEqual([2013, 2014]);
    expect(result.body.data.years.filter(({ partial }) => partial).map(({ year }) => year)).toEqual([2017]);
  });

  it("bounds council rows, retains zero values, and caches parsed workbooks", async () => {
    let calls = 0;
    const ctx = createContext({ fetch: async (input) => {
      calls += 1;
      expect(input).toBe("https://opendata.housing.gov.ie/dataset/e55a1d32-c225-48e0-bb6f-43c86071841b/resource/18d03f3e-43ab-40c9-ad89-bc64a014bc93/download/budget-2026-budget-publication-v1.2.xlsx");
      return new Response(currentWorkbook(), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
    } });
    const args = { year: 2026, authority: "Dublin City Council", division: "A", limit: 3 };
    const first = await callTool<{ data: { rows: Array<{ unit: string; amount: number }>; total_rows: number; budget_type: string; next_offset: number | null }; truncated: boolean }>(
      councilBudgetsModule, "council_budgets_get", args, ctx
    );
    const second = await callTool<{ data: { rows: Array<{ amount: number }>; next_offset: number | null } }>(
      councilBudgetsModule, "council_budgets_get", { ...args, offset: 3 }, ctx
    );
    expect(first.ok).toBe(true);
    expect(first.body.data.rows).toHaveLength(3);
    expect(first.body.truncated).toBe(true);
    expect(first.body.data.total_rows).toBeGreaterThan(3);
    expect(first.body.data.budget_type).toBe("adopted budget estimate");
    expect(first.body.data.next_offset).toBe(3);
    expect(first.body.data.rows.every((row) => row.unit === "EUR")).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.body.data.rows[0]?.amount).not.toBe(first.body.data.rows[0]?.amount);
    expect(calls).toBe(1);
  });

  it("reports listed but unsupported years without requesting or inventing rows", async () => {
    let calls = 0;
    const result = await callTool(councilBudgetsModule, "council_budgets_get", {
      year: 2014, authority: "Dublin City Council"
    }, async () => { calls += 1; return Response.json({}); });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("returns every 2015 Division A line through the canonical Dún Laoghaire-Rathdown name", async () => {
    const ctx = createContext({ fetch: async () => new Response(historicalWorkbook()) });
    const result = await callTool<{
      data: { rows: Array<{ source_authority: string; line_item: string; measure: string }>; total_rows: number };
      truncated: boolean;
    }>(councilBudgetsModule, "council_budgets_get", {
      year: 2015,
      authority: "Dún Laoghaire-Rathdown County Council",
      division: "A"
    }, ctx);
    expect(result.ok).toBe(true);
    expect(result.body.data.total_rows).toBe(22);
    expect(result.body.data.rows).toHaveLength(22);
    expect(new Set(result.body.data.rows.map(({ source_authority }) => source_authority)).size).toBe(2);
    expect(new Set(result.body.data.rows.map(({ line_item }) => line_item)).size).toBe(11);
    expect(result.body.truncated).toBe(false);
  });

  it("marks the 2017 response as partial and reports omitted unlabeled values", async () => {
    const ctx = createContext({ fetch: async () => new Response(partialWorkbook()) });
    const result = await callTool<{ data: { partial: boolean; unlabelled_source_value_count: number; coverage_note: string | null } }>(
      councilBudgetsModule,
      "council_budgets_get",
      { year: 2017, authority: "Carlow County Council", division: "A", limit: 1 },
      ctx
    );
    expect(result.ok).toBe(true);
    expect(result.body.data.partial).toBe(true);
    expect(result.body.data.unlabelled_source_value_count).toBe(124);
    expect(result.body.data.coverage_note).toMatch(/124 unlabelled numeric source values/);
  });

  it("does not cache a non-workbook response as an empty budget", async () => {
    let calls = 0;
    const ctx = createContext({ fetch: async () => {
      calls += 1;
      return new Response(calls === 1 ? "<html>temporary proxy error</html>" : currentWorkbook());
    } });
    const args = { year: 2026, authority: "Dublin City Council", division: "A", limit: 1 };
    const first = await callTool(councilBudgetsModule, "council_budgets_get", args, ctx);
    const second = await callTool(councilBudgetsModule, "council_budgets_get", args, ctx);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });
});
