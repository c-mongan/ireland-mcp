import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callTool } from "../../../test/helpers/callTool.js";
import { cibModule, snapshotHealth } from "./index.js";
import { cipsDataset, cisAnnualDataset, cisCategoryDataset } from "./schema.js";

const offline = async (): Promise<Response> => { throw new Error("CIB tools must not make network requests"); };
const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../web/data/cib/${name}`, import.meta.url), "utf8"));

// Reviewed snapshot digests. A refresh must update these deliberately, after reviewing the data diff.
const PINNED_SHA256: Record<string, string> = {
  "cis-annual.json": "8f41bb8212ab7018b1f51f0e65fb3f166f5ca0d7efbf9af560a15b429283fa85",
  "cis-query-categories.json": "09c2d35eac069eb0061f5a9d2ba2e2801c372fde0fba067df89e288fd6c6d2a4",
  "cips-annual.json": "01e32321a028fd3918c32603cb40388bf7e92bea422129fca283304dcd13dfaa"
};

describe("CIB published snapshots", () => {
  it("match the reviewed digests and come from one refresh", () => {
    for (const [name, digest] of Object.entries(PINNED_SHA256)) {
      expect(createHash("sha256").update(readFileSync(new URL(`../../../web/data/cib/${name}`, import.meta.url))).digest("hex"), name).toBe(digest);
    }
    expect(new Set(Object.keys(PINNED_SHA256).map((n) => read(n).generated_at)).size).toBe(1);
  });

  it("reject an unknown schema version", () => {
    expect(cisAnnualDataset.safeParse({ ...read("cis-annual.json"), schema: "https://irishopendata.ie/data/cib/cis-annual.json#v2" }).success).toBe(false);
  });

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

  it("requires a year so every answer keeps its source files and checksums", async () => {
    const result = await callTool(cibModule, "cib_cis_annual_summary", {}, offline);
    expect(result.ok).toBe(false);
    const record = await callTool(cibModule, "cib_cis_annual_summary", { year: 2025 }, offline);
    expect(record.body.data.snapshot.notes.join(" ")).toMatch(/sum of the four 2025 quarterly reports/);
    expect(record.body.data.snapshot.schema).toBe("https://irishopendata.ie/data/cib/cis-annual.json#v1");
    expect(record.body.retrieved_at).toBe(record.body.data.record.sources.map((s: { retrieved_at: string }) => s.retrieved_at).sort()[0]);
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
    const bases = [];
    for (const year of [2021, 2022, 2023, 2024, 2025]) bases.push((await callTool(cibModule, "cib_cips_summary", { year }, offline)).body.data.record.calls_answered_basis);
    expect(bases).toEqual(["all_contact_modes", "all_contact_modes", "all_contact_modes", "telephone_only", "telephone_only"]);
  });

  it("fits every full record inside the default response budget", async () => {
    for (const year of [2021, 2022, 2023, 2024, 2025]) {
      for (const [name, args] of [["cib_cis_annual_summary", { year }], ["cib_cis_query_categories", { year }], ["cib_cips_summary", { year }]] as const) {
        const result = await callTool(cibModule, name, args, offline);
        expect(result.body.truncated_at, `${name} ${year}`).toBeUndefined();
        expect(result.body.truncated, `${name} ${year}`).toBe(false);
      }
    }
  });

  it("rejects years outside the snapshot without inventing data", async () => {
    const missing = await callTool(cibModule, "cib_cips_summary", { year: 2019 }, offline);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(missing.body.error.hint).toContain("2021, 2022, 2023, 2024, 2025");
    const invalid = await callTool(cibModule, "cib_cis_query_categories", { year: "2025" }, offline);
    expect(invalid.ok).toBe(false);
  });
});
