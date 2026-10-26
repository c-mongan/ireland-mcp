import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callTool } from "../../../test/helpers/callTool.js";
import { cibModule, snapshotHealth } from "./index.js";
import { annualSchema, categoriesSchema, CIB_DATA_DIR, CIB_FILES, cipsSchema, loadCibSnapshots, validateSnapshot } from "./snapshot.js";

const offline = async (): Promise<Response> => { throw new Error("CIB tools must not make network requests"); };
const raw = (file: string) => JSON.parse(readFileSync(new URL(file, CIB_DATA_DIR), "utf8"));

describe("CIB Data Hub snapshot tools", () => {
  it("returns CIS annual callers and queries with attribution, as_of and source URLs", async () => {
    const result = await callTool(cibModule, "cib_cis_annual_summary", {}, offline);
    expect(result.ok).toBe(true);
    const years = result.body.data.years;
    expect(years.map((y: { year: number }) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(years.find((y: { year: number }) => y.year === 2022)).toMatchObject({ callers: 394400, queries: 788902, callers_derived: false });
    expect(years.find((y: { year: number }) => y.year === 2024)).toMatchObject({ callers: 395017, queries: 767168 });
    expect(result.body.data.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.body.data.attribution).toContain("Creative Commons Attribution 4.0");
    expect(result.body.data.credit).toBe("Citizens Information Board");
    expect(result.body.data.source_urls.length).toBeGreaterThan(5);
    expect(result.body.data.live).toBe(false);
    expect(result.body.licence).toContain("CC BY 4.0");
    expect(result.body.attribution).toContain("Citizens Information Board");
  });

  it("labels the 2025 caller figure as derived from the four quarterly reports", async () => {
    const result = await callTool(cibModule, "cib_cis_annual_summary", { year: 2025 }, offline);
    const [y] = result.body.data.years;
    expect(y).toMatchObject({ year: 2025, callers: 384091, queries: 708862, callers_derived: true });
    expect(y.callers_method).toContain("quarterly");
    expect(y.quarterly_callers.map((q: { callers: number }) => q.callers)).toEqual([101462, 94372, 102062, 86195]);
    expect(y.quarterly_callers.reduce((a: number, q: { callers: number }) => a + q.callers, 0)).toBe(384091);
    expect(result.body.url).toContain("query-categories-2025.docx");
  });

  it("filters query categories by year and category, case-insensitively", async () => {
    const year = await callTool(cibModule, "cib_cis_query_categories", { year: 2025 }, offline);
    const cats = Object.fromEntries(year.body.data.years[0].categories.map((c: { category: string; queries: number }) => [c.category, c.queries]));
    expect(cats).toMatchObject({ "Social Welfare": 315200, Housing: 82209, Health: 51513, "Money and Tax": 47635, Employment: 39265, "Moving Country": 38364 });
    const series = await callTool(cibModule, "cib_cis_query_categories", { category: "money & tax" }, offline);
    expect(series.body.data.category).toBe("Money and Tax");
    expect(series.body.data.series.map((s: { year: number }) => s.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
    const one = await callTool(cibModule, "cib_cis_query_categories", { year: 2024, category: "BIRTH, FAMILY & RELATIONSHIPS" }, offline);
    expect(one.body.data.series).toEqual([expect.objectContaining({ year: 2024, queries: 16358, source_label: "Birth, Family & Relationships" })]);
  });

  it("returns CIPS contacts, categories and the recorded 2025 table mismatches", async () => {
    const result = await callTool(cibModule, "cib_cips_summary", { year: 2025 }, offline);
    const [y] = result.body.data.years;
    expect(y.contacts).toEqual({ telephone: 111472, webchat: 1792, social_media: 240, total: 113504, total_basis: "table" });
    expect(y.categorised_calls).toBe(63609);
    const byName = Object.fromEntries(y.categories.map((c: { category: string }) => [c.category, c]));
    expect(byName["Social Welfare"].calls).toBe(26291);
    expect(byName.Housing).toMatchObject({ calls: 6382, subcategory_table_total: 6381 });
    expect(byName["Money and Tax"]).toMatchObject({ calls: 6014, subcategory_table_total: 6012 });
    expect(byName["Moving Country"]).toMatchObject({ calls: 4108, subcategory_table_total: 4105 });
    expect(byName.Housing.note).toContain("main table value is used");
    expect(result.body.data.source_urls).toEqual(["https://www.citizensinformationboard.ie/downloads/datahub/CIPS-statistical-summary-2025.docx"]);
  });

  it("explains missing years and unknown categories", async () => {
    const year = await callTool(cibModule, "cib_cips_summary", { year: 2019 }, offline);
    expect(year.body.error.code).toBe("NOT_FOUND");
    expect(year.body.error.hint).toContain("2021, 2022, 2023, 2024, 2025");
    const cat = await callTool(cibModule, "cib_cis_query_categories", { category: "Astrology" }, offline);
    expect(cat.body.error.code).toBe("NOT_FOUND");
    expect(cat.body.error.hint).toContain("Social Welfare");
    const bad = await callTool(cibModule, "cib_cis_annual_summary", { year: "2025" }, offline);
    expect(bad.body.error.code).toBe("BAD_ARGS");
  });

  it("reports packaged snapshot health", () => {
    expect(snapshotHealth()).toEqual({ ok: true, note: expect.stringMatching(/^packaged snapshot retrieved \d{4}-\d{2}-\d{2}$/) });
  });
});

describe("CIB snapshot integrity", () => {
  const snapshots = loadCibSnapshots();
  const docs = [snapshots.annual, snapshots.categories, snapshots.cips];

  it("validates every file against its schema with licence, as_of and checksummed sources", () => {
    for (const doc of docs) {
      expect(doc.licence.attribution).toBe("Contains Irish Public Sector Data licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) licence");
      expect(doc.licence.credit).toBe("Citizens Information Board");
      expect(doc.sources.some((s) => s.id === "psi-notice")).toBe(true);
      expect(new Set(doc.sources.map((s) => s.id)).size).toBe(doc.sources.length);
      expect(new Set(doc.sources.map((s) => s.sha256)).size).toBe(doc.sources.length);
      expect(doc.notes.length).toBeGreaterThan(0);
    }
    expect(Object.values(CIB_FILES)).toHaveLength(3);
  });

  it("keeps printed figures consistent with their numeric values", () => {
    const visit = (node: unknown): number => {
      if (Array.isArray(node)) return node.reduce((n: number, v) => n + visit(v), 0);
      if (!node || typeof node !== "object") return 0;
      const f = node as { printed?: unknown; value?: unknown };
      let n = 0;
      if (typeof f.printed === "string") {
        expect(Number(f.printed.replaceAll(",", ""))).toBe(f.value);
        n = 1;
      }
      return n + Object.values(node).reduce((m: number, v) => m + visit(v), 0);
    };
    expect(docs.reduce((n, d) => n + visit(d.years), 0)).toBeGreaterThan(200);
  });

  it("has category sums that match totals, and CIPS contact modes that add up", () => {
    for (const y of snapshots.categories.years) {
      expect(y.categories.reduce((a, c) => a + c.queries.value, 0)).toBe(y.total_queries.value);
      expect(y.matches_total).toBe(true);
    }
    for (const y of snapshots.cips.years) {
      const c = y.contacts;
      expect(c.telephone.value + c.webchat.value + c.social_media.value).toBe(c.total.value);
      expect(y.categories.reduce((a, x) => a + x.calls.value, 0)).toBe(y.sum_of_categories);
    }
    for (const y of snapshots.annual.years.filter((y) => y.quarterly_callers)) {
      expect(y.quarterly_callers!.reduce((a, q) => a + q.callers.value, 0)).toBe(y.callers.value);
    }
  });

  it("rejects a snapshot that cites an unlisted source or an off-site URL", () => {
    const annual = raw(CIB_FILES.annual);
    expect(() => validateSnapshot(annual, annualSchema, CIB_FILES.annual)).not.toThrow();
    annual.years[0].queries.source = "not-listed";
    expect(() => validateSnapshot(annual, annualSchema, CIB_FILES.annual)).toThrow("not-listed");
    const cips = raw(CIB_FILES.cips);
    cips.sources[1].url = "https://example.com/file.docx";
    expect(() => validateSnapshot(cips, cipsSchema, CIB_FILES.cips)).toThrow("cips.json failed validation");
    const categories = raw(CIB_FILES.categories);
    delete categories.licence;
    expect(() => validateSnapshot(categories, categoriesSchema, CIB_FILES.categories)).toThrow("licence");
  });
});
