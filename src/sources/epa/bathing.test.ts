import { describe, expect, it } from "vitest";
import { callTool } from "../../../test/helpers/callTool.js";
import { fakeFetch } from "../../../test/helpers/fakeFetch.js";
import { epaModule } from "./index.js";

type LocBody = { data: { locations: Array<{ beach_id: string }>; next_offset: number | null } };

describe("EPA bathing water", () => {
  const register = Array.from({ length: 243 }, (_, i) => ({
    beach_id: `IE${String(i).padStart(3, "0")}`,
    beach_name: i === 120 ? "Salthill Beach" : `Beach ${i}`,
    county_name: i % 3 === 0 ? "Galway" : "Clare",
    annual_water_quality_assessment: `Beach ${i} is classified as achieving Excellent Water Quality in 2025 based on bacteriological results for 2022 to 2025. `.repeat(3),
    beach_description: "x".repeat(10000)
  }));
  const registerFetch = () => fakeFetch([{ match: /\/bw\/api\/v1\/locations\?page=1&per_page=500$/, body: JSON.stringify({ count: 243, page: 1, list: register }) }]);

  it("filters the whole register by beach name and county with compact rows", async () => {
    const r = await callTool(epaModule, "epa_bathing_locations", { name: "salthill", county: "galway" }, registerFetch());
    expect(r.ok).toBe(true);
    expect(r.body.data).toMatchObject({ total: 1, register_total: 243, offset: 0, next_offset: null });
    expect(r.body.data.locations[0]).toMatchObject({ beach_name: "Salthill Beach", county_name: "Galway", annual_water_quality_assessment: expect.stringContaining("Excellent") });
    expect(JSON.stringify(r.body)).not.toContain("x".repeat(100));
    expect(r.body.url).toBe("https://data.epa.ie/bw/api/v1/locations?page=1&per_page=500");
    const page2 = await callTool(epaModule, "epa_bathing_locations", { county: "Galway", page: 2, limit: 10 }, registerFetch());
    expect(page2.body.data).toMatchObject({ total: 81, offset: 10, next_offset: 20 });
    expect(page2.body.data.locations[0].beach_id).toBe("IE030");
  });

  it("pages through every location without gaps even when the token budget cuts a page", async () => {
    const fetch = registerFetch();
    const seen: string[] = [];
    let offset: number | null = 0;
    let truncatedPages = 0;
    for (let guard = 0; offset !== null && guard < 50; guard += 1) {
      const r: { ok: boolean; body: LocBody } = await callTool<LocBody>(epaModule, "epa_bathing_locations", { offset, limit: 50, max_tokens: 8000 }, fetch);
      expect(r.ok).toBe(true);
      const rows = r.body.data.locations;
      expect(rows.length).toBeGreaterThan(0);
      if (rows.length < 50 && r.body.data.next_offset !== null) truncatedPages += 1;
      seen.push(...rows.map((row) => row.beach_id));
      offset = r.body.data.next_offset;
    }
    expect(truncatedPages).toBeGreaterThan(0);
    expect(seen).toHaveLength(243);
    expect(new Set(seen).size).toBe(243);
    expect(seen).toContain("IE120");
  });
  it("preserves restriction and update dates without inferring swimming safety", async () => {
    const fetch = fakeFetch([{ match: /\/alerts\?page=1&per_page=5$/, body: JSON.stringify({ count: 1, page: 1, list: [{ beach_id: "IESHBWL27_72_0100", has_bathing_restriction_in_place: "Yes", incident_end_date: null, last_updated: "2026-09-23T11:10:43" }] }) }]);
    const r = await callTool<{ data: { alerts: Array<Record<string, unknown>>; caveat: string } }>(epaModule, "epa_bathing_alerts", { limit: 5 }, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.alerts[0]).toMatchObject({ has_bathing_restriction_in_place: "Yes", incident_end_date: null, last_updated: "2026-09-23T11:10:43" });
    expect(r.body.data.caveat).toContain("absence");
  });
  it("queries out-of-season samples and preserves the sample date", async () => {
    const fetch = fakeFetch([{ match: /\/measurements\/out-season\?page=1&per_page=2$/, body: JSON.stringify({ count: 1007, page: 1, list: [{ beach_id: "BPNBF070000020002", result_date: "2016-01-04", e_coli_result: "6488", sample_water_quality_status: "Poor" }] }) }]);
    const r = await callTool<{ data: { measurements: Array<Record<string, unknown>>; caveat: string } }>(epaModule, "epa_bathing_measurements", { season: "out-season", limit: 2 }, fetch);
    expect(r.ok).toBe(true);
    expect(r.body.data.measurements[0]).toMatchObject({ result_date: "2016-01-04", e_coli_result: "6488" });
    expect(r.body.data.caveat).toContain("latest");
  });
  it("rejects malformed success bodies rather than reporting no alerts", async () => {
    const r = await callTool(epaModule, "epa_bathing_alerts", {}, fakeFetch([{ match: /\/alerts\?/, body: '{"error":"unavailable"}' }]));
    expect(r.ok).toBe(false);
  });
});
