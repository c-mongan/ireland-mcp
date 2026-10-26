import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callTool } from "../../../test/helpers/callTool.js";
import { cibModule, snapshotHealth } from "./index.js";
import { cipsDataset, cisAnnualDataset, cisCategoryDataset } from "./schema.js";

const offline = async (): Promise<Response> => { throw new Error("CIB tools must not make network requests"); };
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../web/data/cib/${name}`, import.meta.url), "utf8"));

describe("CIB published snapshots", () => {
  it("validate, carry CC BY 4.0 attribution and checksum every source file", () => {
    for (const [name, schema] of [["cis-annual.json", cisAnnualDataset], ["cis-query-categories.json", cisCategoryDataset], ["cips-annual.json", cipsDataset]] as const) {
      const data = schema.parse(read(name));
      expect(data.attribution).toContain("Creative Commons Attribution 4.0");
      expect(data.attribution).toContain("Citizens Information Board");
      expect(data.records.map((r) => r.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
      for (const r of data.records) {
        expect(r.sources.length).toBeGreaterThan(0);
        expect(r.sources.every((s) => /^[0-9a-f]{64}$/.test(s.sha256))).toBe(true);
      }
    }
    expect(snapshotHealth()).toMatchObject({ ok: true });
  });

  it("only fails the documented 2025 CIPS sub-table checks", () => {
    const failed = ["cis-annual.json", "cis-query-categories.json", "cips-annual.json"].flatMap((name) =>
      read(name).records.flatMap((r: { year: number; checks: Array<{ name: string; ok: boolean }> }) => r.checks.filter((c) => !c.ok).map((c) => `${r.year} ${c.name}`)));
    expect(failed.sort()).toEqual([
      "2025 subcategory_table_total_matches:housing",
      "2025 subcategory_table_total_matches:money-and-tax",
      "2025 subcategory_table_total_matches:moving-country"
    ]);
  });
});

describe("CIB tools", () => {
  it("returns the verified CIS figures with provenance", async () => {
    const expected: Record<number, [number, number]> = { 2021: [338167, 693918], 2022: [394400, 788902], 2023: [397605, 795278], 2024: [395017, 767168], 2025: [384091, 708862] };
    for (const [year, [callers, queries]] of Object.entries(expected)) {
      const result = await callTool(cibModule, "cib_cis_annual_summary", { year: Number(year) }, offline);
      expect(result.ok).toBe(true);
      expect([result.body.data.record.callers, result.body.data.record.queries]).toEqual([callers, queries]);
      expect(result.body.licence).toBe("CC BY 4.0");
      expect(result.body.attribution).toContain("Citizens Information Board");
      expect(result.body.url).toMatch(/^https:\/\/www\.citizensinformationboard\.ie\//);
      expect(result.body.data.snapshot.public_file).toBe("https://irishopendata.ie/data/cib/cis-annual.json");
      expect(result.body.data.snapshot.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const derived = await callTool(cibModule, "cib_cis_annual_summary", { year: 2025 }, offline);
    expect(derived.body.data.record.callers_basis).toBe("derived_sum_of_quarterly_reports");
    expect(derived.body.data.record.callers_derivation.operands.map((o: { value: number }) => o.value)).toEqual([101462, 94372, 102062, 86195]);
  });

  it("returns a compact series when year is omitted", async () => {
    const result = await callTool(cibModule, "cib_cis_annual_summary", {}, offline);
    expect(result.body.data.series.map((r: { year: number }) => r.year)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(result.body.data.series[0].sources).toBeUndefined();
    expect(result.body.data.snapshot.notes.join(" ")).toMatch(/sum of the four 2025 quarterly reports/);
  });

  it("filters query categories by label or key", async () => {
    const all = await callTool(cibModule, "cib_cis_query_categories", { year: 2025 }, offline);
    expect(all.body.data.record.categories).toHaveLength(15);
    const housing = await callTool(cibModule, "cib_cis_query_categories", { year: 2025, category: "Housing" }, offline);
    expect(housing.body.data.record.categories).toEqual([{ category: "Housing", category_key: "housing", queries: 82209, share_pct_published: 11.6 }]);
    const money = await callTool(cibModule, "cib_cis_query_categories", { year: 2025, category: "money & tax" }, offline);
    expect(money.body.data.record.categories[0].queries).toBe(47635);
    const none = await callTool(cibModule, "cib_cis_query_categories", { year: 2025, category: "astrology" }, offline);
    expect(none.body.error.code).toBe("NOT_FOUND");
    expect(none.body.error.hint).toContain("social-welfare");
  });

  it("exposes the CIPS definition change and contact modes", async () => {
    const y2025 = await callTool(cibModule, "cib_cips_summary", { year: 2025 }, offline);
    expect(y2025.body.data.record.contacts).toEqual({ telephone: 111472, webchat: 1792, social_media: 240, total: 113504 });
    expect(y2025.body.data.record.calls_answered_basis).toBe("telephone_only");
    expect(y2025.body.data.record.categories[0]).toMatchObject({ category: "Social Welfare", calls: 26291, share_pct_published: 41.3 });
    const series = await callTool(cibModule, "cib_cips_summary", {}, offline);
    expect(series.body.data.series.map((r: { calls_answered_basis: string }) => r.calls_answered_basis))
      .toEqual(["all_contact_modes", "all_contact_modes", "all_contact_modes", "telephone_only", "telephone_only"]);
  });

  it("rejects years outside the snapshot without inventing data", async () => {
    const missing = await callTool(cibModule, "cib_cips_summary", { year: 2019 }, offline);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(missing.body.error.hint).toContain("2021, 2022, 2023, 2024, 2025");
    const invalid = await callTool(cibModule, "cib_cis_query_categories", { year: "2025" }, offline);
    expect(invalid.ok).toBe(false);
  });
});
